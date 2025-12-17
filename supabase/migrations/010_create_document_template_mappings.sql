-- Migration: Create document_template_mappings table
-- This table stores placeholder-to-participant-key mappings per template
-- Enables F3.1 requirement: custom mapping of template placeholders to participant data keys

CREATE TABLE IF NOT EXISTS document_template_mappings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    template_id UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
    placeholder VARCHAR(255) NOT NULL,
    participant_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each placeholder must be unique within a template
    UNIQUE(template_id, placeholder)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_document_template_mappings_template_id ON document_template_mappings(template_id);
CREATE INDEX IF NOT EXISTS idx_document_template_mappings_placeholder ON document_template_mappings(placeholder);

-- Note: RLS is disabled globally (see migration 006), so no policies are needed
-- Authorization is handled server-side in the backend

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON document_template_mappings TO authenticated;

