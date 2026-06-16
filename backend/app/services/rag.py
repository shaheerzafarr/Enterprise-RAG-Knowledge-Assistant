import uuid
import json
import asyncio
import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.sqlalchemy_models import ChatMessage, ChatSession
from app.services.embedding import embedding_service
from app.services.qdrant import qdrant_service
from app.services.llm import gemini_service
from app.services.redis_cache import redis_service

logger = structlog.get_logger(__name__)

class RAGService:
    @staticmethod
    async def answer_query(
        db: AsyncSession,
        session_id: uuid.UUID,
        query: str,
        limit: int = 5,
        detail_level: str = "normal"
    ) -> dict:
        """
        Retrieves matching contexts from Qdrant, builds a grounded prompt, 
        queries Gemini, and synchronizes the conversation log to PostgreSQL.
        Caches exact queries to Redis to bypass search and inference latency/costs.
        """
        logger.info("Executing grounded RAG pipeline...", session_id=str(session_id), query=query)
        
        # 1. Verify chat session exists
        query_session = select(ChatSession).where(ChatSession.id == session_id)
        result = await db.execute(query_session)
        session = result.scalar_one_or_none()
        if not session:
            raise ValueError(f"Chat session {session_id} not found.")

        # 2. Append User query message to Postgres history
        user_msg = ChatMessage(session_id=session_id, role="user", content=query)
        db.add(user_msg)
        await db.commit()

        # 3. Check Redis cache first (exact query match cache)
        normalized_query = query.strip().lower()
        cache_key = f"rag_cache:{detail_level}:{normalized_query}"
        
        try:
            cached_data = await redis_service.get(cache_key)
            if cached_data:
                logger.info("RAG Cache Hit! Returning cached response.", query=query)
                response_dict = json.loads(cached_data)
                
                # Append Assistant answer message to Postgres history to preserve conversation flow
                assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=response_dict["answer"])
                db.add(assistant_msg)
                await db.commit()
                
                return response_dict
        except Exception as e:
            logger.error("Failed to query Redis cache (falling back to search/LLM)", error=str(e))

        # 4. Cache Miss - Retrieve relevant document chunks from Qdrant
        logger.info("RAG Cache Miss. Querying vector store and LLM...", query=query)
        query_vector = await embedding_service.get_embedding(query)
        # Retrieve more points to allow deduplication of duplicates
        hits = await qdrant_service.search_similarity(
            collection_name="kb_documents",
            query_vector=query_vector,
            limit=limit * 5
        )

        # Deduplicate hits by content text to prevent identical chunks from duplicate file uploads crowding out results
        unique_hits = []
        seen_texts = set()
        for hit in hits:
            text_content = hit["payload"].get("text", "").strip()
            if text_content not in seen_texts:
                seen_texts.add(text_content)
                unique_hits.append(hit)
                if len(unique_hits) >= limit:
                    break
        hits = unique_hits

        # 5. Formulate contextual grounding prompt
        context_str = ""
        sources = []
        
        for hit in hits:
            payload = hit["payload"]
            filename = payload.get("filename", "unknown")
            chunk_text = payload.get("text", "")
            chunk_idx = payload.get("chunk_index", 0)
            
            context_str += f"\n--- Source File: {filename} (Chunk {chunk_idx}) ---\n{chunk_text}\n"
            
            sources.append({
                "filename": filename,
                "chunk_index": chunk_idx,
                "score": hit["score"],
                "text": chunk_text
            })

        system_instruction = (
            "You are a production-grade Enterprise RAG Knowledge Assistant.\n"
            "Analyze and answer the user's question using ONLY the provided contexts below.\n"
            "If the provided contexts do not contain enough information to answer the question, "
            "reply exactly with: 'I cannot answer this question based on the provided enterprise knowledge base.'\n"
            "Do not make up facts, extrapolate, or hallucinate beyond what is explicitly written in the contexts.\n"
        )
        if detail_level == "descriptive":
            system_instruction += (
                "Provide a highly detailed, exhaustive, and in-depth descriptive answer. "
                "Explain the concepts thoroughly, list all relevant details, and provide complete explanations based on the context."
            )
        else:
            system_instruction += (
                "Provide a clear, medium-length response that summarizes the main points concisely "
                "without leaving out key facts, but avoiding unnecessary verbosity."
            )

        prompt = f"Retrieved Contexts:\n{context_str}\n\nUser Question: {query}"

        # 6. Execute LLM call or fallback if no document chunks were retrieved
        if not hits:
            answer = "I cannot answer this question based on the provided enterprise knowledge base."
        else:
            try:
                answer = await gemini_service.generate_response(prompt, system_instruction=system_instruction)
            except Exception as e:
                logger.error("Failed to generate response from Gemini", error=str(e))
                answer = "Error: Failed to obtain a response from the reasoning backend."

        # 7. Append Assistant answer message to Postgres history
        assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=answer)
        db.add(assistant_msg)
        await db.commit()

        # 8. Write response payload to Redis cache (1 hour TTL)
        try:
            response_data = {
                "answer": answer,
                "sources": sources
            }
            await redis_service.set(cache_key, json.dumps(response_data), expire_seconds=3600)
            logger.info("RAG Response written to Redis cache successfully.", query=query)
        except Exception as e:
            logger.error("Failed to write response to Redis cache", error=str(e))

        return {
            "answer": answer,
            "sources": sources
        }

    @staticmethod
    async def stream_query(
        db: AsyncSession,
        session_id: uuid.UUID,
        query: str,
        limit: int = 5,
        detail_level: str = "normal"
    ):
        """
        Retrieves matching contexts from Qdrant, builds a grounded prompt,
        queries Gemini asynchronously using a chunk-by-chunk stream, and yields
        SSE format data events.
        """
        # 1. Verify chat session exists
        query_session = select(ChatSession).where(ChatSession.id == session_id)
        result = await db.execute(query_session)
        session = result.scalar_one_or_none()
        if not session:
            raise ValueError(f"Chat session {session_id} not found.")

        # 2. Append User query message to Postgres history
        user_msg = ChatMessage(session_id=session_id, role="user", content=query)
        db.add(user_msg)
        await db.commit()

        # 3. Check Redis cache first (exact query match cache)
        normalized_query = query.strip().lower()
        cache_key = f"rag_cache:{detail_level}:{normalized_query}"
        
        try:
            cached_data = await redis_service.get(cache_key)
            if cached_data:
                logger.info("RAG Streaming Cache Hit! Returning cached response.", query=query)
                response_dict = json.loads(cached_data)
                
                # Append Assistant answer message to Postgres history
                assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=response_dict["answer"])
                db.add(assistant_msg)
                await db.commit()
                
                # Yield cached sources and stream out cached tokens
                yield f"data: {json.dumps({'type': 'sources', 'sources': response_dict['sources']})}\n\n"
                words = response_dict["answer"].split(" ")
                for i, word in enumerate(words):
                    spacer = " " if i > 0 else ""
                    yield f"data: {json.dumps({'type': 'token', 'content': spacer + word})}\n\n"
                    await asyncio.sleep(0.015)
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return
        except Exception as e:
            logger.error("Failed to query Redis cache (falling back to search/LLM)", error=str(e))

        # 4. Cache Miss - Retrieve relevant document chunks from Qdrant
        logger.info("RAG Streaming Cache Miss. Querying vector store and LLM...", query=query)
        query_vector = await embedding_service.get_embedding(query)
        # Retrieve more points to allow deduplication of duplicates
        hits = await qdrant_service.search_similarity(
            collection_name="kb_documents",
            query_vector=query_vector,
            limit=limit * 5
        )

        # Deduplicate hits by content text to prevent identical chunks from duplicate file uploads crowding out results
        unique_hits = []
        seen_texts = set()
        for hit in hits:
            text_content = hit["payload"].get("text", "").strip()
            if text_content not in seen_texts:
                seen_texts.add(text_content)
                unique_hits.append(hit)
                if len(unique_hits) >= limit:
                    break
        hits = unique_hits

        # 5. Formulate contextual grounding prompt
        context_str = ""
        sources = []
        
        for hit in hits:
            payload = hit["payload"]
            filename = payload.get("filename", "unknown")
            chunk_text = payload.get("text", "")
            chunk_idx = payload.get("chunk_index", 0)
            
            context_str += f"\n--- Source File: {filename} (Chunk {chunk_idx}) ---\n{chunk_text}\n"
            
            sources.append({
                "filename": filename,
                "chunk_index": chunk_idx,
                "score": hit["score"],
                "text": chunk_text
            })

        # Yield retrieved sources first
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

        system_instruction = (
            "You are a production-grade Enterprise RAG Knowledge Assistant.\n"
            "Analyze and answer the user's question using ONLY the provided contexts below.\n"
            "If the provided contexts do not contain enough information to answer the question, "
            "reply exactly with: 'I cannot answer this question based on the provided enterprise knowledge base.'\n"
            "Do not make up facts, extrapolate, or hallucinate beyond what is explicitly written in the contexts.\n"
        )
        if detail_level == "descriptive":
            system_instruction += (
                "Provide a highly detailed, exhaustive, and in-depth descriptive answer. "
                "Explain the concepts thoroughly, list all relevant details, and provide complete explanations based on the context."
            )
        else:
            system_instruction += (
                "Provide a clear, medium-length response that summarizes the main points concisely "
                "without leaving out key facts, but avoiding unnecessary verbosity."
            )

        prompt = f"Retrieved Contexts:\n{context_str}\n\nUser Question: {query}"

        # 6. Execute LLM call or fallback
        if not hits:
            answer = "I cannot answer this question based on the provided enterprise knowledge base."
            yield f"data: {json.dumps({'type': 'token', 'content': answer})}\n\n"
        else:
            answer = ""
            try:
                client = gemini_service.get_client()
                config_params = {"system_instruction": system_instruction}
                
                # Fetch async stream
                response = await client.aio.models.generate_content_stream(
                    model="gemini-3.1-flash-lite",
                    contents=prompt,
                    config=config_params
                )
                
                async for chunk in response:
                    text_chunk = chunk.text
                    if text_chunk:
                        answer += text_chunk
                        yield f"data: {json.dumps({'type': 'token', 'content': text_chunk})}\n\n"
            except Exception as e:
                logger.error("Failed to generate response from Gemini stream", error=str(e))
                err_msg = "Error: Failed to obtain a response from the reasoning backend."
                answer = err_msg
                yield f"data: {json.dumps({'type': 'error', 'content': err_msg})}\n\n"

        # 7. Append Assistant answer message to Postgres history
        assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=answer)
        db.add(assistant_msg)
        await db.commit()

        # 8. Write response payload to Redis cache (1 hour TTL)
        try:
            response_data = {
                "answer": answer,
                "sources": sources
            }
            await redis_service.set(cache_key, json.dumps(response_data), expire_seconds=3600)
            logger.info("RAG Streaming Response written to Redis cache successfully.", query=query)
        except Exception as e:
            logger.error("Failed to write response to Redis cache", error=str(e))

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

rag_service = RAGService()
