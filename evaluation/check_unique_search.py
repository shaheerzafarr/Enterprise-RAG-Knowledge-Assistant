import asyncio
import sys
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(script_dir, "..", "backend"))
sys.path.append(backend_dir)

from dotenv import load_dotenv  
load_dotenv(dotenv_path=os.path.join(backend_dir, ".env"))

from app.services.qdrant import qdrant_service
from app.services.embedding import embedding_service

async def run():
    await qdrant_service.connect()
    
    query = "Technical content like Big-O notation, CAP theorem, Python snippets — tests retrieval on mixed prose/code chunks."
    print(f"Query: '{query}'")
    
    query_vector = await embedding_service.get_embedding(query)
    
    # Retrieve 100 points
    hits = await qdrant_service.search_similarity(
        collection_name="kb_documents",
        query_vector=query_vector,
        limit=100
    )
    
    # Deduplicate by filename + chunk_index
    unique_hits = []
    seen = set()
    for h in hits:
        payload = h["payload"]
        filename = payload.get("filename")
        chunk_idx = payload.get("chunk_index")
        key = (filename, chunk_idx)
        if key not in seen:
            seen.add(key)
            unique_hits.append(h)
            
    print(f"\nTop 10 Unique similarity hits:")
    for i, h in enumerate(unique_hits[:10]):
        payload = h["payload"]
        print(f"{i+1}. Score: {h['score']:.4f} | Filename: {payload.get('filename')} | Chunk: {payload.get('chunk_index')}")
        print(f"   Text: {payload.get('text')[:200].strip()}...")
        print("-" * 80)

if __name__ == "__main__":
    asyncio.run(run())
