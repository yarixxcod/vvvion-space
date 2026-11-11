-- Toy bank: starting balance, daily stipend, transfers, and a limit shop.

create table if not exists wallets (
  user_id text primary key references "user" (id) on delete cascade,
  balance integer not null default 0,
  last_grant_at timestamptz not null default now()
);

create table if not exists wallet_transfers (
  id text primary key,
  from_id text references "user" (id) on delete set null,
  to_id text references "user" (id) on delete set null,
  amount integer not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists wallet_transfers_from_idx on wallet_transfers (from_id, created_at desc);
create index if not exists wallet_transfers_to_idx on wallet_transfers (to_id, created_at desc);

create table if not exists limit_boosts (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  extra_requests integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists limit_boosts_user_idx on limit_boosts (user_id, expires_at desc);
