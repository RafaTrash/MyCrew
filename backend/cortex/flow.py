"""
Knowledge Flow - Orquestração do pipeline Cortex
"""
import os
import uuid
import asyncio
import json
from datetime import datetime
from typing import Optional, Callable
import httpx
from qdrant_client import QdrantClient

from .schemas import (
    IngestRecommendation, DocumentInfo, ChunkingStrategy, 
    EmbeddingConfig, QdrantIndexConfig, HnswConfig
)

# Environment vars
OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://ollama:11434')
OLLAMA_EMBEDDING_MODEL = os.getenv('EMBEDDING_MODEL', 'nomic-embed-text')
QDRANT_URL = os.getenv('QDRANT_URL', 'http://qdrant:6333')
QDRANT_COLLECTION = os.getenv('QDRANT_COLLECTION', 'mycrew_agent_kb')

# JSON Schema para o output do Cortex (qwen2.5:7b)
CORTEX_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "operation": {"type": "string", "enum": ["ingest"]},
        "document": {
            "type": "object",
            "properties": {
                "filename": {"type": "string"},
                "file_type": {"type": "string"},
                "language": {"type": "string"},
                "estimated_tokens": {"type": "integer"},
                "structure_level": {"type": "string", "enum": ["structured", "semi_structured", "unstructured"]},
                "domain": {"type": "string", "enum": ["general", "technical", "legal", "scientific", "instructional", "scraped"]},
                "notes": {"type": "string"}
            },
            "required": ["filename", "file_type", "language", "estimated_tokens", "structure_level", "domain"]
        },
        "chunking_strategy": {
            "type": "object",
            "properties": {
                "primary": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string"},
                        "reason": {"type": "string"}
                    }
                },
                "parameters": {
                    "type": "object",
                    "properties": {
                        "chunk_size": {"type": "integer"},
                        "chunk_overlap": {"type": "integer"},
                        "separator": {"type": "string"},
                        "min_chunk_size": {"type": "integer"},
                        "max_chunk_size": {"type": "integer"}
                    }
                }
            }
        },
        "embedding": {
            "type": "object",
            "properties": {
                "provider": {"type": "string", "const": "ollama"},
                "model": {"type": "string"},
                "dimensions": {"type": "integer"},
                "normalize": {"type": "boolean"}
            }
        },
        "qdrant_index": {
            "type": "object",
            "properties": {
                "distance": {"type": "string", "enum": ["Cosine", "Euclid", "Manhattan", "Dot"]},
                "hnsw_config": {
                    "type": "object",
                    "properties": {
                        "m": {"type": "integer"},
                        "ef_construct": {"type": "integer"},
                        "ef_search": {"type": "integer"}
                    }
                },
                "payload_index_fields": {"type": "array", "items": {"type": "string"}}
            }
        },
        "retrieval_hint": {"type": "string"},
        "review_required": {"type": "boolean"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
    },
    "required": ["operation", "document", "chunking_strategy", "embedding", "qdrant_index", "retrieval_hint", "review_required", "confidence"]
}

class KnowledgeFlow:
    """Gerencia o fluxo de ingestão de conhecimento com SSE"""
    
    def __init__(self, flow_id: str, user_id: str, file_content: bytes, filename: str):
        self.flow_id = flow_id
        self.user_id = user_id
        self.file_content = file_content
        self.filename = filename
        self._subscribers: list[Callable] = []
        self._document_id: Optional[str] = None
    
    async def emit_step(self, step_id: str, step_name: str, status: str, 
                        output_preview: Optional[str] = None, error_message: Optional[str] = None):
        """Emite evento SSE para todos os subscribers"""
        event = {
            "flow_id": self.flow_id,
            "operation": "ingest",
            "step_id": step_id,
            "step_name": step_name,
            "status": status,
            "output_preview": output_preview,
            "error_message": error_message,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        for callback in self._subscribers:
            await callback(json.dumps(event))
    
    async def analyze_document(self) -> IngestRecommendation:
        """Chama o Cortex (Ollama) para análise do documento"""
        await self.emit_step('extract_metadata', 'Recebendo documento', 'running',
                           f'Arquivo: {self.filename}')
        
        # Extração determinística de metadados básicos
        file_ext = self.filename.lower().split('.')[-1] if '.' in self.filename else 'other'
        file_type_map = {
            'pdf': 'pdf', 'md': 'md', 'txt': 'txt', 
            'docx': 'docx', 'html': 'html', 'csv': 'csv'
        }
        
        # Amostragem do conteúdo (início, meio, fim)
        await self.emit_step('sample_content', 'Amostrando conteúdo', 'running',
                           f'Tamanho: {len(self.file_content)} bytes')
        
        try:
            content = self.file_content.decode('utf-8', errors='replace')
            sample_size = min(2000, len(content))
            sample = content[:sample_size // 2] + content[-sample_size // 2:]
        except:
            sample = "[Arquivo binário]"

        # Chama Ollama com JSON Schema
        await self.emit_step('analyze', 'Analisando com Cortex', 'running',
                           'Qwen2.5 processando...')
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f'{OLLAMA_URL}/api/chat',
                json={
                    "model": 'qwen2.5:7b-instruct',
                    "messages": [{
                        "role": "system",
                        "content": """Você é o Cortex, agente de sistema do MyCrew. 
                        Analise o documento e retorne APENAS JSON válido segundo o schema fornecido."""
                    }, {
                        "role": "user",
                        "content": f"""Documento: {self.filename}
                        Amostra do conteúdo:
                        {sample}
                        
                        Analise e retorne recomendações de chunking, embedding e índice."""
                    }],
                    "format": CORTEX_JSON_SCHEMA,
                    "options": {"temperature": 0}
                }
            )
            
            if response.status_code != 200:
                raise Exception(f'Ollama error: {response.status_code}')
            
            result = response.json()
            
            # Ollama retorna no formato {"message": {"content": "..."}}
            if 'message' in result:
                json_str = result['message']['content']
            else:
                json_str = result.get('content', '{}')
            
            try:
                recommendation = IngestRecommendation.model_validate_json(json_str)
            except:
                # Fallback: tenta parsear como JSON bruto
                data = json.loads(json_str)
                recommendation = IngestRecommendation(**data)
        
        await self.emit_step('validate_schema', 'Validando schema', 'done',
                           'Schema válido ✓')
        
        return recommendation
    
    async def process(self) -> IngestRecommendation:
        """Executa o fluxo completo"""
        try:
            recommendation = await self.analyze_document()
            await self.emit_step('awaiting_confirmation', 'Aguardando confirmação', 'running',
                               'Revise os parâmetros sugeridos')
            return recommendation
        except Exception as e:
            await self.emit_step('analyze', 'Analisando com Cortex', 'error',
                               error_message=str(e))
            raise