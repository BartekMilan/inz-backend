-- Migration: Add dynamic form fields to project_field_mappings table
-- This migration adds columns needed for dynamic form configuration:
-- - field_type: Type of the field (text, number, date, select, email, checkbox)
-- - is_required: Whether the field is required
-- - max_length: Maximum length for text fields
-- - options: JSON array of options for select fields

-- =====================================================
-- ADD NEW COLUMNS TO PROJECT_FIELD_MAPPINGS
-- =====================================================

-- Add field_type column with default value 'text'
ALTER TABLE project_field_mappings
ADD COLUMN IF NOT EXISTS field_type TEXT NOT NULL DEFAULT 'text'
CHECK (field_type IN ('text', 'number', 'date', 'select', 'email', 'checkbox'));

-- Add is_required column with default value false
ALTER TABLE project_field_mappings
ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT false;

-- Add max_length column (nullable, optional for text fields)
ALTER TABLE project_field_mappings
ADD COLUMN IF NOT EXISTS max_length INTEGER;

-- Add options column (nullable, used only for select fields)
-- Using JSONB for flexibility and better querying capabilities
ALTER TABLE project_field_mappings
ADD COLUMN IF NOT EXISTS options JSONB;

-- Create index on field_type for faster filtering
CREATE INDEX IF NOT EXISTS idx_project_field_mappings_field_type 
ON project_field_mappings(field_type);

-- Update existing records to have default values
-- (This is already handled by DEFAULT clauses, but we explicitly set them for safety)
UPDATE project_field_mappings
SET 
    field_type = 'text',
    is_required = false
WHERE field_type IS NULL OR is_required IS NULL;
