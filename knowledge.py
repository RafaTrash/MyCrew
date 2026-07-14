import json
from typing import List, Dict

from fastapi import HTTPException
from qdrant_client import QdrantClient
from qdrant_client.http.models import PointStruct

from .database import get_db_connection, get_db_cursor
from .schemas import KnowledgeAttachRequest

QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
QDRANT_COLLECTION_NAME = "mycrew_kb"

def attach_knowledge_to_agent(request: KnowledgeAttachRequest):
    """Attach knowledge to an agent in Qdrant."""
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    
    try:
        # Load the knowledge file
        with open(request.file_path, 'r') as file:
            content = file.read()
        
        # Parse the content as JSON
        data = json.loads(content)
        
        # Extract points from the JSON data
        points: List[PointStruct] = []
        for item in data.get('items', []):
            point = PointStruct(
                id=item['id'],
                vector=item['vector'],
                payload=item['payload']
            )
            points.append(point)
        
        # Add points to Qdrant collection
        client.upsert(collection_name=QDRANT_COLLECTION_NAME, points=points)
        
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {e}")

def get_knowledge_from_agent(agent_id: str):
    """Retrieve knowledge from Qdrant for a specific agent."""
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    
    try:
        result = client.search(
            collection_name=QDRANT_COLLECTION_NAME,
            query_vector=[0.0] * 128,  # Placeholder vector
            limit=10
        )
        
        return result
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {e}")
