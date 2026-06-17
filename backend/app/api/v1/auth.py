import uuid
import urllib.request
import urllib.parse
import json
import asyncio
from fastapi import APIRouter, Depends, HTTPException, status, Security, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import structlog

from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token, decode_access_token
from app.models.sqlalchemy_models import User
from app.models.pydantic_models import UserCreate, UserLogin, UserResponse, TokenResponse
from app.services.redis_cache import redis_service

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["User Authentication"])

security = HTTPBearer()

class RateLimiter:
    def __init__(self, limit: int, window: int):
        self.limit = limit
        self.window = window

    async def check(self, request: Request, key_prefix: str) -> None:
        client_ip = request.client.host if request.client else "unknown"
        redis_key = f"rate_limit:{key_prefix}:{client_ip}"
        
        client = redis_service.client
        if not client:
            return

        try:
            current = await client.get(redis_key)
            if current and int(current) >= self.limit:
                ttl = await client.ttl(redis_key)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many attempts. Cloudflare rate limiting active. Please try again in {ttl if ttl > 0 else self.window} seconds."
                )
            
            async with client.pipeline(transaction=True) as pipe:
                pipe.incr(redis_key)
                if not current:
                    pipe.expire(redis_key, self.window)
                await pipe.execute()
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Rate limiter Redis failure", error=str(e))

def rate_limit(limit: int = 5, window: int = 60, prefix: str = "auth"):
    async def dependency(request: Request):
        limiter = RateLimiter(limit, window)
        await limiter.check(request, prefix)
    return dependency

def _sync_verify_turnstile(token: str, secret_key: str) -> bool:
    url = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    data = urllib.parse.urlencode({
        "secret": secret_key,
        "response": token
    }).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=data, method="POST")
        with urllib.request.urlopen(req, timeout=5) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return res_data.get("success", False)
    except Exception as e:
        logger.error("Turnstile verification API request failure", error=str(e))
        return False

async def verify_turnstile(token: str | None) -> bool:
    if not token:
        return False
    from app.core.config import settings
    secret_key = settings.TURNSTILE_SECRET_KEY
    return await asyncio.to_thread(_sync_verify_turnstile, token, secret_key)

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Dependency to validate the Bearer token and return the current database user.
    """
    token = credentials.credentials
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    query = select(User).where(User.username == username)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user does not exist in system database.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(rate_limit(limit=3, window=60, prefix="signup"))])
async def signup(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    """
    Register a new user and return a JWT access token.
    """
    if not await verify_turnstile(payload.turnstile_token):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security validation failed: Please complete the 'I am not a robot' verification."
        )
    try:
        # Check if username already exists
        query = select(User).where(User.username == payload.username)
        result = await db.execute(query)
        existing_user = result.scalar_one_or_none()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username is already registered."
            )
        
        # Create and save user
        hashed = hash_password(payload.password)
        new_user = User(username=payload.username, hashed_password=hashed)
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        
        # Create token
        token = create_access_token(data={"sub": new_user.username})
        logger.info("New user registered successfully", user_id=str(new_user.id), username=new_user.username)
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": new_user
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Signup endpoint failure", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal signup failure"
        )

@router.post("/login", response_model=TokenResponse, status_code=status.HTTP_200_OK, dependencies=[Depends(rate_limit(limit=5, window=60, prefix="login"))])
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    """
    Authenticate a user with credentials and return a JWT access token.
    """
    if not await verify_turnstile(payload.turnstile_token):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security validation failed: Please complete the 'I am not a robot' verification."
        )
    try:
        query = select(User).where(User.username == payload.username)
        result = await db.execute(query)
        user = result.scalar_one_or_none()
        if not user or not verify_password(payload.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        token = create_access_token(data={"sub": user.username})
        logger.info("User logged in successfully", user_id=str(user.id), username=user.username)
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": user
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Login endpoint failure", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal login failure"
        )

@router.get("/me", response_model=UserResponse, status_code=status.HTTP_200_OK)
async def get_me(current_user: User = Depends(get_current_user)):
    """
    Fetch current user profile.
    """
    return current_user
