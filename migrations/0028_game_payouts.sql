-- Payouts from the merge counter. The daily cap is enforced in the server function.

create table if not exists game_payouts (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  amount integer not null,
  created_at timestamptz not null default now()
);

create index if not exists game_payouts_user_idx on game_payouts (user_id, created_at desc);
