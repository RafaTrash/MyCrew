"""
Schemas Pydantic para o serviço Cortex (Knowledge Flow)
"""
from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum

# Enums
class FileType(str, Enum):
    pdf = 'pdf'
    md = 'md'
    txt = 'txt'
    docx = 'docx'
    html = 'html'
    csv = 'csv'
    code = 'code'
    other = 'other'

class StructureLevel(str, Enum):
    structured = 'structured'
    semi_structured = 'semi_structured'
    unstructured = 'unstructured'

class Domain(str, Enum):
    general = 'general'
    technical = 'technical'
    legal = 'legal'
    scientific = 'scientific'
    instructional = 'instructional'
    scraped = 'scraped'

class ChunkingStrategyType(str, Enum):
    fixed_size = 'fixed_size'
    sentence = 'sentence'
    paragraph = 'paragraph'
    sliding_window = 'sliding_window'
    recursive = 'recursive'
    semantic = 'semantic'
    markdown_header = 'markdown_header'
    table_aware = 'table_aware'
    code_aware = 'code_aware'
    hybrid = 'hybrid'

class Distance(str, Enum):
    cosine = 'Cosine'
    euclid = 'Euclid'
    manhattan = 'Manhattan'
    dot = 'Dot'

# Schemas de entrada

class KnowledgeIngestRequest(BaseModel):
    name: str
    description: Optional[str] = None
    tags: Optional[str] = None  # Comma-separated string

class ChunkingParameters(BaseModel):
    chunk_size: int = Field(default=512, ge=100, le=2048)
    chunk_overlap: int = Field(default=64, ge=0)
    separator: str = Field(default='\n\n')
    min_chunk_size: int = Field(default=100)
    max_chunk_size: int = Field(default=1024)

class ChunkingStrategyUpdate(BaseModel):
    primary: Optional[dict] = None
    parameters: Optional[ChunkingParameters] = None

class ConfirmIngestRequest(BaseModel):
    flow_id: str
    chunking_strategy: Optional[ChunkingStrategyUpdate] = None
    embedding: Optional[dict] = None
    qdrant_index: Optional[dict] = None

# Schemas de saída - Ingest Recommendation (Fase 1)

class DocumentInfo(BaseModel):
    filename: str
    file_type: str
    language: str
    estimated_tokens: int
    structure_level: str
    domain: str
    notes: Optional[str] = None

class ChunkingStrategy(BaseModel):
    primary: dict
    alternative: Optional[dict] = None
    parameters: ChunkingParameters

class EmbeddingConfig(BaseModel):
    provider: str = 'ollama'
    model: str
    dimensions: int
    normalize: bool = True

class HnswConfig(BaseModel):
    m: int = Field(default=16)
    ef_construct: int = Field(default=128)
    ef_search: int = Field(default=96)

class QdrantIndexConfig(BaseModel):
    distance: Distance
    hnsw_config: HnswConfig
    payload_index_fields: list[str]

class IngestRecommendation(BaseModel):
    operation: Literal['ingest'] = 'ingest'
    document: DocumentInfo
    chunking_strategy: ChunkingStrategy
    embedding: EmbeddingConfig
    qdrant_index: QdrantIndexConfig
    retrieval_hint: str
    review_required: bool
    confidence: float = Field(ge=0.0, le=1.0)

# Schemas de saída - Quality Report (Fase 2)

class IngestionSummary(BaseModel):
    total_nodes: int
    total_vectors: int
    avg_chunk_size: float
    chunk_size_stddev: float
    undersized_chunks: int
    oversized_chunks: int

class QualityMetrics(BaseModel):
    avg_neighbor_distance: float
    avg_similarity_to_source: float
    estimated_recall_at_k: Optional[float] = None
    estimated_precision_at_k: Optional[float] = None

class QualityReport(BaseModel):
    operation: Literal['quality_report'] = 'quality_report'
    ingestion_summary: IngestionSummary
    quality_metrics: QualityMetrics
    performance: dict
    index_config_used: dict
    summary_text: str
    warnings: list[str]

# Schema para evento SSE

class KnowledgeFlowEvent(BaseModel):
    flow_id: str
    operation: Literal['ingest', 'query', 'quality_report']
    step_id: str
    step_name: str
    status: Literal['pending', 'running', 'done', 'error']
    output_preview: Optional[str] = None
    error_message: Optional[str] = None
    timestamp: str