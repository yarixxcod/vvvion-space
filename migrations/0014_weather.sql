-- Cities a person watches, and a short clothing-advice cache so the same sky
-- does not ask the model again for a few hours.

create table if not exists weather_cities (
  user_id text not null references "user" (id) on delete cascade,
  city text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, city)
);

create table if not exists weather_advice (
  cache_key text primary key,
  advice text not null,
  created_at timestamptz not null default now()
);
