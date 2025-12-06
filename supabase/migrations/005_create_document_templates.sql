-- Migration: Create document_templates table
-- This table stores Google Doc template configurations per project

CREATE TABLE IF NOT EXISTS document_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    doc_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each template name must be unique within a project
    UNIQUE(project_id, name)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_document_templates_project_id ON document_templates(project_id);
CREATE INDEX IF NOT EXISTS idx_document_templates_name ON document_templates(name);

-- Enable Row Level Security
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view templates for projects they're members of
CREATE POLICY "Users can view project templates" ON document_templates
    FOR SELECT
    USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
            UNION
            SELECT project_id FROM project_members WHERE user_id = auth.uid()
        )
    );

-- Policy: Project admins can insert templates
CREATE POLICY "Project admins can insert templates" ON document_templates
    FOR INSERT
    WITH CHECK (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- Policy: Project admins can update templates
CREATE POLICY "Project admins can update templates" ON document_templates
    FOR UPDATE
    USING (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- Policy: Project admins can delete templates
CREATE POLICY "Project admins can delete templates" ON document_templates
    FOR DELETE
    USING (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- Trigger to auto-update updated_at
CREATE TRIGGER update_document_templates_updated_at
    BEFORE UPDATE ON document_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON document_templates TO authenticated;

