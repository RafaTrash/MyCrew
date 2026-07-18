"""
Knowledge schemas - Knowledge ingestion and processing payloads
"""
from pydantic import BaseModel
from typing import Optional


class KnowledgeIngestRequest(BaseModel):
    """Request for knowledge ingestion - uses Form data in the endpoint"""
    name: str
    description: str


class ConfirmIngestRequest(BaseModel):
    """Request to confirm knowledge ingestion and start indexing"""
    flow_id: str
    chunking_strategy: Optional[dict] = None


class KnowledgeDocumentResponse(BaseModel):
    """Response for knowledge document operations"""
    document_id: str
    status: str
    message: str = "Success"


__all__ = [
    "KnowledgeIngestRequest",
    "ConfirmIngestRequest",
    "KnowledgeDocumentResponse"
]