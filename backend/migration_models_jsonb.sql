-- Migration: Move models from separate table to JSONB in user_provider_configs
-- This simplifies the data model and ensures proper user isolation

-- Add models column to user_provider_configs (JSONB array)
ALTER TABLE user_provider_configs 
ADD COLUMN IF NOT EXISTS models JSONB DEFAULT '[]'::jsonb;

-- Create migration function to move existing models data
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

-- Verify migration
SELECT 
    'Providers with models count:' as info,
    COUNT(*) as count
FROM user_provider_configs 
WHERE jsonb_array_length(models) > 0;

SELECT 
    'Total models in JSONB:' as info,
    (SELECT SUM(jsonb_array_length(models)) FROM user_provider_configs) as total;