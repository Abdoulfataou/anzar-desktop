-- Initialisation de la base de données ISSALAN
-- Création des extensions nécessaires

-- Extension pgvector pour les embeddings vectoriels
CREATE EXTENSION IF NOT EXISTS vector;

-- Extension pour les UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Création de la table des projets
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'planned',
    progress FLOAT DEFAULT 0.0,
    plan JSONB,
    execution_result JSONB,
    start_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id UUID
);

-- Création de la table des agents
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    role VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'idle',
    last_active TIMESTAMP,
    performance_metrics JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Création de la table des tâches
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    type VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    result JSONB,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Création de la table des fichiers générés
CREATE TABLE IF NOT EXISTS generated_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content TEXT,
    language VARCHAR(50),
    size_bytes INTEGER,
    checksum VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Création de la table des conversations avec embeddings
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- pour DeepSeek embeddings
    tokens_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Création des index pour les performances
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_generated_files_project_id ON generated_files(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_embedding ON conversations USING ivfflat (embedding vector_cosine_ops);

-- Insertion des agents par défaut
INSERT INTO agents (name, role, status) VALUES
    ('orchestrator', 'Orchestrateur', 'active'),
    ('planner', 'Planificateur', 'active'),
    ('coder', 'Codeur', 'active'),
    ('tester', 'Testeur', 'active'),
    ('executor', 'Exécuteur', 'active')
ON CONFLICT (name) DO NOTHING;

-- Création de la vue des statistiques
CREATE OR REPLACE VIEW project_statistics AS
SELECT 
    p.status,
    COUNT(*) as count,
    AVG(p.progress) as avg_progress,
    MIN(p.created_at) as oldest,
    MAX(p.created_at) as newest
FROM projects p
GROUP BY p.status;

-- Fonction pour mettre à jour le timestamp updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour mettre à jour updated_at
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Log de l'initialisation
COMMENT ON DATABASE multiagent_db IS 'Base de données du système multi-agent ISSALAN';
COMMENT ON TABLE projects IS 'Projets générés par les agents IA';
COMMENT ON TABLE agents IS 'Agents IA spécialisés du système';
COMMENT ON TABLE tasks IS 'Tâches assignées aux agents';
COMMENT ON TABLE generated_files IS 'Fichiers générés par les agents';
COMMENT ON TABLE conversations IS 'Historique des conversations avec embeddings vectoriels';