-- Migration: Create multi-project architecture
-- This migration creates the projects table and modifies sheet_configurations
-- to support multiple projects with separate Google Sheets configurations

-- =====================================================
-- 1. CREATE PROJECTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);

-- Enable Row Level Security
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view projects they own
CREATE POLICY "Users can view own projects" ON projects
    FOR SELECT
    USING (auth.uid() = owner_id);

-- Policy: Users can insert their own projects
CREATE POLICY "Users can insert own projects" ON projects
    FOR INSERT
    WITH CHECK (auth.uid() = owner_id);

-- Policy: Users can update their own projects
CREATE POLICY "Users can update own projects" ON projects
    FOR UPDATE
    USING (auth.uid() = owner_id);

-- Policy: Users can delete their own projects
CREATE POLICY "Users can delete own projects" ON projects
    FOR DELETE
    USING (auth.uid() = owner_id);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 2. CREATE PROJECT_MEMBERS TABLE (for team support)
-- =====================================================

CREATE TABLE IF NOT EXISTS project_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each user can only be a member of a project once
    UNIQUE(project_id, user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);

-- Enable Row Level Security
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view memberships for projects they're part of
CREATE POLICY "Users can view project memberships" ON project_members
    FOR SELECT
    USING (
        auth.uid() = user_id 
        OR project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
    );

-- Policy: Project owners can manage memberships
CREATE POLICY "Project owners can insert members" ON project_members
    FOR INSERT
    WITH CHECK (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

CREATE POLICY "Project owners can update members" ON project_members
    FOR UPDATE
    USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

CREATE POLICY "Project owners can delete members" ON project_members
    FOR DELETE
    USING (project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid()));

-- Trigger to auto-update updated_at
CREATE TRIGGER update_project_members_updated_at
    BEFORE UPDATE ON project_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 3. MODIFY SHEET_CONFIGURATIONS TABLE
-- =====================================================

-- Add project_id column to sheet_configurations
ALTER TABLE sheet_configurations 
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Create index for project_id
CREATE INDEX IF NOT EXISTS idx_sheet_configurations_project_id ON sheet_configurations(project_id);

-- Drop the old unique constraint on user_id (each user could have one config)
ALTER TABLE sheet_configurations DROP CONSTRAINT IF EXISTS sheet_configurations_user_id_key;

-- Add new unique constraint: each project can have only one sheet configuration
-- (keeping user_id for backwards compatibility during migration)
ALTER TABLE sheet_configurations ADD CONSTRAINT sheet_configurations_project_id_key UNIQUE(project_id);

-- Update RLS policies for sheet_configurations to be project-based
DROP POLICY IF EXISTS "Users can view own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can insert own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can update own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can delete own sheet configuration" ON sheet_configurations;

-- New policies based on project membership
CREATE POLICY "Users can view project sheet configuration" ON sheet_configurations
    FOR SELECT
    USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
            UNION
            SELECT project_id FROM project_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Project owners can insert sheet configuration" ON sheet_configurations
    FOR INSERT
    WITH CHECK (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

CREATE POLICY "Project owners can update sheet configuration" ON sheet_configurations
    FOR UPDATE
    USING (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

CREATE POLICY "Project owners can delete sheet configuration" ON sheet_configurations
    FOR DELETE
    USING (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- =====================================================
-- 4. CREATE FIELD_DEFINITIONS TABLE (column mapping per project)
-- =====================================================

CREATE TABLE IF NOT EXISTS field_definitions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    field_name VARCHAR(255) NOT NULL,
    field_label VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'date', 'email', 'phone', 'select', 'checkbox', 'textarea')),
    column_index INTEGER NOT NULL,
    is_required BOOLEAN DEFAULT false,
    options JSONB, -- For select fields: array of options
    validation_rules JSONB, -- Custom validation rules
    display_order INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each field name must be unique within a project
    UNIQUE(project_id, field_name),
    -- Each column index must be unique within a project
    UNIQUE(project_id, column_index)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_field_definitions_project_id ON field_definitions(project_id);

-- Enable Row Level Security
ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;

-- Policies for field_definitions (same as sheet_configurations)
CREATE POLICY "Users can view project field definitions" ON field_definitions
    FOR SELECT
    USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
            UNION
            SELECT project_id FROM project_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Project admins can insert field definitions" ON field_definitions
    FOR INSERT
    WITH CHECK (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

CREATE POLICY "Project admins can update field definitions" ON field_definitions
    FOR UPDATE
    USING (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

CREATE POLICY "Project admins can delete field definitions" ON field_definitions
    FOR DELETE
    USING (
        project_id IN (SELECT id FROM projects WHERE owner_id = auth.uid())
        OR project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
    );

-- Trigger to auto-update updated_at
CREATE TRIGGER update_field_definitions_updated_at
    BEFORE UPDATE ON field_definitions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. HELPER FUNCTION: Check if user has access to project
-- =====================================================

CREATE OR REPLACE FUNCTION user_has_project_access(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = p_user_id
        UNION
        SELECT 1 FROM project_members WHERE project_id = p_project_id AND user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 6. HELPER FUNCTION: Get user's role in project
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_project_role(p_project_id UUID, p_user_id UUID)
RETURNS VARCHAR AS $$
DECLARE
    v_role VARCHAR;
BEGIN
    -- Check if owner
    IF EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = p_user_id) THEN
        RETURN 'owner';
    END IF;
    
    -- Check membership
    SELECT role INTO v_role FROM project_members WHERE project_id = p_project_id AND user_id = p_user_id;
    RETURN v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
