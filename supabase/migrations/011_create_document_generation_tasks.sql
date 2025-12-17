-- Migration: Create document_generation_tasks table
-- This table stores asynchronous document generation tasks for bulk operations

CREATE TABLE IF NOT EXISTS document_generation_tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    participant_ids JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    progress_total INTEGER NOT NULL DEFAULT 0,
    progress_done INTEGER NOT NULL DEFAULT 0,
    output_drive_folder_id TEXT,
    output_files JSONB,
    error TEXT,
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_document_generation_tasks_status ON document_generation_tasks(status);
CREATE INDEX IF NOT EXISTS idx_document_generation_tasks_project_id ON document_generation_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_tasks_template_id ON document_generation_tasks(template_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_tasks_created_at ON document_generation_tasks(created_at DESC);

-- Enable Row Level Security
ALTER TABLE document_generation_tasks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view tasks for projects they have access to
CREATE POLICY "Users can view project tasks" ON document_generation_tasks
    FOR SELECT
    USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
            UNION
            SELECT project_id FROM project_members WHERE user_id = auth.uid()
        )
    );

-- Policy: Users with project access can insert tasks
CREATE POLICY "Users can insert project tasks" ON document_generation_tasks
    FOR INSERT
    WITH CHECK (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
            UNION
            SELECT project_id FROM project_members WHERE user_id = auth.uid()
        )
    );

-- Policy: Users with project access can update tasks
CREATE POLICY "Users can update project tasks" ON document_generation_tasks
    FOR UPDATE
    USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
            UNION
            SELECT project_id FROM project_members WHERE user_id = auth.uid()
        )
    );

-- Trigger to auto-update updated_at
CREATE TRIGGER update_document_generation_tasks_updated_at
    BEFORE UPDATE ON document_generation_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON document_generation_tasks TO authenticated;

