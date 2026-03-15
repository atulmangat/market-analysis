"""
Two-level cache:
  L1 — in-process dict (zero latency, lost on process restart / cold start)
  L2 — DB-backed CacheEntry table (shared across all workers, survives restarts)

Reads: L1 hit → return immediately. L1 miss → L2 lookup → populate L1 → return.
Writes: write L2 first, then populate L1.
Invalidation: delete from L2 (L1 entries will expire naturally or be skipped on next L2 miss).

TTL constants are defined in api.py and passed to cache_set().
"""

import json
import time
import threading
from datetime import datetime, timedelta
from typing import Any

# ── L1: in-process ────────────────────────────────────────────────────────────
_l1: dict[str, tuple[Any, float]] = {}   # key → (value, l1_expires_monotonic)
_l1_lock = threading.Lock()
_L1_TTL = 30  # seconds — L1 is a short-lived hot layer; L2 is authoritative


def _l1_get(key: str) -> Any | None:
    with _l1_lock:
        entry = _l1.get(key)
        if entry is None:
            return None
        value, exp = entry
        if time.monotonic() > exp:
            del _l1[key]
            return None
        return value


def _l1_set(key: str, value: Any) -> None:
    with _l1_lock:
        _l1[key] = (value, time.monotonic() + _L1_TTL)


def _l1_delete(key: str) -> None:
    with _l1_lock:
        _l1.pop(key, None)


def _l1_delete_prefix(prefix: str) -> None:
    with _l1_lock:
        keys = [k for k in _l1 if k.startswith(prefix)]
        for k in keys:
            del _l1[k]


# ── L2: DB ────────────────────────────────────────────────────────────────────

def _db_get(key: str) -> Any | None:
    """Read from DB cache, returns None on miss or expiry."""
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            row = db.query(models.CacheEntry).filter(models.CacheEntry.key == key).first()
            if row is None:
                return None
            if row.expires_at and datetime.utcnow() > row.expires_at:
                db.delete(row)
                db.commit()
                return None
            return json.loads(row.value_json)
        finally:
            db.close()
    except Exception as e:
        print(f"[cache] DB get error for '{key}': {e}")
        return None


def _db_set(key: str, value: Any, ttl: int) -> None:
    """Upsert into DB cache with TTL."""
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            expires_at = (datetime.utcnow() + timedelta(seconds=ttl)) if ttl else None
            row = db.query(models.CacheEntry).filter(models.CacheEntry.key == key).first()
            value_json = json.dumps(value)
            if row:
                row.value_json = value_json
                row.expires_at = expires_at
                row.updated_at = datetime.utcnow()
            else:
                db.add(models.CacheEntry(
                    key=key,
                    value_json=value_json,
                    expires_at=expires_at,
                ))
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[cache] DB set error for '{key}': {e}")


def _db_delete(key: str) -> None:
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            db.query(models.CacheEntry).filter(models.CacheEntry.key == key).delete()
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[cache] DB delete error for '{key}': {e}")


def _db_delete_prefix(prefix: str) -> None:
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            db.query(models.CacheEntry).filter(
                models.CacheEntry.key.like(f"{prefix}%")
            ).delete(synchronize_session=False)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[cache] DB delete_prefix error for '{prefix}': {e}")


# ── Public API ─────────────────────────────────────────────────────────────────

def cache_get(key: str) -> Any | None:
    # L1 fast path
    val = _l1_get(key)
    if val is not None:
        return val
    # L2 DB
    val = _db_get(key)
    if val is not None:
        _l1_set(key, val)
    return val


def cache_set(key: str, value: Any, ttl: int) -> None:
    """Store value. ttl in seconds; 0 = no expiry."""
    _db_set(key, value, ttl)
    _l1_set(key, value)


def cache_invalidate(key: str) -> None:
    _db_delete(key)
    _l1_delete(key)


def cache_invalidate_prefix(prefix: str) -> None:
    _db_delete_prefix(prefix)
    _l1_delete_prefix(prefix)


def cache_clear_all() -> None:
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            db.query(models.CacheEntry).delete()
            db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"[cache] DB clear error: {e}")
    with _l1_lock:
        _l1.clear()


def cache_stats() -> dict:
    now_mono = time.monotonic()
    with _l1_lock:
        l1_total = len(_l1)
        l1_live = sum(1 for _, (_, exp) in _l1.items() if now_mono <= exp)
        l1_keys = list(_l1.keys())
    try:
        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            now_utc = datetime.utcnow()
            l2_total = db.query(models.CacheEntry).count()
            l2_expired = db.query(models.CacheEntry).filter(
                models.CacheEntry.expires_at.isnot(None),
                models.CacheEntry.expires_at < now_utc,
            ).count()
            l2_keys = [r.key for r in db.query(models.CacheEntry.key).all()]
        finally:
            db.close()
    except Exception:
        l2_total = l2_expired = -1
        l2_keys = []
    return {
        "l1": {"total": l1_total, "live": l1_live, "keys": l1_keys},
        "l2": {"total": l2_total, "expired": l2_expired, "keys": l2_keys},
    }
