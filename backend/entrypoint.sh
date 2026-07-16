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
psql "host=$PG_HOST port=$PG_PORT dbname=$PG_DB user=$PG_USER" <<'EOF'
-- Extensao para gerar UUIDs no proprio banco.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ENUMs
DO $$ BEGIN
  CREATE TYPE provider_type AS ENUM ('local', 'api');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE model_status AS ENUM ('ready', 'loading', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PROVIDERS
CREATE TABLE IF NOT EXISTS providers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  type           provider_type NOT NULL,
  slug           TEXT NOT NULL,
  base_url       TEXT,
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  api_key_encrypted BYTEA,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT providers_slug_unique UNIQUE (slug)
);

-- MODELS
CREATE TABLE IF NOT EXISTS models (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  status         model_status NOT NULL DEFAULT 'ready',
  kind           TEXT,
  size           TEXT,
  context        TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT models_provider_name_unique UNIQUE (provider_id, name)
);

CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models(provider_id);
CREATE INDEX IF NOT EXISTS idx_models_status ON models(status);

-- MODEL_USAGE_DAILY
CREATE TABLE IF NOT EXISTS model_usage_daily (
  id             BIGSERIAL PRIMARY KEY,
  model_id       UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  day            DATE NOT NULL,
  requests       INTEGER NOT NULL DEFAULT 0,
  tokens         BIGINT  NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  errors         INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT usage_model_day_unique UNIQUE (model_id, day)
);

CREATE INDEX IF NOT EXISTS idx_usage_model_day ON model_usage_daily(model_id, day DESC);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_providers_updated_at ON providers;
CREATE TRIGGER trg_providers_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_models_updated_at ON models;
CREATE TRIGGER trg_models_updated_at
  BEFORE UPDATE ON models
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed de providers
-- Inserção condicional para não duplicar (pode ser executado multiplas vezes)
INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Ollama (Local)', 'local', 'ollama',
    'http://localhost:11434',
    '{"api_format": "ollama", "requires_api_key": false, "notes": "Execução local via daemon Ollama"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'ollama');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'LM Studio (Local)', 'local', 'lm-studio',
    'http://localhost:1234/v1',
    '{"api_format": "openai_compatible", "requires_api_key": false, "notes": "Servidor local compatível com API OpenAI"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'lm-studio');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Anthropic', 'api', 'anthropic',
    'https://api.anthropic.com',
    '{"api_format": "anthropic", "requires_api_key": true, "notes": "Modelos Claude"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'anthropic');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'OpenAI', 'api', 'openai',
    'https://api.openai.com/v1',
    '{"api_format": "openai", "requires_api_key": true, "notes": "Modelos GPT"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'openai');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Google Gemini', 'api', 'google-gemini',
    'https://generativelanguage.googleapis.com',
    '{"api_format": "google_generative_ai", "requires_api_key": true, "notes": "Modelos Gemini"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'google-gemini');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Azure OpenAI', 'api', 'azure-openai',
    NULL,
    '{"api_format": "azure_openai", "requires_api_key": true, "notes": "base_url é específico por recurso Azure; preencher no cadastro do deployment"}'::jsonb,
    NULL, false, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'azure-openai');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'OpenRouter', 'api', 'openrouter',
    'https://openrouter.ai/api/v1',
    '{"api_format": "openai_compatible", "requires_api_key": true, "notes": "Agregador com acesso a múltiplos modelos/provedores"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'openrouter');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Together AI', 'api', 'together-ai',
    'https://api.together.xyz/v1',
    '{"api_format": "openai_compatible", "requires_api_key": true, "notes": "Hospedagem de modelos open-source"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'together-ai');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Hugging Face Inference', 'api', 'huggingface-inference',
    'https://api-inference.huggingface.co',
    '{"api_format": "huggingface", "requires_api_key": true, "notes": "Inference API para modelos hospedados no Hub"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'huggingface-inference');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Groq', 'api', 'groq',
    'https://api.groq.com/openai/v1',
    '{"api_format": "openai_compatible", "requires_api_key": true, "notes": "Inferência de baixa latência (LPU)"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'groq');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Mistral AI', 'api', 'mistral',
    'https://api.mistral.ai/v1',
    '{"api_format": "openai_compatible", "requires_api_key": true, "notes": "Modelos Mistral/Mixtral"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'mistral');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'DeepSeek', 'api', 'deepseek',
    'https://api.deepseek.com',
    '{"api_format": "openai_compatible", "requires_api_key": true, "notes": "Modelos DeepSeek (chat e reasoning)"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'deepseek');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'xAI (Grok)', 'api', 'xai',
    'https://api.x.ai/v1',
    '{"api_format": "openai_compatible", "requires_api_key": true, "notes": "Modelos Grok"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'xai');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Cohere', 'api', 'cohere',
    'https://api.cohere.com/v1',
    '{"api_format": "cohere", "requires_api_key": true, "notes": "Modelos Command; também usado para embeddings e rerank"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'cohere');

INSERT INTO providers (id, name, type, slug, base_url, config, api_key_encrypted, is_active, created_at, updated_at)
SELECT gen_random_uuid(), 'Perplexity', 'api', 'perplexity',
    'https://api.perplexity.ai',
    '{"api_format": "openai_compatible", "requires_api_key": true, "notes": "Modelos com busca integrada (online models)"}'::jsonb,
    NULL, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'perplexity');

EOF

echo "Migrations aplicadas. Iniciando servidor..."

# Unset PGPASSWORD for the app (it will use DATABASE_URL)
unset PGPASSWORD

# Execute the main command
exec "$@"