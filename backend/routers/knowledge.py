"""
Knowledge router - Knowledge ingestion and processing endpoints
"""
import os
import json
import uuid
import asyncio
from fastapi import APIRouter, HTTPException, Request, Form, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from core.database import get_db_connection
from core.config import OLLAMA_EMBEDDING_MODEL, QDRANT_COLLECTION
from cortex.flow import KnowledgeFlow

router = APIRouter()

knowledge_flows: dict[str, KnowledgeFlow] = {}


def _get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token de autenticação não fornecido")
    
    from jose import jwt
    JWT_SECRET = os.getenv("JWT_SECRET", "mycrew-jwt-secret-key-change-in-production")
    JWT_ALGORITHM = "HS256"
    token = auth_header.replace("Bearer ", "")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"id": payload["sub"], "username": payload["username"], "role": payload["role"]}
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")


@router.get("")
async def get_knowledge(request: Request):
    user = _get_current_user(request)
    
    try:
        # Simple query without tags or complex joins to avoid errors
        with get_db_connection() as conn:
            docs_result = conn.execute(text("""
                SELECT 
                    kd.id::text as id,
                    kd.filename as name,
                    kd.filename as fileName,
                    kd.file_type as fileType,
                    kd.language,
                    kd.structure_level as structureLevel,
                    kd.domain,
                    kd.raw_analysis->>'retrieval_hint' as retrievalHint,
                    to_char(kd.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as createdAt,
                    to_char(kd.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updatedAt
                FROM knowledge_document kd
                WHERE kd.user_id = :user_id
                ORDER BY kd.created_at DESC
            """), {"user_id": user["id"]}).fetchall()
        
        knowledge = []
        for row in docs_result:
            chunk_count = 0
            try:
                with get_db_connection() as conn:
                    chunk_count = conn.execute(text("""
                        SELECT count(*) FROM knowledge_chunk kc 
                        WHERE kc.document_id = :doc_id
                    """), {"doc_id": row[0]}).scalar() or 0
            except Exception:
                pass
            
            doc_entry = {
                "id": row[0],
                "name": row[1],
                "fileName": row[2],
                "fileType": row[3],
                "language": row[4],
                "structureLevel": row[5],
                "domain": row[6],
                "tags": [],
                "status": "done",
                "chunkCount": chunk_count,
                "retrievalHint": row[7],
                "createdAt": row[8],
                "updatedAt": row[9]
            }
            knowledge.append(doc_entry)
        
        return {
            "knowledge": knowledge,
            "totalKnowledge": len(knowledge),
            "tagStats": []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar documentos: {str(e)}")


@router.get("/status/{flow_id}")
async def knowledge_status(flow_id: str, request: Request):
    user = _get_current_user(request)
    flow = knowledge_flows.get(flow_id)
    if not flow:
        try:
            with get_db_connection() as conn:
                result = conn.execute(text("""
                    SELECT raw_analysis, status FROM knowledge_flow kf
                    JOIN knowledge_document kd ON kd.id = kf.document_id
                    WHERE kf.flow_id = :flow_id AND kf.user_id = :user_id
                """), {"flow_id": flow_id, "user_id": user["id"]}).fetchone()
                
                if result and result[0]:
                    return {
                        "status": result[1] or "awaiting_confirmation",
                        "recommendation": result[0]
                    }
        except Exception:
            pass
        raise HTTPException(status_code=404, detail="Flow not found")
    
    return {
        "status": "awaiting_confirmation",
        "recommendation": flow._recommendation
    }


async def _process_flow_background(flow: KnowledgeFlow, user_id: str, name: str, file_type: str, tags: list = None):
    tags = tags or []
    try:
        recommendation = await flow.process()
        
        # Try to insert with tags column first
        try:
            with get_db_connection() as conn:
                doc_id = conn.execute(text("""
                    INSERT INTO knowledge_document (user_id, filename, file_type, language, structure_level, domain, raw_analysis, tags)
                    VALUES (:user_id, :filename, :file_type, :language, :structure_level, :domain, :raw_analysis, :tags)
                    RETURNING id
                """), {
                    "user_id": user_id,
                    "filename": name,
                    "file_type": file_type,
                    "language": recommendation.document.language,
                    "structure_level": recommendation.document.structure_level,
                    "domain": recommendation.document.domain,
                    "raw_analysis": json.dumps(recommendation.model_dump(), ensure_ascii=False),
                    "tags": json.dumps(tags, ensure_ascii=False)
                }).scalar()
                conn.execute(text("""
                    INSERT INTO knowledge_flow (flow_id, document_id, user_id, status)
                    VALUES (:flow_id, :document_id, :user_id, 'awaiting_confirmation')
                """), {
                    "flow_id": flow.flow_id,
                    "document_id": str(doc_id),
                    "user_id": user_id
                })
        except Exception:
            # Fallback: try without tags column
            with get_db_connection() as conn:
                doc_id = conn.execute(text("""
                    INSERT INTO knowledge_document (user_id, filename, file_type, language, structure_level, domain, raw_analysis)
                    VALUES (:user_id, :filename, :file_type, :language, :structure_level, :domain, :raw_analysis)
                    RETURNING id
                """), {
                    "user_id": user_id,
                    "filename": name,
                    "file_type": file_type,
                    "language": recommendation.document.language,
                    "structure_level": recommendation.document.structure_level,
                    "domain": recommendation.document.domain,
                    "raw_analysis": json.dumps(recommendation.model_dump(), ensure_ascii=False)
                }).scalar()
                conn.execute(text("""
                    INSERT INTO knowledge_flow (flow_id, document_id, user_id, status)
                    VALUES (:flow_id, :document_id, :user_id, 'awaiting_confirmation')
                """), {
                    "flow_id": flow.flow_id,
                    "document_id": str(doc_id),
                    "user_id": user_id
                })
    except Exception as e:
        await flow.emit_step('analyze', 'Analisando com Cortex', 'error', error_message=f'Erro no processamento: {str(e)}')
    finally:
        async def cleanup():
            await asyncio.sleep(300)
            knowledge_flows.pop(flow.flow_id, None)
        asyncio.create_task(cleanup())


@router.post("/ingest")
async def knowledge_ingest(
    request: Request,
    name: str = Form(...),
    description: str = Form(...),
    file: UploadFile = File(...),
    tags: str = Form(default=""),
):
    user = _get_current_user(request)
    
    flow_id = str(uuid.uuid4())
    file_content = await file.read()
    file_type = file.filename.split('.')[-1].lower() if '.' in file.filename else 'other'
    
    tags_list = [t.strip() for t in tags.split(',') if t.strip()] if tags else []
    
    try:
        with get_db_connection() as conn:
            cortex_agent = conn.execute(text("""
                SELECT prompt FROM agents WHERE name = 'Cortex' AND user_id = :user_id
            """), {"user_id": user["id"]}).fetchone()
            cortex_prompt = cortex_agent[0] if cortex_agent else ""
    except Exception:
        cortex_prompt = ""
    
    flow = KnowledgeFlow(flow_id, user["id"], file_content, file.filename or "unknown", cortex_prompt)
    knowledge_flows[flow_id] = flow
    
    async def delayed_process():
        await asyncio.sleep(0.5)
        await _process_flow_background(flow, user["id"], name, file_type, tags_list)
    
    asyncio.create_task(delayed_process())
    
    return {"flow_id": flow_id}


@router.get("/stream")
async def knowledge_stream(request: Request, flow_id: str):
    async def event_generator():
        flow = knowledge_flows.get(flow_id)
        if not flow:
            yield f"data: {json.dumps({'error': 'Flow not found'})}\n\n"
            return
        
        events_queue = []
        
        async def subscribe(event_json: str):
            events_queue.append(event_json)
        
        flow._subscribers.append(subscribe)
        
        for buffered_event in flow._event_buffer:
            events_queue.append(buffered_event)
        
        try:
            while True:
                if await request.is_disconnected():
                    break
                    
                if events_queue:
                    yield f"data: {events_queue.pop(0)}\n\n"
                else:
                    await asyncio.sleep(0.1)
        finally:
            flow._subscribers.remove(subscribe)
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/confirm")
async def knowledge_confirm(
    payload: dict,
    request: Request
):
    user = _get_current_user(request)
    flow_id = payload.get("flow_id")
    
    flow = knowledge_flows.get(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")
    
    try:
        chunking_params = payload.get("chunking_strategy", {}).get("parameters")
        
        document_id = str(uuid.uuid4())
        try:
            with get_db_connection() as conn:
                doc_result = conn.execute(text("""
                    SELECT document_id FROM knowledge_flow WHERE flow_id = :flow_id AND user_id = :user_id
                """), {"flow_id": flow_id, "user_id": user["id"]}).fetchone()
                if doc_result:
                    document_id = str(doc_result[0])
        except Exception:
            pass
        
        await flow.continue_after_confirmation(chunking_params, document_id)
        
        if flow._content and flow._recommendation:
            chunks = flow._chunks if hasattr(flow, '_chunks') else []
            if chunks:
                with get_db_connection() as conn:
                    for i, chunk in enumerate(chunks):
                        conn.execute(text("""
                            INSERT INTO knowledge_chunk (document_id, content, chunk_index, token_count, strategy_used, embedding_model, qdrant_collection)
                            VALUES (:document_id, :content, :chunk_index, :token_count, :strategy_used, :embedding_model, :qdrant_collection)
                        """), {
                            "document_id": document_id,
                            "content": chunk,
                            "chunk_index": i,
                            "token_count": len(chunk) // 4,
                            "strategy_used": flow._recommendation.get('chunking_strategy', {}).get('primary', {}).get('type', 'paragraph'),
                            "embedding_model": flow._recommendation.get('embedding', {}).get('model', OLLAMA_EMBEDDING_MODEL),
                            "qdrant_collection": QDRANT_COLLECTION
                        })
            
            with get_db_connection() as conn:
                conn.execute(text("""
                    UPDATE knowledge_flow SET status = 'done', updated_at = now()
                    WHERE flow_id = :flow_id
                """), {"flow_id": flow_id})
        
        return {"message": "Knowledge processing completed", "status": "completed"}
    except Exception as e:
        await flow.emit_step('chunking', 'Indexando', 'error', error_message=str(e))
        try:
            with get_db_connection() as conn:
                conn.execute(text("""
                    UPDATE knowledge_flow SET status = 'error', updated_at = now()
                    WHERE flow_id = :flow_id
                """), {"flow_id": flow_id})
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Erro no processamento: {str(e)}")