from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.core.config import settings

# Sanitize DATABASE_URL for asyncpg driver compatibility (convert sslmode= to ssl=)
db_url = settings.DATABASE_URL
if "sslmode=" in db_url:
    db_url = db_url.replace("sslmode=", "ssl=")

# Create async database engine
engine = create_async_engine(
    db_url,
    echo=False,  # Set to True for debugging SQL queries
    pool_pre_ping=True,  # Check connection health before using
    pool_size=10,
    max_overflow=20
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()

# Dependency provider for FastAPI routes
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
