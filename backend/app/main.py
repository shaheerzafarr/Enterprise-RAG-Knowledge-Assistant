# pyrefly: ignore [missing-import]
from contextlib import asynccontextmanager
import asyncio
# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Request, status
# pyrefly: ignore [missing-import]
from fastapi.responses import JSONResponse
# pyrefly: ignore [missing-import]
from fastapi.exceptions import RequestValidationError
# pyrefly: ignore [missing-import]
from starlette.exceptions import HTTPException as StarletteHTTPException
# pyrefly: ignore [missing-import]
from sqlalchemy import text
# pyrefly: ignore [missing-import]
import structlog
from fastapi.middleware.cors import CORSMiddleware


from app.core.config import settings
from app.core.logging import setup_logging
from app.core.database import engine
from app.services.redis_cache import redis_service
from app.services.qdrant import qdrant_service
from app.services.embedding import embedding_service
from app.api.v1 import router as api_v1_router

# Setup structlog configuration
setup_logging()
logger = structlog.get_logger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup tasks
    logger.info("Starting Enterprise RAG Knowledge Assistant...", env=settings.ENV)
    
    # 1. Verify PostgreSQL Database Connection and Create Tables
    try:
        from app.core.database import Base
        # Importing models ensures they are registered on the Base metadata
        from app.models.sqlalchemy_models import User, ChatSession, ChatMessage, IngestedDocument # noqa: F401
        
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            # Add user_id multi-tenancy column to ingested_documents if it doesn't exist yet
            await conn.execute(text("ALTER TABLE ingested_documents ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;"))
        logger.info("Successfully connected to PostgreSQL database and initialized tables.")
    except Exception as e:
        logger.critical("Failed to connect to PostgreSQL database or initialize tables during startup", error=str(e))
        raise e

    # 2. Connect to Redis
    try:
        await redis_service.connect()
    except Exception as e:
        logger.critical("Failed to connect to Redis during startup", error=str(e))
        raise e

    # 3. Connect to Qdrant
    try:
        await qdrant_service.connect()
        # Initialize default vector collection with dimensions matching sentence-transformers (384)
        await qdrant_service.init_collection("kb_documents", vector_size=384)
    except Exception as e:
        logger.critical("Failed to connect to Qdrant during startup", error=str(e))
        raise e

    # 4. Preload local embedding model
    try:
        await asyncio.to_thread(embedding_service.load_model)
    except Exception as e:
        logger.critical("Failed to load local embedding model during startup", error=str(e))
        raise e

    yield

    # Shutdown tasks
    logger.info("Shutting down Enterprise RAG Knowledge Assistant...")
    await redis_service.disconnect()
    await qdrant_service.disconnect()
    await engine.dispose()
    logger.info("All connections closed and database engines disposed.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router)

# Global Exception Handlers
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    logger.error("HTTP Exception occurred", path=request.url.path, status_code=exc.status_code, detail=exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "status": "error"}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error("Request validation failed", path=request.url.path, errors=exc.errors())
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "status": "error"}
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception occurred", path=request.url.path, error=str(exc))
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred. Please contact administration.", "status": "error"}
    )

# Advanced service-aware healthcheck endpoint
@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    # 1. DB ping
    db_ok = False
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as e:
        logger.error("Healthcheck database failure", error=str(e))

    # 2. Redis ping
    redis_ok = await redis_service.ping()

    # 3. Qdrant ping
    qdrant_ok = await qdrant_service.ping()

    overall_healthy = db_ok and redis_ok and qdrant_ok
    status_code = status.HTTP_200_OK if overall_healthy else status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if overall_healthy else "unhealthy",
            "app": settings.PROJECT_NAME,
            "environment": settings.ENV,
            "services": {
                "database": "online" if db_ok else "offline",
                "cache": "online" if redis_ok else "offline",
                "vector_store": "online" if qdrant_ok else "offline"
            }
        }
    )

