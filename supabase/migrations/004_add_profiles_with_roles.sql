-- Migration: Add profiles table with system roles
-- Roles: 'admin' (global access), 'registrar' (single project access)

-- =====================================================
-- 1. CREATE PROFILES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'registrar' CHECK (role IN ('admin', 'registrar')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT
    USING (auth.uid() = id);

-- Policy: Users can update their own profile (but not role - that's admin only)
-- For now, we'll manage roles via SQL directly
CREATE POLICY "Users can view all profiles" ON profiles
    FOR SELECT
    USING (true);

-- Grant permissions
GRANT SELECT ON profiles TO authenticated;

-- =====================================================
-- 2. CREATE TRIGGER TO AUTO-CREATE PROFILE ON USER SIGNUP
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, role)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'role', 'registrar'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- 3. BACKFILL EXISTING USERS
-- =====================================================

-- Insert profiles for existing users who don't have one yet
INSERT INTO profiles (id, role)
SELECT 
    id,
    COALESCE(raw_user_meta_data->>'role', 'registrar') as role
FROM auth.users
WHERE id NOT IN (SELECT id FROM profiles)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 4. HELPER FUNCTION: Get user's system role
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_system_role(p_user_id UUID)
RETURNS VARCHAR AS $$
DECLARE
    v_role VARCHAR;
BEGIN
    SELECT role INTO v_role FROM profiles WHERE id = p_user_id;
    RETURN COALESCE(v_role, 'registrar');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 5. UPDATE PROJECTS POLICIES FOR ADMIN ACCESS
-- =====================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own projects" ON projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON projects;
DROP POLICY IF EXISTS "Users can update own projects" ON projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON projects;

-- New policies that account for admin role
CREATE POLICY "Users can view projects" ON projects
    FOR SELECT
    USING (
        -- Admins can see all projects
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR
        -- Owner can see their projects
        owner_id = auth.uid()
        OR
        -- Members can see their assigned projects
        EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = auth.uid())
    );

CREATE POLICY "Users can insert projects" ON projects
    FOR INSERT
    WITH CHECK (
        -- Admins can create projects
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR
        -- Users can create their own projects
        owner_id = auth.uid()
    );

CREATE POLICY "Users can update projects" ON projects
    FOR UPDATE
    USING (
        -- Admins can update any project
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR
        -- Owner can update their projects
        owner_id = auth.uid()
    );

CREATE POLICY "Users can delete projects" ON projects
    FOR DELETE
    USING (
        -- Admins can delete any project
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        OR
        -- Owner can delete their projects
        owner_id = auth.uid()
    );

-- =====================================================
-- 6. SQL COMMAND TO SET A USER AS ADMIN (run manually)
-- Replace 'YOUR_USER_ID' with actual UUID
-- =====================================================

-- Example: UPDATE profiles SET role = 'admin' WHERE id = 'YOUR_USER_ID';
