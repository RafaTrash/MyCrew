-- Migration: Tabelas de Knowledge para Cortex
-- Executar após as tabelas existentes (providers, users, agents, etc.)

-- Documento original enviado pelo usuário
CREATE TABLE IF NOT EXISTS knowledge_document (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL, -- Simplified, could be UUID FK
    filename        TEXT NOT NULL,
    file_type       TEXT NOT NULL,
    language        TEXT,
    structure_level TEXT,
    domain          TEXT,
    raw_analysis    JSONB,       -- JSON completo da Fase 1
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | processed | error
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada chunk gerado (texto completo mora aqui; Qdrant guarda só o vetor)
CREATE TABLE IF NOT EXISTS knowledge_chunk (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- == point_id no Qdrant
    document_id       UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    content           TEXT NOT NULL,
    chunk_index       INT NOT NULL,
    token_count       INT,
    strategy_used     TEXT NOT NULL,
    embedding_model   TEXT NOT NULL,
    qdrant_collection TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Relatório de qualidade pós-importação (Fase 2)
CREATE TABLE IF NOT EXISTS knowledge_ingestion_report (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    report      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log de consultas (Fase 3) - auditoria e melhoria contínua
CREATE TABLE IF NOT EXISTS knowledge_query_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id      UUID REFERENCES agent(id) ON DELETE SET NULL,
    session_id    UUID,
    question      TEXT NOT NULL,
    response_json JSONB NOT NULL,   -- saída completa da Fase 3
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Controle de fluxos SSE
CREATE TABLE IF NOT EXISTS knowledge_flow (
    flow_id     UUID PRIMARY KEY,
    document_id UUID REFERENCES knowledge_document(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL, -- Simplified
    status      TEXT NOT NULL, -- pending | awaiting_confirmation | processing | done | error
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_knowledge_document_user_id ON knowledge_document(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_status ON knowledge_document(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_document_id ON knowledge_chunk(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_flow_user_id ON knowledge_flow(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_flow_status ON knowledge_flow(status);