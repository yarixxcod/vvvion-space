ALTER TABLE image_models ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT '';
ALTER TABLE image_models ADD COLUMN IF NOT EXISTS request_config jsonb NOT NULL DEFAULT '{}'::jsonb;
