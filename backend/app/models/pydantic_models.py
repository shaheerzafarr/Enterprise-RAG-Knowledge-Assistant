# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field
import uuid
from datetime import datetime

class TextIngestionRequest(BaseModel):
    filename: str = Field(..., max_length=255, description="Arbitrary name or source name of the text content")
    content: str = Field(..., description="The actual text content to chunk, embed, and index")

class IngestedDocumentResponse(BaseModel):
    id: uuid.UUID
    filename: str
    file_size: int
    chunk_count: int
    status: str
    error_message: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class QueryRequest(BaseModel):
    query: str = Field(..., description="The query string to match against the vector database")
    limit: int = Field(default=5, ge=1, le=100, description="The maximum number of search results to return")
    document_id: uuid.UUID | None = Field(default=None, description="Optional document ID to restrict the search filter")

class SearchResultPayload(BaseModel):
    document_id: str
    filename: str
    text: str
    chunk_index: int

class SearchResultResponse(BaseModel):
    id: str
    score: float
    payload: SearchResultPayload


class ChatSessionCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255, description="Optional custom title for the chat session")

class ChatSessionResponse(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime

    class Config:
        from_attributes = True

class ChatMessageResponse(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True

class RAGQueryRequest(BaseModel):
    query: str = Field(..., description="The query question to answer using RAG knowledge database")
    limit: int = Field(default=5, ge=1, le=20, description="The maximum number of contexts to retrieve")
    detail_level: str = Field(default="normal", description="Detail level of answer: normal, descriptive")

class RAGSourceItem(BaseModel):
    filename: str
    chunk_index: int
    score: float
    text: str

class RAGQueryResponse(BaseModel):
    answer: str
    sources: list[RAGSourceItem]


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=150)
    password: str = Field(..., min_length=6, max_length=100)

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: uuid.UUID
    username: str
    created_at: datetime

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse
