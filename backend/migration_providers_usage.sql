-- Migration: Tabela de métricas de uso por provider/usuario/modelo
-- Armazena dados de consumo de APIs e modelos locais (Ollama)

CREATE TABLE IF NOT EXISTS providers_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL, -- Simplified, could be UUID FK
    provider_id     UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model_id        UUID REFERENCES models(id) ON DELETE CASCADE,
    model_name      TEXT, -- Denormalized for easy querying, especially for Ollama models without FK
    
    -- Métricas de consumo
    request_count   INTEGER NOT NULL DEFAULT 1,
    tokens_input    INTEGER DEFAULT 0,
    tokens_output   INTEGER DEFAULT 0,
    total_tokens    INTEGER GENERATED ALWAYS AS (tokens_input + tokens_output) STORED,
    latency_ms      INTEGER, -- Latência da requisição em milissegundos
    
    -- Informações adicionais
    task            TEXT, -- Tipo de operação: 'knowledge_analysis', 'embedding', etc.
    cost_usd        NUMERIC(10, 6) DEFAULT 0, -- Custo da operação (para provedores pagos)
    
    -- Métricas específicas de Knowledge Processing
    chunk_count     INTEGER DEFAULT 0, -- Número de chunks gerados
    processing_time_ms INTEGER DEFAULT 0, -- Tempo total do processamento em ms
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_providers_usage_user_id ON providers_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_providers_usage_provider_id ON providers_usage(provider_id);
CREATE INDEX IF NOT EXISTS idx_providers_usage_model_id ON providers_usage(model_id);
CREATE INDEX IF NOT EXISTS idx_providers_usage_created_at ON providers_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_providers_usage_model_name ON providers_usage(model_name);
CREATE INDEX IF NOT EXISTS idx_providers_usage_task ON providers_usage(task);

-- Índice composto para queries de uso por modelo
CREATE INDEX IF NOT EXISTS idx_providers_usage_user_model ON providers_usage(user_id, model_id) WHERE created_at >= now() - interval '7 days';

-- View para agregação de uso por modelo (para API /models)
CREATE OR REPLACE VIEW providers_usage_summary AS
SELECT 
    pu.user_id,
    pu.provider_id,
    pu.model_id,
    pu.model_name,
    COUNT(*) as requests,
    SUM(pu.tokens_input) as tokens_input,
    SUM(pu.tokens_output) as tokens_output,
    SUM(pu.total_tokens) as tokens,
    ROUND(AVG(pu.latency_ms))::INTEGER as avg_latency_ms,
    -- Últimos 7 dias por dia (para gráfico) - array simples de números
    (SELECT jsonb_agg(requests) FROM (
        SELECT COUNT(*) as requests
        FROM providers_usage pu2 
        WHERE pu2.model_id = pu.model_id 
          AND pu2.created_at >= now() - interval '7 days'
        GROUP BY date_trunc('day', pu2.created_at)
        ORDER BY date_trunc('day', pu2.created_at) DESC
        LIMIT 7
    ) daily) as daily_data
FROM providers_usage pu
GROUP BY pu.user_id, pu.provider_id, pu.model_id, pu.model_name;

-- View para uso agregado por provider
CREATE OR REPLACE VIEW providers_usage_by_provider AS
SELECT 
    pu.user_id,
    pu.provider_id,
    COUNT(*) as requests,
    SUM(pu.total_tokens) as tokens,
    ROUND(AVG(pu.latency_ms))::INTEGER as avg_latency_ms
FROM providers_usage pu
GROUP BY pu.user_id, pu.provider_id;