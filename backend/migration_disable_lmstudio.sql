-- Migration: Disable LM Studio provider
-- Run this with: psql -U mycrew -d mycrew -f migration_disable_lmstudio.sql

-- Desativar o provider lmstudio (marcar como inativo)
UPDATE providers 
SET is_active = FALSE 
WHERE slug = 'lmstudio';

-- Remover configs existentes do lmstudio
DELETE FROM user_provider_configs 
WHERE provider_id IN (SELECT id FROM providers WHERE slug = 'lmstudio');

-- Remover modelos associados ao lmstudio
DELETE FROM models 
WHERE provider_id IN (SELECT id FROM providers WHERE slug = 'lmstudio');

-- Verificar
SELECT slug, is_active FROM providers WHERE slug = 'lmstudio';