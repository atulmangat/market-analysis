"""
JWT-based password authentication.
Set APP_PASSWORD and JWT_SECRET in environment variables (or .env).
"""
import os
import time
import threading
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY   = os.getenv("JWT_SECRET", "change-me-in-production-use-a-long-random-string")
ALGORITHM    = "HS256"
TOKEN_EXPIRE = timedelta(hours=24)

def _get_app_password() -> str:
    return os.getenv("APP_PASSWORD", "admin123")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer(auto_error=False)

# ── Rate limiting ─────────────────────────────────────────────────────────────
# Per-IP: track (fail_count, lockout_until)
_MAX_ATTEMPTS  = 5
_LOCKOUT_SECS  = 15 * 60   # 15 minutes
_FAIL_DELAY    = 1.0        # seconds added per failure (slows automation)

_lock   = threading.Lock()
_state: dict[str, dict] = defaultdict(lambda: {"fails": 0, "locked_until": 0.0})


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(request: Request) -> None:
    ip = _get_client_ip(request)
    now = time.time()
    with _lock:
        entry = _state[ip]
        if now < entry["locked_until"]:
            retry_after = int(entry["locked_until"] - now)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Try again in {retry_after // 60}m {retry_after % 60}s.",
                headers={"Retry-After": str(retry_after)},
            )


def record_failed_attempt(request: Request) -> None:
    ip = _get_client_ip(request)
    now = time.time()
    with _lock:
        entry = _state[ip]
        entry["fails"] += 1
        # Exponential-ish delay: sleep outside lock so other IPs aren't blocked
        delay = _FAIL_DELAY * entry["fails"]
        if entry["fails"] >= _MAX_ATTEMPTS:
            entry["locked_until"] = now + _LOCKOUT_SECS
            entry["fails"] = 0  # reset counter after lockout is set
    time.sleep(min(delay, 5.0))  # cap at 5 s per request


def record_success(request: Request) -> None:
    ip = _get_client_ip(request)
    with _lock:
        _state[ip] = {"fails": 0, "locked_until": 0.0}


# ── Helpers ───────────────────────────────────────────────────────────────────

def verify_password(plain: str) -> bool:
    return plain == _get_app_password()


def create_token() -> str:
    expire = datetime.utcnow() + TOKEN_EXPIRE
    return jwt.encode({"exp": expire, "sub": "user"}, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> bool:
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return True
    except JWTError:
        return False


# ── FastAPI dependency ────────────────────────────────────────────────────────

def require_auth(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    if credentials is None or not verify_token(credentials.credentials):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
