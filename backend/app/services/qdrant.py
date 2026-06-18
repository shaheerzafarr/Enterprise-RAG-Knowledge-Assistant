# pyrefly: ignore [missing-import]
from qdrant_client import AsyncQdrantClient
# pyrefly: ignore [missing-import]
from qdrant_client.http import models as qmodels
# pyrefly: ignore [missing-import]
from qdrant_client.http.exceptions import UnexpectedResponse
# pyrefly: ignore [missing-import]
import structlog
import uuid
# pyrefly: ignore [missing-import]
from app.core.config import settings

logger = structlog.get_logger(__name__)

class QdrantService:
    def __init__(self):
        self.client: AsyncQdrantClient | None = None

    async def connect(self) -> None:
        if not self.client:
            logger.info("Initializing connection to Qdrant...", url=settings.QDRANT_URL)
            self.client = AsyncQdrantClient(url=settings.QDRANT_URL)
            # Fetch collections list to verify connectivity
            await self.client.get_collections()
            logger.info("Successfully connected to Qdrant.")

    async def disconnect(self) -> None:
        if self.client:
            logger.info("Closing Qdrant connections...")
            await self.client.close()
            self.client = None
            logger.info("Qdrant connection closed.")

    async def init_collection(self, collection_name: str, vector_size: int = 384) -> None:
        if not self.client:
            raise RuntimeError("Qdrant client is not initialized. Call connect() first.")
        try:
            # Safely check if collection exists by calling get_collection
            try:
                await self.client.get_collection(collection_name)
                logger.info("Qdrant collection already exists.", collection_name=collection_name)
            except (UnexpectedResponse, Exception):
                logger.info("Creating new vector collection in Qdrant...", collection_name=collection_name, vector_size=vector_size)
                await self.client.create_collection(
                    collection_name=collection_name,
                    vectors_config=qmodels.VectorParams(
                        size=vector_size,
                        distance=qmodels.Distance.COSINE
                    )
                )
                logger.info("Vector collection created successfully.", collection_name=collection_name)
            
            # Ensure text field is full-text indexed for keyword search queries
            await self.client.create_payload_index(
                collection_name=collection_name,
                field_name="text",
                field_schema=qmodels.TextIndexParams(
                    type="text",
                    tokenizer=qmodels.TokenizerType.WORD,
                    min_token_len=2,
                    lowercase=True
                )
            )
            logger.info("Qdrant text payload index verified/created.", collection_name=collection_name)
        except Exception as e:
            logger.error("Failed to initialize Qdrant collection", collection_name=collection_name, error=str(e))
            raise e

    async def search_similarity(
        self,
        collection_name: str,
        query_vector: list[float],
        limit: int = 3,
        user_id: uuid.UUID | None = None,
        document_id: str | None = None
    ) -> list[dict]:
        if not self.client:
            raise RuntimeError("Qdrant client is not initialized. Call connect() first.")
        
        # Build filter if user_id or document_id is specified
        must_filters = []
        if user_id:
            must_filters.append(
                qmodels.FieldCondition(
                    key="user_id",
                    match=qmodels.MatchValue(value=str(user_id))
                )
            )
        if document_id:
            must_filters.append(
                qmodels.FieldCondition(
                    key="document_id",
                    match=qmodels.MatchValue(value=document_id)
                )
            )
            
        search_filter = qmodels.Filter(must=must_filters) if must_filters else None

        try:
            response = await self.client.query_points(
                collection_name=collection_name,
                query=query_vector,
                query_filter=search_filter,
                limit=limit
            )
            
            # Convert hits to structured output
            return [
                {
                    "id": str(hit.id),
                    "score": hit.score,
                    "payload": hit.payload
                }
                for hit in response.points
            ]
        except Exception as e:
            logger.error("Similarity search in Qdrant failed", collection=collection_name, error=str(e))
            raise e

    async def search_hybrid(
        self,
        collection_name: str,
        query_vector: list[float],
        query_text: str,
        limit: int = 3,
        user_id: uuid.UUID | None = None,
        document_id: str | None = None
    ) -> list[dict]:
        """
        Hybrid search combining semantic search and full-text keyword filter search.
        Ranks results using Reciprocal Rank Fusion (RRF) with constant k = 60.
        """
        if not self.client:
            raise RuntimeError("Qdrant client is not initialized. Call connect() first.")
            
        # 1. Build common user/document filter constraints
        must_filters = []
        if user_id:
            must_filters.append(
                qmodels.FieldCondition(
                    key="user_id",
                    match=qmodels.MatchValue(value=str(user_id))
                )
            )
        if document_id:
            must_filters.append(
                qmodels.FieldCondition(
                    key="document_id",
                    match=qmodels.MatchValue(value=document_id)
                )
            )
            
        search_filter = qmodels.Filter(must=must_filters) if must_filters else None
        
        # 2. Run Semantic Vector Search
        semantic_hits = []
        try:
            response = await self.client.query_points(
                collection_name=collection_name,
                query=query_vector,
                query_filter=search_filter,
                limit=limit * 2  # Retrieve extra candidates for RRF ranking
            )
            semantic_hits = [
                {
                    "id": str(hit.id),
                    "score": hit.score,
                    "payload": hit.payload
                }
                for hit in response.points
            ]
        except Exception as e:
            logger.error("Semantic search branch failed in hybrid retrieval", error=str(e))
            
        # 3. Run Keyword Search (Qdrant Full-Text Matching)
        keyword_hits = []
        try:
            keyword_must_filters = must_filters.copy()
            keyword_must_filters.append(
                qmodels.FieldCondition(
                    key="text",
                    match=qmodels.MatchText(text=query_text)
                )
            )
            keyword_filter = qmodels.Filter(must=keyword_must_filters)
            
            scroll_response = await self.client.scroll(
                collection_name=collection_name,
                scroll_filter=keyword_filter,
                limit=limit * 2,
                with_payload=True,
                with_vectors=False
            )
            keyword_hits = [
                {
                    "id": str(point.id),
                    "score": 1.0,  # scroll results are rank ordered, assign dummy baseline score
                    "payload": point.payload
                }
                for point in scroll_response[0]
            ]
        except Exception as e:
            logger.error("Keyword search branch failed in hybrid retrieval", error=str(e))
            
        # 4. Perform Reciprocal Rank Fusion (RRF) with constant k = 60
        rrf_scores = {}
        unique_points = {}
        
        # Add semantic rankings
        for rank, hit in enumerate(semantic_hits, start=1):
            hit_id = hit["id"]
            rrf_scores[hit_id] = rrf_scores.get(hit_id, 0.0) + 1.0 / (60.0 + rank)
            unique_points[hit_id] = hit
            
        # Add keyword rankings
        for rank, hit in enumerate(keyword_hits, start=1):
            hit_id = hit["id"]
            rrf_scores[hit_id] = rrf_scores.get(hit_id, 0.0) + 1.0 / (60.0 + rank)
            if hit_id not in unique_points:
                unique_points[hit_id] = hit
                
        # Sort all unique points by combined RRF score descending
        sorted_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)
        
        # Format and restrict top limit items
        merged_results = []
        for hit_id in sorted_ids[:limit]:
            hit = unique_points[hit_id]
            hit["score"] = rrf_scores[hit_id]
            merged_results.append(hit)
            
        logger.info(
            "Hybrid search RRF completed",
            semantic_candidates=len(semantic_hits),
            keyword_candidates=len(keyword_hits),
            merged_count=len(merged_results)
        )
        return merged_results

    async def delete_document(self, collection_name: str, document_id: str) -> None:
        if not self.client:
            raise RuntimeError("Qdrant client is not initialized. Call connect() first.")
        try:
            logger.info("Deleting vector points in Qdrant...", collection=collection_name, document_id=document_id)
            await self.client.delete(
                collection_name=collection_name,
                points_selector=qmodels.FilterSelector(
                    filter=qmodels.Filter(
                        must=[
                            qmodels.FieldCondition(
                                key="document_id",
                                match=qmodels.MatchValue(value=document_id)
                            )
                        ]
                    )
                )
            )
            logger.info("Vector points deleted successfully in Qdrant.", collection=collection_name, document_id=document_id)
        except Exception as e:
            logger.error("Failed to delete points in Qdrant", collection=collection_name, document_id=document_id, error=str(e))
            raise e

    async def ping(self) -> bool:
        if not self.client:
            return False
        try:
            await self.client.get_collections()
            return True
        except Exception:
            return False

qdrant_service = QdrantService()
