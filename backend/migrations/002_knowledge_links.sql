-- Migration: Tabelas de associação Knowledge-Agent/Task/Project
-- Executar após 001_knowledge_tables.sql

-- Associação de conhecimento a agentes
CREATE TABLE IF NOT EXISTS knowledge_agent_link (
    document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    agent_id    UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, agent_id)
);

-- Associação de conhecimento a projetos
CREATE TABLE IF NOT EXISTS knowledge_project_link (
    document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, project_id)
);

-- Associação de conhecimento a tasks
CREATE TABLE IF NOT EXISTS knowledge_task_link (
    document_id UUID NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
    task_id     UUID NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (document_id, task_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_knowledge_agent_link_document_id ON knowledge_agent_link(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_agent_link_agent_id ON knowledge_agent_link(agent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_project_link_document_id ON knowledge_project_link(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_project_link_project_id ON knowledge_project_link(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_task_link_document_id ON knowledge_task_link(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_task_link_task_id ON knowledge_task_link(task_id);