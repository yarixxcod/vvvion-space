-- Each image model can point at its own OpenAI-compatible endpoint.
-- An empty address or key falls back to the built-in xAI endpoint and server key.

alter table image_models add column if not exists base_url text not null default '';
alter table image_models add column if not exists api_key text not null default '';
