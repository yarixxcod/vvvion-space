-- Bank credit. One open loan per person. Overdue debt is written onto the balance.

create table if not exists bank_loans (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  principal integer not null,
  left_amount integer not null,
  due_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bank_loans_open_idx on bank_loans (user_id) where closed_at is null;

-- Optional profile lines. Not shown outside the profile yet.

create table if not exists profile_facts (
  user_id text primary key references "user" (id) on delete cascade,
  country text not null default '',
  city text not null default '',
  birth_date text,
  updated_at timestamptz not null default now()
);
