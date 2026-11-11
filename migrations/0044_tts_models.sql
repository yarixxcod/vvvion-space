-- OpenAI-compatible speech models. The key stays on the server.
-- An empty table means the chat has no voice yet.

create table if not exists tts_models (
  name text primary key,
  display_name text not null default '',
  base_url text not null default '',
  api_key text not null default '',
  voice text not null default 'alloy',
  created_at timestamptz not null default now()
);
