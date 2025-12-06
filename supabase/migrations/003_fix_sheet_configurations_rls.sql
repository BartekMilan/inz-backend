-- Migration: Fix RLS policies for sheet_configurations table
-- This fixes the 42501 error by ensuring proper RLS policies based on project membership

-- =====================================================
-- 1. Ensure RLS is enabled
-- =====================================================
ALTER TABLE sheet_configurations ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 2. Drop existing policies (clean slate)
-- =====================================================
DROP POLICY IF EXISTS "Users can view own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can insert own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can update own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can delete own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can view project sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project owners can insert sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project owners can update sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project owners can delete sheet configuration" ON sheet_configurations;

-- =====================================================
-- 3. Create new policies based on project membership
-- =====================================================

-- SELECT: Allow if user is a member of the project
CREATE POLICY "Users can view project sheet configuration" ON sheet_configurations
    FOR SELECT
    USING (
        -- User is project owner
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = sheet_configurations.project_id 
            AND projects.owner_id = auth.uid()
        )
        OR
        -- User is project member
        EXISTS (
            SELECT 1 FROM project_members 
            WHERE project_members.project_id = sheet_configurations.project_id 
            AND project_members.user_id = auth.uid()
        )
    );

-- INSERT: Allow if user is project owner or admin member
CREATE POLICY "Project members can insert sheet configuration" ON sheet_configurations
    FOR INSERT
    WITH CHECK (
        -- User is project owner
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = project_id 
            AND projects.owner_id = auth.uid()
        )
        OR
        -- User is admin/owner member of the project
        EXISTS (
            SELECT 1 FROM project_members 
            WHERE project_members.project_id = sheet_configurations.project_id 
            AND project_members.user_id = auth.uid()
            AND project_members.role IN ('owner', 'admin')
        )
    );

-- UPDATE: Allow if user is project owner or admin member
CREATE POLICY "Project members can update sheet configuration" ON sheet_configurations
    FOR UPDATE
    USING (
        -- User is project owner
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = sheet_configurations.project_id 
            AND projects.owner_id = auth.uid()
        )
        OR
        -- User is admin/owner member of the project
        EXISTS (
            SELECT 1 FROM project_members 
            WHERE project_members.project_id = sheet_configurations.project_id 
            AND project_members.user_id = auth.uid()
            AND project_members.role IN ('owner', 'admin')
        )
    );

-- DELETE: Allow if user is project owner or admin member
CREATE POLICY "Project members can delete sheet configuration" ON sheet_configurations
    FOR DELETE
    USING (
        -- User is project owner
        EXISTS (
            SELECT 1 FROM projects 
            WHERE projects.id = sheet_configurations.project_id 
            AND projects.owner_id = auth.uid()
        )
        OR
        -- User is admin/owner member of the project
        EXISTS (
            SELECT 1 FROM project_members 
            WHERE project_members.project_id = sheet_configurations.project_id 
            AND project_members.user_id = auth.uid()
            AND project_members.role IN ('owner', 'admin')
        )
    );

-- =====================================================
-- 4. Grant necessary permissions to authenticated users
-- =====================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON sheet_configurations TO authenticated;
