"""
Two-level cache:
  L1 — in-process dict (zero latency, lost on process restart / cold start)
  L2 — per-key files in /tmp (one file per cache key, no DB round-trip)

Reads:  L1 hit → return immediately.
        L1 miss → read single file from /tmp → populate L1 → return.
Writes: write file to /tmp, populate L1.
Invalidation: delete file, evict L1 entry.

File format: first line = ISO expiry timestamp (or "0" = no expiry), rest = JSON payload.
"""

import json
import os
import time
import threading
from datetime import datetime, timedelta
from typing import Any

# ── Config ─────────────────────────────────────────────────────────────────────
_CACHE_DIR = os.getenv("CACHE_DIR", "/tmp/mkt_cache")
os.makedirs(_CACHE_DIR, exist_ok=True)

# ── L1: in-process dict ────────────────────────────────────────────────────────
_l1: dict[str, tuple[Any, float]] = {}   # key → (value, l1_expires_monotonic)
_l1_lock = threading.Lock()
_L1_TTL = 60  # seconds — warm layer; L2 file is authoritative


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


# ── L2: per-key files in /tmp ──────────────────────────────────────────────────

def _key_to_path(key: str) -> str:
    """Map a cache key to a safe filename."""
    safe = key.replace("/", "__").replace(":", "_").replace(" ", "_")
    return os.path.join(_CACHE_DIR, f"{safe}.cache")


def _file_get(key: str) -> Any | None:
    path = _key_to_path(key)
    try:
        with open(path, "r") as f:
            expiry_line = f.readline().strip()
            payload = f.read()
        # Check expiry
        if expiry_line != "0":
            expires_at = datetime.fromisoformat(expiry_line)
            if datetime.utcnow() > expires_at:
                try:
                    os.remove(path)
                except OSError:
                    pass
                return None
        return json.loads(payload)
    except FileNotFoundError:
        return None
    except Exception as e:
        print(f"[cache] file get error for '{key}': {e}")
        return None


def _file_set(key: str, value: Any, ttl: int) -> None:
    path = _key_to_path(key)
    try:
        expiry_line = (
            (datetime.utcnow() + timedelta(seconds=ttl)).isoformat()
            if ttl else "0"
        )
        payload = json.dumps(value)
        # Write atomically via a temp file
        tmp_path = path + ".tmp"
        with open(tmp_path, "w") as f:
            f.write(expiry_line + "\n")
            f.write(payload)
        os.replace(tmp_path, path)
    except Exception as e:
        print(f"[cache] file set error for '{key}': {e}")


def _file_delete(key: str) -> None:
    try:
        os.remove(_key_to_path(key))
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[cache] file delete error for '{key}': {e}")


def _file_delete_prefix(prefix: str) -> None:
    safe_prefix = prefix.replace("/", "__").replace(":", "_").replace(" ", "_")
    try:
        for fname in os.listdir(_CACHE_DIR):
            if fname.startswith(safe_prefix) and fname.endswith(".cache"):
                try:
                    os.remove(os.path.join(_CACHE_DIR, fname))
                except OSError:
                    pass
    except Exception as e:
        print(f"[cache] file delete_prefix error for '{prefix}': {e}")


# ── Public API ──────────────────────────────────────────────────────────────────

def cache_get(key: str) -> Any | None:
    # L1 fast path — zero I/O
    val = _l1_get(key)
    if val is not None:
        return val
    # L2 file — single file read, no DB
    val = _file_get(key)
    if val is not None:
        _l1_set(key, val)
    return val


def cache_set(key: str, value: Any, ttl: int) -> None:
    """Store value. ttl in seconds; 0 = no expiry."""
    _file_set(key, value, ttl)
    _l1_set(key, value)


def cache_invalidate(key: str) -> None:
    _file_delete(key)
    _l1_delete(key)


def cache_invalidate_prefix(prefix: str) -> None:
    _file_delete_prefix(prefix)
    _l1_delete_prefix(prefix)


def cache_clear_all() -> None:
    try:
        for fname in os.listdir(_CACHE_DIR):
            if fname.endswith(".cache"):
                try:
                    os.remove(os.path.join(_CACHE_DIR, fname))
                except OSError:
                    pass
    except Exception as e:
        print(f"[cache] clear_all error: {e}")
    with _l1_lock:
        _l1.clear()


def cache_stats() -> dict:
    now_mono = time.monotonic()
    with _l1_lock:
        l1_total = len(_l1)
        l1_live = sum(1 for _, (_, exp) in _l1.items() if now_mono <= exp)
        l1_keys = list(_l1.keys())

    l2_total = l2_expired = 0
    l2_keys = []
    now_utc = datetime.utcnow()
    try:
        for fname in os.listdir(_CACHE_DIR):
            if not fname.endswith(".cache"):
                continue
            path = os.path.join(_CACHE_DIR, fname)
            l2_total += 1
            try:
                with open(path, "r") as f:
                    expiry_line = f.readline().strip()
                if expiry_line != "0":
                    if datetime.fromisoformat(expiry_line) < now_utc:
                        l2_expired += 1
            except Exception:
                pass
            l2_keys.append(fname[:-6])  # strip .cache
    except Exception as e:
        print(f"[cache] stats error: {e}")

    return {
        "l1": {"total": l1_total, "live": l1_live, "keys": l1_keys},
        "l2": {"total": l2_total, "expired": l2_expired, "keys": l2_keys},
    }
