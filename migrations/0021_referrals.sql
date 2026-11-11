-- One invite code per person. The inviter receives 1000 woobli once per new account.

create table if not exists referral_codes (
  user_id text primary key references "user" (id) on delete cascade,
  code text not null unique
);

create table if not exists referral_joins (
  invitee_id text primary key references "user" (id) on delete cascade,
  inviter_id text not null references "user" (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists referral_joins_inviter_idx on referral_joins (inviter_id, created_at desc);
