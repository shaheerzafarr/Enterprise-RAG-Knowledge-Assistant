# pyrefly: ignore [missing-import]
import redis.asyncio as aioredis
# pyrefly: ignore [missing-import]
import structlog
# pyrefly: ignore [missing-import]
from app.core.config import settings

logger = structlog.get_logger(__name__)

class RedisService:
    def __init__(self):
        self.client: aioredis.Redis | None = None

    async def connect(self) -> None:
        if not self.client:
            logger.info("Initializing connection to Redis...", url=settings.REDIS_URL)
            self.client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            # Send a ping to verify connection is alive
            await self.client.ping()
            logger.info("Successfully connected to Redis.")

    async def disconnect(self) -> None:
        if self.client:
            logger.info("Closing Redis connections...")
            await self.client.close()
            await self.client.connection_pool.disconnect()
            self.client = None
            logger.info("Redis connection closed.")

    async def get(self, key: str) -> str | None:
        if not self.client:
            raise RuntimeError("Redis client is not initialized. Call connect() first.")
        try:
            return await self.client.get(key)
        except Exception as e:
            logger.error("Redis operation failed: get", key=key, error=str(e))
            return None

    async def set(self, key: str, value: str, expire_seconds: int | None = None) -> bool:
        if not self.client:
            raise RuntimeError("Redis client is not initialized. Call connect() first.")
        try:
            if expire_seconds:
                await self.client.set(name=key, value=value, ex=expire_seconds)
            else:
                await self.client.set(name=key, value=value)
            return True
        except Exception as e:
            logger.error("Redis operation failed: set", key=key, error=str(e))
            return False

    async def delete(self, key: str) -> bool:
        if not self.client:
            raise RuntimeError("Redis client is not initialized. Call connect() first.")
        try:
            result = await self.client.delete(key)
            return result > 0
        except Exception as e:
            logger.error("Redis operation failed: delete", key=key, error=str(e))
            return False

    async def clear_cache_pattern(self, pattern: str) -> None:
        if not self.client:
            raise RuntimeError("Redis client is not initialized. Call connect() first.")
        try:
            keys = []
            async for key in self.client.scan_iter(pattern):
                keys.append(key)
            if keys:
                await self.client.delete(*keys)
                logger.info("Cleared Redis cache keys matching pattern", pattern=pattern, count=len(keys))
        except Exception as e:
            logger.error("Redis operation failed: clear_cache_pattern", pattern=pattern, error=str(e))

    async def ping(self) -> bool:
        if not self.client:
            return False
        try:
            await self.client.ping()
            return True
        except Exception:
            return False

redis_service = RedisService()
