"""
JWT-based password authentication.
Set APP_PASSWORD and JWT_SECRET in environment variables (or .env).
"""
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY   = os.getenv("JWT_SECRET", "change-me-in-production-use-a-long-random-string")
ALGORITHM    = "HS256"
TOKEN_EXPIRE = timedelta(hours=24)

# The single app password (hashed on first use via passlib)
APP_PASSWORD = os.getenv("APP_PASSWORD", "admin123")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer(auto_error=False)

# ── Helpers ───────────────────────────────────────────────────────────────────

def verify_password(plain: str) -> bool:
    return plain == APP_PASSWORD


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
