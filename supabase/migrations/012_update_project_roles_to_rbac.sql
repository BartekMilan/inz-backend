-- Migration: Update project roles to RBAC (owner, editor, viewer)
-- Changes: 'admin' -> 'editor', 'member' -> 'editor'

-- =====================================================
-- 1. UPDATE EXISTING RECORDS
-- =====================================================

-- Update 'admin' role to 'editor'
UPDATE project_members
SET role = 'editor'
WHERE role = 'admin';

-- Update 'member' role to 'editor'
UPDATE project_members
SET role = 'editor'
WHERE role = 'member';

-- =====================================================
-- 2. UPDATE CONSTRAINT
-- =====================================================

-- Drop the old constraint
ALTER TABLE project_members
DROP CONSTRAINT IF EXISTS project_members_role_check;

-- Add new constraint with only owner, editor, viewer
ALTER TABLE project_members
ADD CONSTRAINT project_members_role_check 
CHECK (role IN ('owner', 'editor', 'viewer'));

-- =====================================================
-- 3. UPDATE DEFAULT VALUE
-- =====================================================

-- Update default role to 'viewer' (was 'member')
ALTER TABLE project_members
ALTER COLUMN role SET DEFAULT 'viewer';

