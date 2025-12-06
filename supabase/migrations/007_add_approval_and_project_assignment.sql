-- Migration: Add approval and project assignment fields to profiles table
-- This enables the "Gatekeeper" onboarding flow for registrars

-- =====================================================
-- 1. ADD NEW COLUMNS TO PROFILES TABLE
-- =====================================================

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS assigned_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_is_approved ON profiles(is_approved);
CREATE INDEX IF NOT EXISTS idx_profiles_assigned_project_id ON profiles(assigned_project_id);

-- =====================================================
-- 2. UPDATE TRIGGER TO SET DEFAULT VALUES FOR NEW USERS
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, role, is_approved, assigned_project_id)
    VALUES (
        NEW.id, 
        COALESCE(NEW.raw_user_meta_data->>'role', 'registrar'),
        false, -- New users are not approved by default
        NULL   -- No project assigned by default
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 3. SET EXISTING ADMINS AS APPROVED (if any exist)
-- =====================================================

-- Set all existing admin users as approved
UPDATE profiles
SET is_approved = true
WHERE role = 'admin' AND is_approved = false;

-- =====================================================
-- 4. NOTE FOR MANUAL SETUP
-- =====================================================

-- IMPORTANT: The first Superadmin must be manually set to approved
-- Run this SQL command after creating the first admin user:
-- UPDATE profiles SET is_approved = true WHERE id = 'YOUR_ADMIN_USER_ID';

