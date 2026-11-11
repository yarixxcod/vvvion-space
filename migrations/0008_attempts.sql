-- One row per model attempt: who asked, which model, and whether the provider accepted it.
-- The note is a short excerpt of the question. Keys are never stored here.

create table if not exists chat_attempts (
  id text primary key,
  user_id text references "user" (id) on delete set null,
  guest_id text,
  model text not null,
  kind text not null,
  mode text not null,
  ok boolean not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists chat_attempts_created_idx on chat_attempts (created_at desc);
