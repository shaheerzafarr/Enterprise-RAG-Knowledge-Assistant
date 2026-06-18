# Toruqx | Production-Grade Secure Enterprise RAG Engine

```
       _____                               
      |_   _|__  _ __ _   _  __ _ __  __   
        | |/ _ \| '__| | | |/ _` |\ \/ /   
        | | (_) | |  | |_| | (_| | >  <    
        |_|\___/|_|   \__,_|\__, |/_/\_\   
                            |___/          
```

**Toruqx** is a production-grade, secure, multi-tenant Retrieval-Augmented Generation (RAG) platform. Built for enterprise compliance and high performance, it couples dense semantic similarity search with sparse keyword search using **Reciprocal Rank Fusion (RRF)**, protects tenant boundaries, handles ingestion asynchronously, and minimizes latency through intelligent Redis query caching.

---

## 🏗️ Architectural Overview

Toruqx is designed with a decoupled full-stack architecture featuring a **Next.js React frontend** and a **FastAPI backend** powered by a suite of enterprise database engines (**PostgreSQL, Qdrant, and Redis**).

```mermaid
graph TD
    Client[Next.js Frontend Client] -->|1. Turnstile & JWT Auth| API_Gateway[FastAPI Backend Server]
    API_Gateway -->|2. Check Cache| Redis[(Redis Caching & Sliding Rate Limiter)]
    
    subgraph Ingestion Pipeline
        API_Gateway -->|3. Spawn Ingestion Task| Ingestion[FastAPI BackgroundTasks]
        Ingestion -->|4. Recursive Text Chunking| Parser[Document PDF/TXT Parser]
        Parser -->|5. Local Embedding Model| SentenceTransformers[SentenceTransformers: all-MiniLM-L6-v2]
        SentenceTransformers -->|6. Upsert Vectors with user_id| Qdrant[(Qdrant Vector Database)]
        Parser -->|7. Log Metadata & Complete Status| Postgres[(PostgreSQL Database)]
    end

    subgraph Retrieval & RAG Pipeline
        API_Gateway -->|8. Fetch Context: Cosine + BM25| Qdrant
        Qdrant -->|9. Apply Reciprocal Rank Fusion RRF| RRF[RRF Ranker k=60]
        RRF -->|10. Grounded System Prompt| Gemini[Google Gemini: gemini-3.1-flash-lite]
        Gemini -->|11. Server-Sent Events Stream| Client
    end
```

---

## ⚡ Core Engineering Highlights

### 🔍 1. Hybrid Search with Reciprocal Rank Fusion (RRF)
To prevent search failures on exact codes, acronyms, or specific usernames that semantic embeddings often misrepresent, Toruqx runs a hybrid search:
- **Dense Vector Search**: Computes cosine similarity matching using `all-MiniLM-L6-v2`.
- **Sparse Keyword Search**: Queries a full-text payload database index on text chunks in Qdrant.
- **RRF Re-ranking**: Results from both searches are combined and scored using Reciprocal Rank Fusion ($k=60$) to build the final grounding prompt context:
  $$R(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$

### 🔒 2. Multi-Tenant Vector & Data Isolation
Security is built into the core datastore namespaces rather than filtered as an afterthought:
- **Relational Level**: PostgreSQL tables enforce relational mappings to specific tenant `user_id` primary keys.
- **Vector Space Level**: Every vector payload in Qdrant contains a `user_id` attribute. Search and scan queries are strictly filtered using Qdrant's payload filters on the authenticated user's ID, preventing vector leakage between corporate accounts.

### ⚙️ 3. Asynchronous Non-Blocking Ingestion
Rather than forcing API threads to wait for slow file decoding, paragraph chunking, embedding generation, and vector indexing, the ingestion endpoint offloads tasks to FastAPI's native background workers.
- The user receives an immediate `201 Created` status with an ingestion job ID.
- The UI polls `/ingestion/status/{id}` dynamically while the background worker processes the files, maintaining responsive server event loops.

### 🚀 4. Performance Optimization & Caching
- **Redis Response Cache**: Repeated queries are hashed and matched against Redis cache keys. Hits resolve in `<10ms`, bypassing vector calculations and LLM generation costs entirely.
- **SSE Response Streaming**: Assistant replies are streamed token-by-token in real time using Server-Sent Events (SSE).
- **Auto-Title Summarization**: Conversations are dynamically renamed on-the-fly using background LLM worker threads summarizing user queries.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14, React 18, Tailwind CSS, TypeScript, Server-Sent Events (SSE) |
| **Backend** | FastAPI, Pydantic v2, SQLAlchemy, Uvicorn, SentenceTransformers |
| **Databases** | Qdrant (Vector Database), PostgreSQL (Relational metadata), Redis (Caching & Rate Limiting) |
| **AI/Reasoning** | Google Gemini API (`gemini-3.1-flash-lite`), HuggingFace Embeddings (`all-MiniLM-L6-v2`) |
| **Security** | Cloudflare Turnstile, PyJWT (HS256 Token Encryption), Redis sliding-window rate limiters |

---

## 🚀 Getting Started

### 1. Prerequisites
- Docker & Docker Compose
- Node.js 18+ & npm
- Python 3.10+

### 2. Launch Datastores (Docker Compose)
Start PostgreSQL, Redis, and Qdrant locally:
```bash
docker-compose up -d
```
Verify the healthcheck statuses of all containers using `docker-compose ps`.

### 3. Setup Backend
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Create a `.env` file in the `backend/` directory:
   ```env
   DATABASE_URL=postgresql+asyncpg://postgres:postgres_secure_password@localhost:5432/rag_db
   REDIS_URL=redis://localhost:6379/0
   QDRANT_URL=http://localhost:6333
   GEMINI_API_KEY=your_gemini_api_key_here
   JWT_SECRET_KEY=generate_a_random_jwt_key_here
   TURNSTILE_SECRET_KEY=your_cloudflare_turnstile_secret_key_here
   BYPASS_TURNSTILE=false
   ```
5. Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --reload
   ```

### 4. Setup Frontend
1. Navigate back to the workspace root:
   ```bash
   cd ..
   ```
2. Install npm modules:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_cloudflare_turnstile_site_key_here
   ```
4. Start the Next.js development server:
   ```bash
   npm run dev
   ```
5. Open your browser and navigate to `http://localhost:3000`.

---

## 🔒 Security & Verification Suite

### Redis Rate Limiter Configuration
Sliding-window rate limiters are configured globally:
- **Registration (`/auth/signup`)**: Max 3 requests / 60 seconds
- **Authentication (`/auth/login`)**: Max 5 requests / 60 seconds

### Automated Verification
Toruqx includes automated testing scripts in the `evaluation/` directory. Run search index tests using:
```bash
python evaluation/check_unique_search.py
```

---

## 📌 API Endpoints

### Authentication
* `POST /auth/signup` - Register a new tenant. (Protected by Cloudflare Turnstile).
* `POST /auth/login` - Authenticate and retrieve a secure JWT session token.

### Document Ingestion
* `POST /ingestion/file` - Upload file for asynchronous ingestion (PDF, TXT, MD).
* `GET /ingestion/list` - Get list of ingested documents associated with the active tenant.
* `GET /ingestion/status/{id}` - Poll background chunking status.
* `DELETE /ingestion/{id}` - Purge an ingested document and delete its corresponding vector embeddings.

### Search & Chat
* `POST /search` - Query hybrid search directly (Cosine + BM25 keyword scroll).
* `POST /chat/query` - Stream grounded RAG responses using Server-Sent Events (SSE).
