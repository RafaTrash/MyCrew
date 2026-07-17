-- Migration script to fix models table schema
-- Run this with: psql -U mycrew -d mycrew -f /path/to/migration.sql

-- Extensao para gerar UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Seed do usuário admin (precisa existir)
INSERT INTO users (id, username, password_hash, role, created_at)
SELECT gen_random_uuid(), 'admin', '$2b$12$jkFw0.w9X3OktfZVCa0fwOiD/PXsel6T7GqfymNE9P4cFokpwC556', 'admin', now()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');

-- Add user_id column if missing
ALTER TABLE models ADD COLUMN IF NOT EXISTS user_id UUID;

-- Add provider_id column if missing
ALTER TABLE models ADD COLUMN IF NOT EXISTS provider_id UUID;

-- Set default provider_id (ollama) for null values
UPDATE models m SET provider_id = (
  SELECT id FROM providers WHERE slug = 'ollama' LIMIT 1
) WHERE m.provider_id IS NULL;

-- Set default user_id (admin) for null values
UPDATE models m SET user_id = (
  SELECT id FROM users WHERE username = 'admin' LIMIT 1
) WHERE m.user_id IS NULL;

-- Add FK constraints if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'models'::regclass AND conname = 'models_user_id_fkey'
  ) THEN
    ALTER TABLE models ADD CONSTRAINT models_user_id_fkey 
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'models'::regclass AND conname = 'models_provider_id_fkey'
  ) THEN
    ALTER TABLE models ADD CONSTRAINT models_provider_id_fkey 
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Make columns NOT NULL (may fail if empty table, which is fine)
ALTER TABLE models ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE models ALTER COLUMN provider_id SET NOT NULL;

-- Drop old constraint and recreate correctly
ALTER TABLE models DROP CONSTRAINT IF EXISTS models_user_provider_name_unique;

-- Add unique constraint - if fails due to duplicates, clean them
DO $$ BEGIN
  ALTER TABLE models ADD CONSTRAINT models_user_provider_name_unique UNIQUE (user_id, provider_id, name);
EXCEPTION WHEN OTHERS THEN
  -- Remove duplicates, keep newest
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
  ALTER TABLE models ADD CONSTRAINT models_user_provider_name_unique UNIQUE (user_id, provider_id, name);
END $$;

-- Create index for user_id if missing
CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id);
CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models(provider_id);

-- Verify fix
SELECT 'Migration complete. Table now has columns:' as message;
SELECT column_name, is_nullable FROM information_schema.columns 
WHERE table_name = 'models' AND column_name IN ('user_id', 'provider_id');
SELECT COUNT(*) as total_models FROM models;