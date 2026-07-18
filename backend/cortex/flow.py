"""
Knowledge Flow - Orquestração do pipeline Cortex
"""
import os
import uuid
import asyncio
import json
import re
import logging
from datetime import datetime
from typing import Optional, Callable
import httpx
from qdrant_client import QdrantClient, models
from sqlalchemy import create_engine, text

from .schemas import IngestRecommendation

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://ollama:11434')
OLLAMA_EMBEDDING_MODEL = os.getenv('EMBEDDING_MODEL', 'nomic-embed-text:latest')
OLLAMA_CORTEX_MODEL = os.getenv('CORTEX_MODEL', 'qwen2.5:7b-instruct')
QDRANT_URL = os.getenv('QDRANT_URL', 'http://qdrant:6333')
QDRANT_COLLECTION = os.getenv('QDRANT_COLLECTION', 'mycrew_agent_kb')

def extract_json_from_response(content: str) -> str:
    content = re.sub(r'```json\s*', '', content)
    content = re.sub(r'```\s*', '', content)
    json_match = re.search(r'\{[\s\S]*\}', content)
    return json_match.group(0) if json_match else content

def fill_defaults(data: dict) -> dict:
    if 'confidence' in data and isinstance(data['confidence'], (int, float)) and data['confidence'] > 1:
        data['confidence'] = data['confidence'] / 100.0
    if 'chunking_strategy' not in data or not data['chunking_strategy']:
        data['chunking_strategy'] = {'primary': {'type': 'paragraph', 'reason': 'Padrao geral'}, 'parameters': {'chunk_size': 512, 'chunk_overlap': 64, 'separator': '\n\n', 'min_chunk_size': 100, 'max_chunk_size': 1024}}
    elif 'parameters' not in data['chunking_strategy']:
        data['chunking_strategy']['parameters'] = {'chunk_size': 512, 'chunk_overlap': 64, 'separator': '\n\n', 'min_chunk_size': 100, 'max_chunk_size': 1024}
    elif 'primary' not in data['chunking_strategy']:
        data['chunking_strategy']['primary'] = {'type': 'paragraph', 'reason': 'Padrao geral'}
    if 'embedding' not in data or not data['embedding']:
        data['embedding'] = {'provider': 'ollama', 'model': OLLAMA_EMBEDDING_MODEL, 'dimensions': 768, 'normalize': True}
    if 'qdrant_index' not in data or not data['qdrant_index']:
        data['qdrant_index'] = {'distance': 'Cosine', 'hnsw_config': {'m': 16, 'ef_construct': 128, 'ef_search': 96}, 'payload_index_fields': []}
    elif 'hnsw_config' not in data['qdrant_index']:
        data['qdrant_index']['hnsw_config'] = {'m': 16, 'ef_construct': 128, 'ef_search': 96}
    elif 'payload_index_fields' not in data['qdrant_index']:
        data['qdrant_index']['payload_index_fields'] = []
    return data

def format_duration(ms: int) -> str:
    if ms < 60000: return f"{ms // 1000}s"
    elif ms < 3600000: return f"{ms // 60000}m {ms % 60000 // 1000}s"
    return f"{ms // 3600000}h {(ms % 3600000) // 60000}m"

def chunk_text(content: str, strategy_type: str, params: dict) -> list:
    chunk_size = params.get('chunk_size', 512)
    chunk_overlap = params.get('chunk_overlap', 64)
    separator = params.get('separator', '\n\n')
    if strategy_type == 'paragraph':
        paragraphs = content.split(separator)
        chunks, current = [], ""
        for para in paragraphs:
            para = para.strip()
            if not para: continue
            if len(current) // 4 + len(para) // 4 > chunk_size and current:
                chunks.append(current.strip())
                current = current[-(chunk_overlap * 4):] + "\n\n" + para
            else:
                current = current + "\n\n" + para if current else para
        if current.strip(): chunks.append(current.strip())
        return chunks if chunks else [content[:chunk_size * 4]]
    elif strategy_type == 'fixed_size':
        return [content[i:i + chunk_size * 4] for i in range(0, len(content), (chunk_size - chunk_overlap) * 4)]
    elif strategy_type == 'sentence':
        sentences = re.split(r'[.!?]+', content)
        chunks, current = [], ""
        for sent in sentences:
            sent = sent.strip()
            if not sent: continue
            if len(current) // 4 + len(sent) // 4 > chunk_size and current:
                chunks.append(current.strip())
                current = sent
            else:
                current = current + ". " + sent if current else sent
        if current.strip(): chunks.append(current.strip())
        return chunks if chunks else [content[:chunk_size * 4]]
    return [content[i:i + chunk_size * 4] for i in range(0, len(content), (chunk_size - chunk_overlap) * 4)]

def get_fallback_recommendation(filename: str, language: str, char_count: int, error: str = "") -> dict:
    return {
        "operation": "ingest",
        "document": {"filename": filename, "file_type": "txt", "language": language, "estimated_tokens": char_count // 4, "structure_level": "semi_structured", "domain": "general"},
        "chunking_strategy": {"primary": {"type": "paragraph", "reason": "Fallback automatico"}, "parameters": {"chunk_size": 512, "chunk_overlap": 64, "separator": "\n\n"}},
        "embedding": {"provider": "ollama", "model": OLLAMA_EMBEDDING_MODEL, "dimensions": 768, "normalize": True},
        "qdrant_index": {"distance": "Cosine", "hnsw_config": {"m": 16, "ef_construct": 128, "ef_search": 96}, "payload_index_fields": []},
        "retrieval_hint": f"Estrategia fallback ativada{f' - {error}' if error else ''}",
        "testing_questions": ["Que tipo de informacoes procurar?"],
        "review_required": False,
        "confidence": 0.5
    }

# Database engine for usage tracking
_engine = None

def _get_engine():
    global _engine
    if _engine is None:
        POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
        POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
        POSTGRES_USER = os.getenv("POSTGRES_USER", "mycrew")
        POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
        POSTGRES_DB = os.getenv("POSTGRES_DB", "mycrew")
        DATABASE_URL = os.getenv("DATABASE_URL", f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}")
        _engine = create_engine(DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://"), echo=False)
    return _engine


class KnowledgeFlow:
    def __init__(self, flow_id: str, user_id: str, file_content: bytes, filename: str, cortex_prompt: str = ""):
        self.flow_id = flow_id
        self.user_id = user_id
        self.file_content = file_content
        self.filename = filename
        self._cortex_prompt = cortex_prompt
        self._subscribers = []
        self._recommendation = None
        self._event_buffer = []
        self._step_times = {}
        self._step_start = None
        self._content = None
        self._chunks = []
        self._last_ollama_metrics = None  # Store metrics for Cortex persistence
        self._embedding_metrics = None  # Store metrics for embedding persistence
        self._flow_start_time = datetime.utcnow().timestamp()  # Start timing for processing
        self._flow_end_time = None  # Will be set at end of processing
        self._embedding_latency_ms = 0  # Track embedding latency separately

    async def emit_step(self, step_id: str, step_name: str, status: str,
                        output_preview: Optional[str] = None, error_message: Optional[str] = None,
                        recommendation: Optional[dict] = None, start_timing: bool = True):
        duration_ms = int((datetime.utcnow().timestamp() - self._step_start) * 1000) if self._step_start else 0
        self._step_start = datetime.utcnow().timestamp() if start_timing else None
        event = {"flow_id": self.flow_id, "operation": "ingest", "step_id": step_id, "step_name": step_name, "status": status,
                 "output_preview": output_preview, "error_message": error_message, "duration_ms": duration_ms,
                 "duration_formatted": format_duration(duration_ms), "timestamp": datetime.utcnow().isoformat() + "Z"}
        if recommendation: event["recommendation"] = recommendation
        event_json = json.dumps(event)
        self._event_buffer.append(event_json)
        for callback in self._subscribers:
            await callback(event_json)

    async def _call_cortex_model(self, content: str, language: str) -> tuple[dict, dict]:
        """Chama o modelo Cortex via Ollama para analisar o documento."""
        start_time = datetime.utcnow().timestamp()
        
        # Constrói o prompt para análise
        system_prompt = """Você é Cortex, um especialista em análise de documentos para indexação em bases de conhecimento.
Sua tarefa é analisar o conteúdo do documento e retornar uma recomendação estruturada para chunking, embedding e indexação.

Retorne APENAS um JSON válido com a seguinte estrutura:
{
  "operation": "ingest",
  "document": {
    "filename": "nome_do_arquivo",
    "file_type": "txt",
    "language": "pt",
    "estimated_tokens": 123,
    "structure_level": "structured|semi_structured|unstructured",
    "domain": "technical|legal|medical|general|etc"
  },
  "chunking_strategy": {
    "primary": {"type": "paragraph|sentence|fixed_size", "reason": "..."},
    "parameters": {"chunk_size": 512, "chunk_overlap": 64, "separator": "\\n\\n", "min_chunk_size": 100, "max_chunk_size": 1024}
  },
  "embedding": {"provider": "ollama", "model": "nomic-embed-text", "dimensions": 768, "normalize": true},
  "qdrant_index": {"distance": "Cosine", "hnsw_config": {"m": 16, "ef_construct": 128, "ef_search": 96}, "payload_index_fields": []},
  "retrieval_hint": "Dica para recuperação eficaz deste conteúdo...",
  "testing_questions": ["Pergunta 1?", "Pergunta 2?"],
  "review_required": false,
  "confidence": 0.85
}"""

        user_prompt = f"""Analise este documento para recomendações de indexação:

Idioma detectado: {language}
Conteúdo (primeiros 4000 tokens):
{content[:8000]}

Forneça a melhor estratégia de chunking baseada na estrutura do conteúdo."""

        full_prompt = self._cortex_prompt + "\n\n" + system_prompt + "\n\n" + user_prompt if self._cortex_prompt else system_prompt + "\n\n" + user_prompt

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f'{OLLAMA_URL}/api/generate',
                    json={
                        "model": OLLAMA_CORTEX_MODEL,
                        "prompt": full_prompt,
                        "stream": False,
                        "options": {"temperature": 0.3, "num_predict": 1024}
                    }
                )
                
                if response.status_code != 200:
                    raise Exception(f"Ollama retornou status {response.status_code}")
                
                result = response.json()
                raw_content = result.get('response', '')
                
                # Extrai JSON da resposta
                json_str = extract_json_from_response(raw_content)
                rec_data = json.loads(json_str)
                
                # Preenche defaults se faltarem campos
                rec_data = fill_defaults(rec_data)
                
                # Atualiza info do documento
                rec_data['document']['filename'] = self.filename
                rec_data['document']['language'] = language
                rec_data['document']['estimated_tokens'] = len(content) // 4
                
                end_time = datetime.utcnow().timestamp()
                ollama_metrics = {
                    "total_ms": int((end_time - start_time) * 1000),
                    "tokens_generated": result.get('eval_count', 0),
                    "throughput_tps": round(result.get('eval_count', 0) / max((end_time - start_time), 0.001), 2)
                }
                
                return rec_data, ollama_metrics
                
        except Exception as e:
            logger.warning(f"[Cortex] Falha na chamada ao Ollama, usando fallback: {e}")
            rec_data = get_fallback_recommendation(self.filename, language, len(content), str(e))
            return rec_data, {"total_ms": 0, "tokens_generated": 0, "throughput_tps": 0}

    async def analyze_document(self) -> IngestRecommendation:
        try:
            content = self.file_content.decode('utf-8', errors='replace')
            self._content = content
            char_count, word_count = len(content), len(content.split())
        except Exception:
            content = "[Arquivo binario]"
            self._content = content
            char_count, word_count = len(self.file_content), 0

        detected_language = 'pt'
        words = {'pt': ['de','do','da','e','o','a','que','para','com','por','em','no','na','se','um','uma'],
                 'en': ['the','and','this','that','is','are','you','we','they','for','with','from'],
                 'es': ['el','la','los','las','de','que','es','un','una','en','por','con'],
                 'fr': ['le','la','les','un','une','que','est','vous','dans']}
        content_lower = content.lower()
        counts = {lang: sum(1 for w in word_list if w in content_lower) for lang, word_list in words.items()}
        if counts['en'] > counts['pt'] + 5: detected_language = 'en'
        elif counts['es'] > counts['pt'] + 5: detected_language = 'es'
        elif counts['fr'] > counts['pt'] + 5: detected_language = 'fr'

        await self.emit_step('extract_metadata', 'Recebendo documento', 'running', f'Preparando...')
        await self.emit_step('extract_metadata', 'Recebendo documento', 'done', f'{self.filename}')
        await self.emit_step('collecting_samples', 'Coletando amostras', 'running', 'Analisando...')
        await asyncio.sleep(0.05)
        await self.emit_step('collecting_samples', 'Coletando amostras', 'done', f'{char_count} chars, {word_count} palavras')
        
        # Emite evento running antes da chamada pesada ao Ollama
        await self.emit_step('analyze', 'Analisando com Cortex', 'running', 'Processando...')
        # Delay crucial para dar tempo ao SSE conectar e receber o evento running
        await asyncio.sleep(0.2)

        # Chama o modelo Cortex via Ollama
        logger.info(f"[Cortex] Analisando {self.filename} com modelo {OLLAMA_CORTEX_MODEL}")
        rec_data, ollama_metrics = await self._call_cortex_model(content, detected_language)
        
        # Store metrics for later persistence
        self._last_ollama_metrics = ollama_metrics

        recommendation = IngestRecommendation(**rec_data)
        self._recommendation = recommendation.model_dump()
        await self.emit_step('analyze', 'Analisando com Cortex', 'done', f'{ollama_metrics["total_ms"]}ms', recommendation={"ollama_metrics": ollama_metrics})
        await self.emit_step('validate_schema', 'Validando schema', 'done', 'OK')
        
        # Save usage metrics immediately after Cortex analysis (before user confirms)
        # This ensures we track Ollama/Cortex usage even if user cancels
        await self.save_ollama_usage()
        
        return recommendation

    async def process(self) -> IngestRecommendation:
        recommendation = await self.analyze_document()
        await self.emit_step('awaiting_confirmation', 'Aguardando confirmacao', 'done', 'Revise os parametros', recommendation=self._recommendation)
        return recommendation

    async def continue_after_confirmation(self, chunking_params: Optional[dict] = None, document_id: str = ""):
        # Set flow end time when processing starts
        self._flow_end_time = datetime.utcnow().timestamp()
        
        await self.emit_step('chunking', 'Indexando', 'running', 'Dividindo...')
        if not self._content: self._content = self.file_content.decode('utf-8', errors='replace')
        params = chunking_params or self._recommendation.get('chunking_strategy', {}).get('parameters', {})
        strategy = self._recommendation.get('chunking_strategy', {}).get('primary', {}).get('type', 'paragraph')
        self._chunks = chunk_text(self._content, strategy, params)
        await self.emit_step('chunking', 'Indexando', 'done', f'{len(self._chunks)} chunks')

        await self.emit_step('embedding', 'Gerando embeddings', 'running', 'Criando vetores...')
        qc = None
        embedding_tokens = 0
        embedding_start = datetime.utcnow().timestamp()
        try:
            qc = QdrantClient(url=QDRANT_URL, prefer_grpc=False)
        except Exception: qc = None

        if qc and self._chunks:
            try:
                dims = self._recommendation.get('embedding', {}).get('dimensions', 768)
                qc.recreate_collection(collection_name=QDRANT_COLLECTION, vectors_config=models.VectorParams(size=dims, distance=models.Distance.COSINE))
                embeddings = [[0] * 768 for _ in self._chunks]
                for i, chunk in enumerate(self._chunks):
                    try:
                        async with httpx.AsyncClient(timeout=30.0) as client:
                            r = await client.post(f'{OLLAMA_URL}/api/embeddings', json={"model": OLLAMA_EMBEDDING_MODEL, "prompt": chunk})
                            if r.status_code == 200:
                                embeddings[i] = r.json().get('embedding', [0] * 768)
                                # Track embedding tokens
                                embedding_tokens += len(chunk) // 4
                    except Exception: pass
                points = [models.PointStruct(id=str(uuid.uuid4()), vector=emb, payload={"flow_id": self.flow_id, "chunk_index": i, "content": c[:500], "filename": self.filename}) for i, (c, emb) in enumerate(zip(self._chunks, embeddings))]
                if points: qc.upsert(collection_name=QDRANT_COLLECTION, points=points)
            except Exception as e:
                logger.error(f"[Qdrant] Erro: {e}")
        
        # Collect embedding metrics
        total_embedding_tokens = sum(len(chunk) // 4 for chunk in self._chunks) if self._chunks else 0
        self._embedding_metrics = {
            "total_ms": self._embedding_latency_ms,
            "tokens_generated": total_embedding_tokens
        }
        self._total_embedding_tokens = total_embedding_tokens  # Store for report
        
        await self.emit_step('embedding', 'Gerando embeddings', 'done', f'{self._embedding_latency_ms}ms')
        await self.emit_step('done', 'Concluido', 'done', 'Documento indexado!')
        
        # Save usage metrics for both models
        await self.save_ollama_usage(for_embedding=True)
        
        # Generate and persist ingestion report
        await self._save_ingestion_report(document_id)
    
    async def _save_ingestion_report(self, document_id: str) -> None:
        """Save comprehensive ingestion report to knowledge_ingestion_report table."""
        try:
            engine = _get_engine()
            with engine.connect() as conn:
                # Get embedding model name
                embedding_model_result = conn.execute(text("""
                    SELECT name FROM models WHERE user_id = :user_id AND kind = 'embedding' LIMIT 1
                """), {"user_id": self.user_id}).fetchone()
                
                embedding_model_name = embedding_model_result[0] if embedding_model_result else OLLAMA_EMBEDDING_MODEL
                
                # Calculate timing
                processing_time_ms = int((self._flow_end_time - self._flow_start_time) * 1000) if self._flow_end_time and self._flow_start_time else 0
                
                # Build report
                report = {
                    "filename": self.filename,
                    "file_type": "txt",
                    "language": self._recommendation.get("document", {}).get("language", "pt"),
                    "char_count": len(self._content) if self._content else 0,
                    "word_count": len(self._content.split()) if self._content else 0,
                    "chunk_count": len(self._chunks),
                    "chunking_strategy": self._recommendation.get("chunking_strategy", {}),
                "embedding": {
                    "model": embedding_model_name,
                    "tokens": getattr(self, '_total_embedding_tokens', 0),
                    "latency_ms": self._embedding_latency_ms
                },
                    "cortex": {
                        "model": OLLAMA_CORTEX_MODEL,
                        "tokens_generated": self._last_ollama_metrics.get("tokens_generated", 0) if self._last_ollama_metrics else 0,
                        "latency_ms": self._last_ollama_metrics.get("total_ms", 0) if self._last_ollama_metrics else 0
                    },
                    "processing_time_ms": processing_time_ms,
                    "status": "done",
                    "completed_at": datetime.utcnow().isoformat() + "Z"
                }
                
                conn.execute(text("""
                    INSERT INTO knowledge_ingestion_report (document_id, report)
                    VALUES (:document_id, :report)
                """), {
                    "document_id": document_id,
                    "report": json.dumps(report)
                })
                conn.commit()
                logger.info(f"[IngestionReport] Saved report for document {document_id}")
        except Exception as e:
            logger.error(f"[IngestionReport] Failed to save report: {e}")

    async def save_ollama_usage(self, for_embedding: bool = False) -> None:
        """Persist ollama usage metrics to providers_usage table."""
        try:
            engine = _get_engine()
            with engine.connect() as conn:
                # Get Ollama provider ID
                provider_result = conn.execute(text("""
                    SELECT id FROM providers WHERE slug = 'ollama'
                """)).fetchone()
                
                if not provider_result:
                    logger.warning("[ProvidersUsage] Ollama provider not found, skipping usage save")
                    return
                
                provider_id = provider_result[0]
                
                # Determine which model to record usage for
                task = 'embedding' if for_embedding else 'knowledge_analysis'
                
                # For embedding, fetch the embedding model dynamically from DB
                if for_embedding:
                    embedding_model = conn.execute(text("""
                        SELECT id, name FROM models 
                        WHERE user_id = :user_id AND kind = 'embedding' 
                        LIMIT 1
                    """), {"user_id": self.user_id}).fetchone()
                    
                    if embedding_model:
                        model_id, model_name = embedding_model[0], embedding_model[1]
                        metrics = self._embedding_metrics
                    else:
                        logger.warning("[ProvidersUsage] No embedding model found for user")
                        return
                else:
                    model_name = OLLAMA_CORTEX_MODEL
                    metrics = self._last_ollama_metrics
                    
                    # Get the model ID if exists
                    model_id = None
                    model_result = conn.execute(text("""
                        SELECT id FROM models 
                        WHERE user_id = :user_id AND provider_id = :provider_id AND name = :model_name
                    """), {
                        "user_id": self.user_id,
                        "provider_id": provider_id,
                        "model_name": model_name
                    }).fetchone()
                    
                    if model_result:
                        model_id = model_result[0]
                
                # Calculate processing time and tokens input
                processing_time_ms = int((self._flow_end_time - self._flow_start_time) * 1000) if self._flow_end_time and self._flow_start_time else 0
                chunk_count = len(self._chunks) if self._chunks else 0
                tokens_input = len(self._content) // 4 if self._content else 0
                
                # Record usage
                conn.execute(text("""
                    INSERT INTO providers_usage (
                        user_id, provider_id, model_id, model_name,
                        request_count, tokens_input, tokens_output, latency_ms,
                        task, chunk_count, processing_time_ms
                    ) VALUES (
                        :user_id, :provider_id, :model_id, :model_name,
                        1, :tokens_input, :tokens_output, :latency_ms,
                        :task, :chunk_count, :processing_time_ms
                    )
                """), {
                    "user_id": self.user_id,
                    "provider_id": provider_id,
                    "model_id": model_id,
                    "model_name": model_name,
                    "tokens_input": tokens_input,
                    "tokens_output": metrics.get("tokens_generated", 0) if metrics else 0,
                    "latency_ms": metrics.get("total_ms", 0) if metrics else 0,
                    "task": task,
                    "chunk_count": chunk_count,
                    "processing_time_ms": processing_time_ms
                })
                conn.commit()
                logger.info(f"[ProvidersUsage] Saved usage for {model_name}: tokens_input={tokens_input}, tokens_output={metrics.get('tokens_generated', 0) if metrics else 0}, task={task}")
        except Exception as e:
            logger.error(f"[ProvidersUsage] Failed to save usage: {e}")
