-- Migration script to create agents table
-- Run this with: psql -U mycrew -d mycrew -f /path/to/migration_agents.sql

-- Create agents table
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for faster queries by user
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);

-- Verify
SELECT 'Migration complete. Agents table created.' as message;
SELECT column_name, data_type, is_nullable FROM information_schema.columns 
WHERE table_name = 'agents' ORDER BY ordinal_position;