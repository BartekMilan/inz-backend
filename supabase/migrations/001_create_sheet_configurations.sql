-- Migration: Create sheet_configurations table
-- This table stores the Google Sheets configuration for each admin user

CREATE TABLE IF NOT EXISTS sheet_configurations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sheet_id VARCHAR(255) NOT NULL,
    sheet_title VARCHAR(500) NOT NULL,
    sheet_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each user can have only one sheet configuration
    UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sheet_configurations_user_id ON sheet_configurations(user_id);

-- Enable Row Level Security
ALTER TABLE sheet_configurations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own configurations
CREATE POLICY "Users can view own sheet configuration" ON sheet_configurations
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own configurations
CREATE POLICY "Users can insert own sheet configuration" ON sheet_configurations
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own configurations
CREATE POLICY "Users can update own sheet configuration" ON sheet_configurations
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Policy: Users can delete their own configurations
CREATE POLICY "Users can delete own sheet configuration" ON sheet_configurations
    FOR DELETE
    USING (auth.uid() = user_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_sheet_configurations_updated_at
    BEFORE UPDATE ON sheet_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
