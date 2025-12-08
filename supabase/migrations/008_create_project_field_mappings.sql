-- Migration: Create project_field_mappings table
-- This table stores the mapping between Google Sheets columns and internal field keys for each project
-- RLS is disabled - authorization is handled by backend logic

-- =====================================================
-- CREATE PROJECT_FIELD_MAPPINGS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS project_field_mappings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sheet_column_letter TEXT NOT NULL, -- e.g., "A", "B", "AA"
    internal_key TEXT NOT NULL, -- e.g., "firstName", "status"
    display_name TEXT NOT NULL, -- e.g., "Imię", "Czy opłacono"
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each column letter must be unique within a project
    UNIQUE(project_id, sheet_column_letter),
    -- Each internal key must be unique within a project
    UNIQUE(project_id, internal_key)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_project_field_mappings_project_id ON project_field_mappings(project_id);
CREATE INDEX IF NOT EXISTS idx_project_field_mappings_column_letter ON project_field_mappings(sheet_column_letter);
CREATE INDEX IF NOT EXISTS idx_project_field_mappings_internal_key ON project_field_mappings(internal_key);

-- RLS is disabled - authorization is handled by backend logic
-- No RLS policies needed

-- Trigger to auto-update updated_at
CREATE TRIGGER update_project_field_mappings_updated_at
    BEFORE UPDATE ON project_field_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions (RLS is disabled, but grants ensure proper access)
GRANT SELECT, INSERT, UPDATE, DELETE ON project_field_mappings TO authenticated;
