-- Migration: Disable Row Level Security (RLS) on all tables
-- This migration removes RLS policies and disables RLS, relying entirely on backend logic for authorization

-- =====================================================
-- 1. DROP ALL RLS POLICIES
-- =====================================================

-- Drop policies for projects table
DROP POLICY IF EXISTS "Users can view own projects" ON projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON projects;
DROP POLICY IF EXISTS "Users can update own projects" ON projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON projects;
DROP POLICY IF EXISTS "Users can view projects" ON projects;
DROP POLICY IF EXISTS "Users can insert projects" ON projects;
DROP POLICY IF EXISTS "Users can update projects" ON projects;
DROP POLICY IF EXISTS "Users can delete projects" ON projects;

-- Drop policies for project_members table
DROP POLICY IF EXISTS "Users can view project memberships" ON project_members;
DROP POLICY IF EXISTS "Project owners can insert members" ON project_members;
DROP POLICY IF EXISTS "Project owners can update members" ON project_members;
DROP POLICY IF EXISTS "Project owners can delete members" ON project_members;

-- Drop policies for sheet_configurations table
DROP POLICY IF EXISTS "Users can view own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can insert own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can update own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can delete own sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Users can view project sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project owners can insert sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project owners can update sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project owners can delete sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project members can insert sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project members can update sheet configuration" ON sheet_configurations;
DROP POLICY IF EXISTS "Project members can delete sheet configuration" ON sheet_configurations;

-- Drop policies for field_definitions table
DROP POLICY IF EXISTS "Users can view project field definitions" ON field_definitions;
DROP POLICY IF EXISTS "Project admins can insert field definitions" ON field_definitions;
DROP POLICY IF EXISTS "Project admins can update field definitions" ON field_definitions;
DROP POLICY IF EXISTS "Project admins can delete field definitions" ON field_definitions;

-- Drop policies for profiles table
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

-- Drop policies for document_templates table
DROP POLICY IF EXISTS "Users can view project templates" ON document_templates;
DROP POLICY IF EXISTS "Project admins can insert templates" ON document_templates;
DROP POLICY IF EXISTS "Project admins can update templates" ON document_templates;
DROP POLICY IF EXISTS "Project admins can delete templates" ON document_templates;

-- =====================================================
-- 2. DISABLE ROW LEVEL SECURITY ON ALL TABLES
-- =====================================================

ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE project_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE sheet_configurations DISABLE ROW LEVEL SECURITY;
ALTER TABLE field_definitions DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_templates DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- 3. GRANT PERMISSIONS TO AUTHENTICATED USERS
-- =====================================================
-- Note: Since RLS is disabled, the backend (using service role key) will have full access.
-- These grants ensure that if any direct database access is needed, authenticated users have permissions.
-- However, all access should go through the NestJS backend which enforces authorization.

GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sheet_configurations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON field_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_templates TO authenticated;

