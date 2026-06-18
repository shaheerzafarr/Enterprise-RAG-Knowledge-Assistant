# Enterprise RAG Knowledge Assistant: Architecture & Working Explanation

This document provides a comprehensive overview of how the **Enterprise RAG Knowledge Assistant** works, its architectural design, security mechanisms, pros and cons, and a roadmap for future features.

---

## 1. How the Application Works

The application operates as a full-stack Retrieval-Augmented Generation (RAG) system with a FastAPI backend, a Next.js (React) frontend, PostgreSQL for relational storage, Qdrant for semantic vector indexing, and Redis for caching and security.

### A. Authentication & Security Layer
1. **User Sign Up & Login**:
   - The user inputs credentials on the frontend page.
   - The request is protected by a **Cloudflare Turnstile** widget ("I am not a robot" checkbox).
   - Upon verification, Turnstile returns a challenge token.
   - The frontend passes this token along with user credentials to the backend.
   - **Backend Verification**: The backend validates the challenge token against the Cloudflare siteverify endpoint (`https://challenges.cloudflare.com/turnstile/v0/siteverify`).
   - **Rate Limiting**: Protected by a Redis sliding-window rate limiter. Login is capped at 5 requests/min and Signup at 3 requests/min to protect against brute-force attacks.
   - On success, the backend returns a secure JWT token.

### B. Document Ingestion Pipeline
1. **Upload**: Users upload documents (Text, PDF, Markdown) in the **Document Ingestion Zone**.
2. **Database Logging**: An entry is created in PostgreSQL with a `pending` status.
3. **Recursive Chunking**: The text content is recursively split by paragraphs, lines, and words into overlapping chunks (default chunk size: 1000 characters, overlap: 200 characters) to ensure no context is lost at block boundaries.
4. **Vector Embedding**: Each text chunk is mapped to a high-dimensional vector using a local embedding model (`sentence-transformers/all-MiniLM-L6-v2`).
5. **Vector Indexing**: The embeddings, along with the source metadata (filename, chunk index, raw text), are upserted into the Qdrant vector store collection (`kb_documents`).
6. **Audit Update**: The PostgreSQL status is marked as `completed` with the total count of chunks created.

### C. Conversational Retrieval & Reasoning Pipeline (RAG)
1. **Query & Cache Check**: When a user submits a query, the backend computes a normalized query hash and checks the **Redis Cache** first.
   - **Cache Hit**: Returns the cached response and sources immediately, avoiding LLM latency and API costs.
   - **Cache Miss**: Proceeds to full RAG retrieval.
2. **Semantic Vector Search**: The query text is transformed into a vector and queried against the Qdrant index to retrieve the top matching document chunks based on cosine similarity.
3. **Deduplication**: Context chunks are deduplicated by content to avoid crowding out results with duplicate passages.
4. **Prompt Grounding**: A context-constrained instruction prompt is constructed, inserting retrieved source texts and instructing the model to rely *only* on the retrieved files (strict anti-hallucination guardrails).
5. **Gemini Reasoning**: The request is sent to the Google Gemini model (`gemini-3.1-flash-lite`).
6. **SSE Token Streaming**: The response tokens, along with source citation files, are streamed back to the user chunk-by-chunk using **Server-Sent Events (SSE)** for smooth rendering.
7. **Postgres Sync**: The conversation history (User and Assistant messages) is synced to PostgreSQL.
8. **Auto-Renaming**: If a chat session is currently named `"New Conversation"`, a background request is made to Gemini to summarize the query into a concise 4-5 words title, dynamically updating both the page title and the sidebar list in real time.

---

## 2. Pros & Cons of the System

### Pros
- **High Groundedness & Accuracy**: Strict system prompts prevent hallucinations. If no relevant contexts match in Qdrant, the assistant replies: *"No matches found after checking all records."*
- **Blazing Fast UI Performance**: The SSE streaming coupled with Redis response caching makes repeat queries resolve instantly.
- **Robust Security**: Multi-tiered protection utilizing JWT tokens, rate limiting, and Turnstile captcha prevents bots and automated attacks.
- **Dynamic & Collapsible Workspace**: Responsive sidebar context mimics Google Gemini, optimizing screen real estate on both desktop and mobile views.
- **Comprehensive Citation Maps**: Every answer includes interactive citation chips pointing to the source filename and segment indices.

### Cons
- **CPU Embedding Bottleneck**: Local embedding generation runs on a CPU-bound thread, which might experience latency with high concurrent ingestion loads.
- **No Document Parsing Engine**: Uploads currently rely on text extraction; advanced document formats (like scanned images or highly structured spreadsheets) may lose formatting.
- **Single Vector Collection**: All documents are ingested into a shared vector index (`kb_documents`) filtered at search time, rather than isolated user-specific vector namespaces.

---

## 3. Recommended Future Features

1. **Multi-File Batch Ingestion**:
   - Integrate an asynchronous worker framework (e.g., Celery with Redis) to parse, embed, and index large batches of documents in the background without blocking the web application server.
2. **Hybrid Keyword + Semantic Search**:
   - Merge dense semantic embeddings (Qdrant) with sparse keyword queries (BM25 or full-text indices) to improve search accuracy on strict acronyms, usernames, and codes.
3. **Isolated Vector Collections (Multi-Tenancy)**:
   - Partition Qdrant collections or use metadata filtering by user ID to fully isolate vector namespaces between accounts, ensuring maximum security boundaries.
4. **Interactive Document Highlights**:
   - Allow users to click citation chips to open a PDF/text viewer side-by-side with the chat canvas, automatically highlighting the exact passage used for reasoning.
5. **Choice of Reasoning Engines**:
   - Implement a model playground setting, allowing users to toggle between lightweight models (`gemini-3.1-flash-lite`) and premium reasoning engines (`gemini-1.5-pro` or others) depending on query complexity.
