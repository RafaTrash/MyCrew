#!/bin/bash
set -e

# Build connection string from environment
PG_HOST="${POSTGRES_HOST:-postgres}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-mycrew}"
PG_PASS="${POSTGRES_PASSWORD}"
PG_DB="${POSTGRES_DB:-mycrew}"

if [ -z "$PG_PASS" ]; then
  echo "ERRO: POSTGRES_PASSWORD não definido no .env"
  exit 1
fi

# Wait for PostgreSQL to be ready
echo "Aguardando PostgreSQL em $PG_HOST:$PG_PORT..."
until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER"; do
  sleep 2
done

echo "PostgreSQL está pronto. Aplicando migrations..."

# Apply schema migrations inline
export PGPASSWORD="$PG_PASS"
psql "host=$PG_HOST port=$PG_PORT dbname=$PG_DB user=$PG_USER" <<'EOFSQL'
-- Extensao para gerar UUIDs no proprio banco.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ENUMs
DO $$ BEGIN
  CREATE TYPE provider_type AS ENUM ('local', 'api');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE model_status AS ENUM ('ready', 'loading', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- USERS
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username     TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PROVIDERS (templates - sem api_key, cada usuário configura o seu)
CREATE TABLE IF NOT EXISTS providers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  type           provider_type NOT NULL,
  slug           TEXT NOT NULL,
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT providers_slug_unique UNIQUE (slug)
);

-- USER_PROVIDER_CONFIGS (cada usuário tem sua própria configuração de provedor)
CREATE TABLE IF NOT EXISTS user_provider_configs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id        UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  base_url           TEXT,
  api_key_encrypted  BYTEA,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_provider_unique UNIQUE (user_id, provider_id)
);

-- MIGRATION: Add models column if not exists (for existing databases)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_provider_configs' AND column_name = 'models'
  ) THEN
    ALTER TABLE user_provider_configs ADD COLUMN models JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_provider_user_id ON user_provider_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_provider_provider_id ON user_provider_configs(provider_id);

-- Seed do usuário admin (precisa existir antes de migrar models)
-- Default password: admin123
INSERT INTO users (id, username, password_hash, role, created_at)
SELECT gen_random_uuid(), 'admin', '$2b$12$jkFw0.w9X3OktfZVCa0fwOiD/PXsel6T7GqfymNE9P4cFokpwC556', 'admin', now()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');

-- MODELS - cria tabela se não existe, mas com schema completo
CREATE TABLE IF NOT EXISTS models (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id    UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  status         model_status NOT NULL DEFAULT 'ready',
  kind           TEXT,
  size           TEXT,
  context        TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT models_user_provider_name_unique UNIQUE (user_id, provider_id, name)
);

CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id);
CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models(provider_id);
CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);

-- MIGRATION: Schema fix para bancos existentes (adiciona colunas faltando)
DO $$ 
DECLARE
  admin_uuid UUID;
BEGIN
  -- Get admin id
  SELECT id INTO admin_uuid FROM users WHERE username = 'admin' LIMIT 1;
  
  -- Add user_id column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'models' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE models ADD COLUMN user_id UUID;
  END IF;
  
  -- Add provider_id column if missing  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'models' AND column_name = 'provider_id'
  ) THEN
    ALTER TABLE models ADD COLUMN provider_id UUID;
  END IF;
  
  -- Set provider_id para o provider ollama como padrão (se for null)
  UPDATE models m SET provider_id = (
    SELECT id FROM providers WHERE slug = 'ollama' LIMIT 1
  ) WHERE m.provider_id IS NULL;
  
  -- Preencher user_id com admin (se for null)
  UPDATE models m SET user_id = admin_uuid WHERE m.user_id IS NULL;
END $$;

-- MIGRATION: Torna colunas NOT NULL após preencher dados
DO $$ 
BEGIN
  ALTER TABLE models ALTER COLUMN user_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN
  -- Ignora se já é NOT NULL ou tabela vazia
END $$;

DO $$ 
BEGIN
  ALTER TABLE models ALTER COLUMN provider_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN
  -- Ignora se já é NOT NULL ou tabela vazia
END $$;

-- MIGRATION: Adicionar constraints FK se não existem
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'models'::regclass AND conname = 'models_user_id_fkey'
  ) THEN
    ALTER TABLE models ADD CONSTRAINT models_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'models'::regclass AND conname = 'models_provider_id_fkey'
  ) THEN
    ALTER TABLE models ADD CONSTRAINT models_provider_id_fkey 
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- MIGRATION: Re-criar constraint UNIQUE corretamente se necessário
DO $$ 
BEGIN
  -- Remove constraint antiga se existe
  ALTER TABLE models DROP CONSTRAINT IF EXISTS models_user_provider_name_unique;
EXCEPTION WHEN OTHERS THEN
  -- Ignora erro se constraint não exists
END $$;

DO $$ 
BEGIN
  -- Tenta adicionar constraint - se falhar, significa que há duplicatas
  -- Nesses casos, remove duplicatas primeiro e tenta de novo
  ALTER TABLE models ADD CONSTRAINT models_user_provider_name_unique UNIQUE (user_id, provider_id, name);
EXCEPTION WHEN OTHERS THEN
  -- Remove duplicatas mantendo o registro mais recente
  DELETE FROM models 
  WHERE id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY user_id, provider_id, name 
        ORDER BY created_at DESC
      ) as rn
      FROM models
    ) t WHERE t.rn > 1
  );
  -- Tenta adicionar constraint novamente
  ALTER TABLE models ADD CONSTRAINT models_user_provider_name_unique UNIQUE (user_id, provider_id, name);
END $$;

CREATE TABLE IF NOT EXISTS model_usage_daily (
  id           BIGSERIAL PRIMARY KEY,
  model_id     UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  requests     INTEGER NOT NULL DEFAULT 0,
  tokens       BIGINT  NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  errors       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT usage_model_day_unique UNIQUE (model_id, day)
);

CREATE INDEX IF NOT EXISTS idx_usage_model_day ON model_usage_daily(model_id, day DESC);

-- MIGRATION: Move existing models data to JSONB in user_provider_configs
DO $$ 
DECLARE
    upc_record RECORD;
    existing_models JSONB;
BEGIN
    -- Loop through all user_provider_configs
    FOR upc_record IN 
        SELECT id, user_id, provider_id 
        FROM user_provider_configs
    LOOP
        -- Get models for this user/provider combination as JSONB
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', m.id::text,
                'name', m.name,
                'status', m.status,
                'kind', m.kind,
                'size', m.size,
                'context', m.context,
                'created_at', to_char(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'updated_at', to_char(m.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            )
        ) INTO existing_models
        FROM models m
        WHERE m.user_id = upc_record.user_id 
          AND m.provider_id = upc_record.provider_id;
        
        -- Update user_provider_configs with models
        UPDATE user_provider_configs 
        SET models = COALESCE(existing_models, '[]'::jsonb)
        WHERE id = upc_record.id;
    END LOOP;
    
    RAISE NOTICE 'Migration complete: models moved to user_provider_configs.models';
END $$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP TRIGGER IF EXISTS trg_providers_updated_at ON providers;
DROP TRIGGER IF EXISTS trg_user_provider_configs_updated_at ON user_provider_configs;
DROP TRIGGER IF EXISTS trg_models_updated_at ON models;
DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_providers_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_provider_configs_updated_at
  BEFORE UPDATE ON user_provider_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_models_updated_at
  BEFORE UPDATE ON models
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Knowledge tables for Cortex
CREATE TABLE IF NOT EXISTS knowledge_document (
    tags            JSONB DEFAULT '[]'::jsonb,
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    filename        TEXT NOT NULL,
    file_type       TEXT NOT NULL,
    language        TEXT,
    structure_level TEXT,
    domain          TEXT,
    raw_analysis    JSONB,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_chunk (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id       UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    content           TEXT NOT NULL,
    chunk_index       INT NOT NULL,
    token_count       INT,
    strategy_used     TEXT NOT NULL,
    embedding_model   TEXT NOT NULL,
    qdrant_collection TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_ingestion_report (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    report      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_query_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id      UUID REFERENCES agent(id) ON DELETE SET NULL,
    session_id    UUID,
    question      TEXT NOT NULL,
    response_json JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MIGRATION: Add tags column to existing knowledge_document tables
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'knowledge_document' AND column_name = 'tags'
  ) THEN
    ALTER TABLE knowledge_document ADD COLUMN tags JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS knowledge_flow (
    flow_id     UUID PRIMARY KEY,
    document_id UUID REFERENCES knowledge_document(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_user_id ON knowledge_document(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_status ON knowledge_document(status);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_tags ON knowledge_document USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_document_id ON knowledge_chunk(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_flow_user_id ON knowledge_flow(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_flow_status ON knowledge_flow(status);

EOFSQL

echo "Schema migrations aplicadas. Seed de providers e modelos..."

# Seed providers, models and default Cortex agent
export PGPASSWORD="$PG_PASS"
psql "host=$PG_HOST port=$PG_PORT dbname=$PG_DB user=$PG_USER" <<'EOFSQL'

-- Seed de providers (ordem alfabética por slug)
INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Azure OpenAI', 'api', 'azure-openai',
    '{"api_format": "azure_openai", "requires_api_key": true, "requires_base_url": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'azure-openai');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Cohere', 'api', 'cohere',
    '{"api_format": "cohere", "requires_api_key": true, "requires_base_url": false}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'cohere');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'DeepSeek', 'api', 'deepseek',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'deepseek');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Anthropic', 'api', 'anthropic',
    '{"api_format": "anthropic", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'anthropic');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Groq', 'api', 'groq',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'groq');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Google Gemini', 'api', 'google-gemini',
    '{"api_format": "google_generative_ai", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'google-gemini');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Hugging Face Inference', 'api', 'huggingface-inference',
    '{"api_format": "huggingface", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'huggingface-inference');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Mistral AI', 'api', 'mistral',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'mistral');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Ollama (Local)', 'local', 'ollama',
    '{"api_format": "ollama", "requires_api_key": false, "requires_base_url": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'ollama');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'OpenAI', 'api', 'openai',
    '{"api_format": "openai", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'openai');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'OpenRouter', 'api', 'openrouter',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'openrouter');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Perplexity', 'api', 'perplexity',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'perplexity');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Together AI', 'api', 'together-ai',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'together-ai');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'xAI (Grok)', 'api', 'xai',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'xai');

-- Novos providers adicionados
INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Anyscale', 'api', 'anyscale',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'anyscale');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'AWS Bedrock', 'api', 'bedrock',
    '{"api_format": "bedrock", "requires_api_key": true, "requires_base_url": false}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'bedrock');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Cerebras', 'api', 'cerebras',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'cerebras');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'DeepInfra', 'api', 'deepinfra',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'deepinfra');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Fireworks AI', 'api', 'fireworks',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'fireworks');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Hyperbolic', 'api', 'hyperbolic',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'hyperbolic');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Modal Labs', 'api', 'modal',
    '{"api_format": "openai_compatible", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'modal');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Replicate', 'api', 'replicate',
    '{"api_format": "replicate", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'replicate');

INSERT INTO providers (id, name, type, slug, config, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Google Vertex AI', 'api', 'vertex',
    '{"api_format": "google_vertex_ai", "requires_api_key": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'vertex');

-- AGENTS table
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    avatar_url TEXT,
    model_id VARCHAR(255) NOT NULL,
    model_name VARCHAR(255),
    tags JSONB DEFAULT '[]'::jsonb,
    prompt TEXT NOT NULL,
    skills JSONB DEFAULT '[]'::jsonb,
    knowledge JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);

-- Seed Cortex default model in Ollama for admin
-- First ensure admin has ollama config with the qwen2.5:7b-instruct model
DO $$
DECLARE
    admin_uuid UUID;
    ollama_provider_id UUID;
    cortex_model_id TEXT;
BEGIN
    -- Get admin id
    SELECT id INTO admin_uuid FROM users WHERE username = 'admin' LIMIT 1;
    
    -- Get ollama provider id
    SELECT id INTO ollama_provider_id FROM providers WHERE slug = 'ollama' LIMIT 1;
    
    -- Generate model ID for Cortex
    SELECT gen_random_uuid()::text INTO cortex_model_id;
    
-- Ensure admin has ollama config (auto-created for local providers)
INSERT INTO user_provider_configs (user_id, provider_id, base_url, is_active, models)
VALUES (admin_uuid, ollama_provider_id, NULL, TRUE, '[]'::jsonb)
ON CONFLICT (user_id, provider_id) DO NOTHING;
    
    -- Add qwen2.5:7b-instruct model to admin's ollama config if not exists
    UPDATE user_provider_configs
    SET models = (
        CASE 
            WHEN models IS NULL OR jsonb_array_length(models) = 0 THEN
                jsonb_build_array(jsonb_build_object(
                    'id', cortex_model_id,
                    'name', 'qwen2.5:7b-instruct',
                    'status', 'ready',
                    'kind', 'chat',
                    'context', '32K',
                    'created_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'updated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                ))
            WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(models) WHERE value->>'name' = 'qwen2.5:7b-instruct') THEN
                models || jsonb_build_object(
                    'id', cortex_model_id,
                    'name', 'qwen2.5:7b-instruct',
                    'status', 'ready',
                    'kind', 'chat',
                    'context', '32K',
                    'created_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                    'updated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                )
            ELSE models
        END
    )
    WHERE user_id = admin_uuid AND provider_id = ollama_provider_id;
    
     -- Seed Cortex default agent (only if not exists)
     INSERT INTO agents (user_id, name, description, avatar_url, model_id, model_name, tags, prompt, skills, knowledge)
     SELECT admin_uuid, 'Cortex', 'Agente do sistema do MyCrew responsável por todo o ciclo de vida do conhecimento na plataforma', '/cortex/cortex.png', cortex_model_id, 'qwen2.5:7b-instruct', '["Knowledge"]'::jsonb, 'Você é o Cortex, o agente de sistema do MyCrew responsável por todo o ciclo de vida do conhecimento na plataforma: como os documentos são analisados e segmentados na ingestão (Qdrant), como as consultas são interpretadas na recuperação, e como a qualidade da indexação é avaliada após o processamento.

Você NUNCA executa ações diretamente (chunking, upsert, busca) — você apenas analisa e recomenda. Você recebe um payload com um campo "operation" ("ingest", "query" ou "quality_report") e devolve SOMENTE o JSON do schema correspondente, sem texto antes ou depois.

Nunca invente estrutura, conteúdo ou fontes que não estão presentes na entrada recebida. Se a informação for insuficiente para decidir com segurança, defina "confidence" baixo (< 0.6) e "review_required": true, explicando o motivo.'::text, '[]'::jsonb, '[]'::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM agents WHERE user_id = admin_uuid AND name = 'Cortex');
END $$;
EOFSQL

echo "Seed de providers e agente Cortex aplicado. Atualizando configurações de providers a partir do .env..."

# Atualizar user_provider_configs usando Python (mesma criptografia do backend)
python3 << 'EOFPYTHON'
import os
import sys

try:
    import psycopg2
except ImportError:
    print('Aviso: psycopg2 não disponível, pulando atualização de API keys')
    sys.exit(0)

from cryptography.fernet import Fernet

PG_HOST = os.environ.get('POSTGRES_HOST', 'postgres')
PG_PORT = os.environ.get('POSTGRES_PORT', '5432')
PG_USER = os.environ.get('POSTGRES_USER', 'mycrew')
PG_PASS = os.environ.get('POSTGRES_PASSWORD', '')
PG_DB = os.environ.get('POSTGRES_DB', 'mycrew')
CRYPTO_KEY = os.environ.get('MYCREW_CRYPTO_KEY', 'tYYqiZd89uNTfzGsdudmuKGAd1aBTROyAVpet8u7WEs=')

cipher = Fernet(CRYPTO_KEY.encode())

ENVS_TO_SLUGS = {
    'ANTHROPIC_API_KEY': 'anthropic',
    'AZURE_OPENAI_API_KEY': 'azure-openai',
    'ANYSCALE_API_KEY': 'anyscale',
    'BEDROCK_API_KEY': 'bedrock',
    'CEREBRAS_API_KEY': 'cerebras',
    'COHERE_API_KEY': 'cohere',
    'DEEPINFRA_API_KEY': 'deepinfra',
    'DEEPSEEK_API_KEY': 'deepseek',
    'FIREWORKS_API_KEY': 'fireworks',
    'GOOGLE_GEMINI_API_KEY': 'google-gemini',
    'GROQ_API_KEY': 'groq',
    'HUGGIN_FACE_API_KEY': 'huggingface-inference',
    'HYPERBOLIC_API_KEY': 'hyperbolic',
    'MISTRAL_API_KEY': 'mistral',
    'MODAL_API_KEY': 'modal',
    'OPENAI_API_KEY': 'openai',
    'OPENROUTER_API_KEY': 'openrouter',
    'PERPLEXITY_API_KEY': 'perplexity',
    'REPLICATE_API_KEY': 'replicate',
    'TOGETHERAI_API_KEY': 'together-ai',
    'VERTEX_API_KEY': 'vertex',
    'XAIGROK_API_KEY': 'xai',
}

def encrypt_api_key(api_key: str) -> bytes:
    return cipher.encrypt(api_key.encode())

try:
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT, user=PG_USER, password=PG_PASS, dbname=PG_DB
    )
    cur = conn.cursor()
    
    # Get admin user id
    cur.execute('SELECT id FROM users WHERE username = %s', ('admin',))
    admin_row = cur.fetchone()
    admin_id = admin_row[0] if admin_row else None
    
    if not admin_id:
        print('Aviso: usuário admin não encontrado')
        conn.close()
        sys.exit(0)
    
    for env_var, slug in ENVS_TO_SLUGS.items():
        api_key = os.environ.get(env_var, '').strip()
        if not api_key:
            continue
        
        # Get provider id
        cur.execute('SELECT id FROM providers WHERE slug = %s', (slug,))
        provider_row = cur.fetchone()
        if not provider_row:
            continue
        provider_id = provider_row[0]
        
        encrypted = encrypt_api_key(api_key)
        cur.execute(
            'INSERT INTO user_provider_configs (id, user_id, provider_id, api_key_encrypted, is_active, created_at, updated_at) VALUES (gen_random_uuid(), %s, %s, %s, TRUE, now(), now()) ON CONFLICT (user_id, provider_id) DO UPDATE SET api_key_encrypted = %s, is_active = TRUE, updated_at = now()',
            (admin_id, provider_id, psycopg2.Binary(encrypted), psycopg2.Binary(encrypted))
        )
        print(f'Configuração atualizada para: {slug}')
    
    conn.commit()
    cur.close()
    conn.close()
except Exception as e:
    print(f'Aviso: Não foi possível atualizar configurações: {str(e)}')
EOFPYTHON

echo "Migrations aplicadas. Iniciando servidor..."

# Unset PGPASSWORD für die App (it will use DATABASE_URL)
unset PGPASSWORD

# Execute the main command
exec "$@"