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
  -- Ignora erro se constraint não existe
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

-- Trigger para updated_at
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
SELECT gen_random_uuid(), 'LM Studio (Local)', 'local', 'lm-studio',
    '{"api_format": "openai_compatible", "requires_api_key": false, "requires_base_url": true}'::jsonb,
    true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM providers WHERE slug = 'lm-studio');

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
EOFSQL

echo "Seed de providers aplicado. Atualizando configurações de providers a partir do .env..."

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

# Unset PGPASSWORD for the app (it will use DATABASE_URL)
unset PGPASSWORD

# Execute the main command
exec "$@"