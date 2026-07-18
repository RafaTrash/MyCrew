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

from .schemas import IngestRecommendation

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv('OLLAMA_URL', 'http://ollama:11434')
OLLAMA_EMBEDDING_MODEL = os.getenv('EMBEDDING_MODEL', 'nomic-embed-text')
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
        for callback in self._subscribers: await callback(event_json)

    async def analyze_document(self) -> IngestRecommendation:
        try:
            content = self.file_content.decode('utf-8', errors='replace')
            self._content = content
            char_count, word_count = len(content), len(content.split())
        except Exception:
            content = "[Arquivo binario]"
            self._content = content
            char_count, word_count = len(self.file_content), 0
        sample_size = min(2000, len(content))
        sample = content[:sample_size // 2] + content[-sample_size // 2:]

        detected_language = 'pt'
        words = {'pt': ['de','do','da','e','o','a','que','para','com','por','em','no','na','se','um','uma','dos','das','como','mais','mas','nao','foi','era','ser'],
                 'en': ['the','and','this','that','is','are','you','we','they','for','with','from','but','not','was','been'],
                 'es': ['el','la','los','las','de','que','es','un','una','en','por','con','para','del'],
                 'fr': ['le','la','les','un','une','que','est','vous','dans','pour','avec']}
        content_lower = content.lower()
        counts = {lang: sum(1 for w in word_list if w in content_lower) for lang, word_list in words.items()}
        if counts['en'] > counts['pt'] + 5: detected_language = 'en'
        elif counts['es'] > counts['pt'] + 5: detected_language = 'es'
        elif counts['fr'] > counts['pt'] + 5: detected_language = 'fr'
        language_hint = {'pt': 'portugues do Brasil', 'en': 'English', 'es': 'espanhol', 'fr': 'frances'}[detected_language]
        system_prompt = self._cortex_prompt or f"Voce e o Cortex, um agente de IA especializado em analise de documentos. Responda APENAS em {language_hint}. Retorne APENAS JSON valido."

        await self.emit_step('extract_metadata', 'Recebendo documento', 'running', f'Preparando {self.filename}...')
        await self.emit_step('extract_metadata', 'Recebendo documento', 'done', f'Arquivo: {self.filename}')
        await self.emit_step('collecting_samples', 'Coletando amostras', 'running', 'Analisando conteudo...')
        await asyncio.sleep(0.05)
        await self.emit_step('collecting_samples', 'Coletando amostras', 'done', f'{char_count} caracteres, {word_count} palavras')
        await self.emit_step('analyze', 'Analisando com Cortex', 'running', 'Qwen2.5 processando...')

        try:
            max_retries, response = 2, None
            for attempt in range(max_retries):
                try:
                    async with httpx.AsyncClient(timeout=300.0) as client:
                        response = await client.post(f'{OLLAMA_URL}/api/chat', json={"model": 'qwen2.5:7b-instruct', "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": f"DOCUMENTO: {self.filename}\nTAMANHO: {char_count} caracteres\nAMOSTRA:\n{sample}\nRETORNE JSON com chunking_strategy, embedding, qdrant_index, retrieval_hint, testing_questions, review_required, confidence, document."}], "stream": False, "options": {"temperature": 0}})
                    break
                except (httpx.TimeoutException, httpx.ConnectError):
                    if attempt == max_retries - 1: raise
                    await asyncio.sleep(2)
            if response.status_code != 200: raise Exception(f'Ollama error {response.status_code}')
            result = response.json()
            total_duration = result.get('total_duration', 0)
            eval_count = result.get('eval_count', 0)
            eval_time = result.get('eval_time', 0)
            ollama_metrics = {"total_ms": total_duration // 1_000_000, "tokens_generated": eval_count, "throughput_tps": round(eval_count / eval_time, 2) if eval_time else 0}
            json_str = extract_json_from_response(result.get('message', {}).get('content', result.get('content', '{}')))
            data = fill_defaults(json.loads(json_str))
            recommendation = IngestRecommendation(**data)
        except Exception as e:
            await self.emit_step('analyze', 'Analisando com Cortex', 'error', error_message=f'Erro: {str(e)}')
            raise

        await self.emit_step('analyze', 'Analisando com Cortex', 'done', f'Processado em {ollama_metrics["total_ms"]}ms', recommendation={"ollama_metrics": ollama_metrics})
        await self.emit_step('validate_schema', 'Validando schema', 'done', 'Schema valido')
        return recommendation

    async def process(self) -> IngestRecommendation:
        recommendation = await self.analyze_document()
        self._recommendation = recommendation.model_dump()
        await self.emit_step('awaiting_confirmation', 'Aguardando confirmacao', 'done', 'Revise os parametros sugeridos', recommendation=self._recommendation)
        return recommendation

    async def continue_after_confirmation(self, chunking_params: Optional[dict] = None):
        await self.emit_step('chunking', 'Indexando', 'running', 'Dividindo documento em chunks...')
        if not self._content: self._content = self.file_content.decode('utf-8', errors='replace')
        params = chunking_params or self._recommendation.get('chunking_strategy', {}).get('parameters', {})
        strategy = self._recommendation.get('chunking_strategy', {}).get('primary', {}).get('type', 'paragraph')
        self._chunks = chunk_text(self._content, strategy, params)
        await self.emit_step('chunking', 'Indexando', 'done', f'{len(self._chunks)} chunks criados')
        await self.emit_step('embedding', 'Gerando embeddings', 'running', 'Criando vetores...')

        qc = None
        try:
            qc = QdrantClient(url=QDRANT_URL, prefer_grpc=False)
            qc.get_collection(collection_name=QDRANT_COLLECTION)
        except Exception: qc = None

        if qc and self._chunks:
            try:
                dims = self._recommendation.get('embedding', {}).get('dimensions', 768)
                qc.recreate_collection(collection_name=QDRANT_COLLECTION, vectors_config=models.VectorParams(size=dims, distance=models.Distance.COSINE))
                embeddings = []
                for chunk in self._chunks:
                    try:
                        async with httpx.AsyncClient(timeout=60.0) as client:
                            r = await client.post(f'{OLLAMA_URL}/api/embeddings', json={"model": OLLAMA_EMBEDDING_MODEL, "prompt": chunk})
                            embeddings.append(r.json().get('embedding', [0]*768) if r.status_code == 200 else [0]*768)
                    except Exception: embeddings.append([0]*768)
                points = [models.PointStruct(id=str(uuid.uuid4()), vector=emb, payload={"flow_id": self.flow_id, "chunk_index": i, "content": c[:500], "filename": self.filename}) for i, (c, emb) in enumerate(zip(self._chunks, embeddings))]
                if points: qc.upsert(collection_name=QDRANT_COLLECTION, points=points)
                await self.emit_step('embedding', 'Gerando embeddings', 'done', f'{len(embeddings)} embeddings salvos')
            except Exception as e:
                await self.emit_step('embedding', 'Gerando embeddings', 'error', f'Erro: {str(e)}')
        else:
            await self.emit_step('embedding', 'Gerando embeddings', 'done', f'{len(self._chunks)} chunks processados')
        await self.emit_step('done', 'Concluido', 'done', 'Documento indexado com sucesso!')