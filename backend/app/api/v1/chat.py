import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import structlog

from app.core.database import get_db
from app.models.pydantic_models import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatMessageResponse,
    RAGQueryRequest,
    RAGQueryResponse
)
from app.models.sqlalchemy_models import ChatSession, ChatMessage, User
from app.api.v1.auth import get_current_user
from app.services.rag import rag_service

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/chat", tags=["Conversational Chat"])

@router.get("/sessions", response_model=list[ChatSessionResponse], status_code=status.HTTP_200_OK)
async def list_chat_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    List all chat sessions for the authenticated user, ordered by creation date descending.
    """
    try:
        query = select(ChatSession).where(ChatSession.user_id == current_user.id).order_by(ChatSession.created_at.desc())
        result = await db.execute(query)
        sessions = result.scalars().all()
        return sessions
    except Exception as e:
        logger.error("List chat sessions route failure", user_id=str(current_user.id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve chat sessions."
        )

@router.post("/session", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_chat_session(
    payload: ChatSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new isolated chat session associated with the authenticated user.
    """
    try:
        title = payload.title if payload.title else "New Conversation"
        session = ChatSession(title=title, user_id=current_user.id)
        db.add(session)
        await db.commit()
        await db.refresh(session)
        logger.info("Created new authenticated chat session", session_id=str(session.id), title=title, user_id=str(current_user.id))
        return session
    except Exception as e:
        logger.error("Create session route failure", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create chat session"
        )

async def verify_session_owner(session_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> ChatSession:
    """
    Helper to verify that the chat session exists and belongs to the authenticated user.
    """
    query_session = select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
    res_session = await db.execute(query_session)
    session = res_session.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chat session not found or access denied."
        )
    return session

@router.post("/session/{session_id}/message", response_model=RAGQueryResponse, status_code=status.HTTP_200_OK)
async def send_message_to_session(
    session_id: uuid.UUID,
    payload: RAGQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Submit a prompt to a chat session. Triggers local embedding search and reasoning synthesis via Gemini.
    """
    try:
        await verify_session_owner(session_id, current_user.id, db)
        response = await rag_service.answer_query(
            db=db,
            session_id=session_id,
            query=payload.query,
            limit=payload.limit,
            detail_level=payload.detail_level
        )
        return response
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(ve)
        )
    except Exception as e:
        logger.error("RAG message execution failure", session_id=str(session_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Conversational generation failed: {str(e)}"
        )

@router.get("/session/{session_id}/history", response_model=list[ChatMessageResponse], status_code=status.HTTP_200_OK)
async def get_chat_history(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Fetch all historical messages for a chat session, ordered chronologically.
    """
    try:
        await verify_session_owner(session_id, current_user.id, db)
        
        # Fetch messages
        query_msg = select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at)
        res_msg = await db.execute(query_msg)
        messages = res_msg.scalars().all()
        return messages
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Fetch chat history route failure", session_id=str(session_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve conversation logs."
        )

@router.delete("/session/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a specific chat session and all its associated messages.
    """
    try:
        session = await verify_session_owner(session_id, current_user.id, db)
        await db.delete(session)
        await db.commit()
        logger.info("Deleted chat session and cascaded messages", session_id=str(session_id), user_id=str(current_user.id))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("RAG message session deletion failure", session_id=str(session_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete session: {str(e)}"
        )

@router.post("/session/{session_id}/stream", status_code=status.HTTP_200_OK)
async def send_message_stream(
    session_id: uuid.UUID,
    payload: RAGQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Submit a prompt to a chat session. Streams response tokens using Server-Sent Events (SSE).
    """
    try:
        await verify_session_owner(session_id, current_user.id, db)
        generator = rag_service.stream_query(
            db=db,
            session_id=session_id,
            query=payload.query,
            limit=payload.limit,
            detail_level=payload.detail_level
        )
        return StreamingResponse(generator, media_type="text/event-stream")
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(ve)
        )
    except Exception as e:
        logger.error("RAG streaming route execution failure", session_id=str(session_id), error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Streaming generation failed: {str(e)}"
        )
