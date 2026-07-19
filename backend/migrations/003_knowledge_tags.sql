-- Migration: Adicionar coluna de tags na tabela knowledge_document
-- Executar após 001_knowledge_tables.sql

-- Adicionar coluna tags (JSONB array) na tabela knowledge_document
ALTER TABLE knowledge_document 
ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

-- Índice para busca por tags (GIN para arrays JSONB)
CREATE INDEX IF NOT EXISTS idx_knowledge_document_tags ON knowledge_document USING GIN (tags);