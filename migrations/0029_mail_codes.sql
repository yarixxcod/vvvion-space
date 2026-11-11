-- One-time mail codes for password reset, address confirmation, and address change.

create table if not exists mail_codes (
  id text primary key,
  email text not null,
  user_id text,
  purpose text not null check (purpose in ('reset', 'confirm', 'change')),
  code_hash text not null,
  new_email text,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists mail_codes_lookup_idx on mail_codes (email, purpose, created_at desc);
create index if not exists mail_codes_user_idx on mail_codes (user_id, purpose, created_at desc);
