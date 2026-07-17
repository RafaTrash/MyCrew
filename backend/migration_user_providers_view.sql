-- Migration script to create a view for user providers with models
-- Run this with: psql -U mycrew -d mycrew -f /path/to/migration_user_providers_view.sql

-- Create view that returns only providers configured by the user
-- Models are now stored as JSONB array in user_provider_configs.models column
CREATE OR REPLACE VIEW user_providers_view AS
SELECT 
  upc.user_id,
  p.id AS provider_id,
  p.name,
  p.type,
  p.slug,
  p.config,
  (upc.api_key_encrypted IS NOT NULL) AS has_api_key,
  upc.base_url,
  COALESCE(upc.models, '[]'::jsonb) AS models
FROM user_provider_configs upc
JOIN providers p ON p.id = upc.provider_id
WHERE upc.is_active = TRUE;

-- Verify
SELECT 'Migration complete. View user_providers_view created with JSONB models.' as message;
