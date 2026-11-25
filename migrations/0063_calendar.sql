create table if not exists calendar_prefs (
  user_id text primary key references "user" (id) on delete cascade,
  tz text not null default 'Asia/Almaty',
  week_starts smallint not null default 1,
  default_reminder_min integer not null default 15
);

create table if not exists calendars (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  name text not null,
  color text not null,
  tz text not null default 'Asia/Almaty',
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists calendars_user on calendars (user_id);

create table if not exists calendar_events (
  id text primary key,
  calendar_id text not null references calendars (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  title text not null,
  notes text not null default '',
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  tz text not null default 'Asia/Almaty',
  rrule text,
  exdates timestamptz[] not null default '{}',
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calendar_events_user_span on calendar_events (user_id, starts_at, ends_at);
create index if not exists calendar_events_calendar on calendar_events (calendar_id);

create table if not exists calendar_reminders (
  id text primary key,
  event_id text not null references calendar_events (id) on delete cascade,
  minutes_before integer not null,
  remind_in_quiet boolean not null default false
);

create table if not exists calendar_reminder_queue (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  event_id text not null references calendar_events (id) on delete cascade,
  occurrence_at timestamptz not null,
  fire_at timestamptz not null,
  status text not null default 'pending',
  unique (event_id, occurrence_at, fire_at)
);
create index if not exists calendar_reminder_due on calendar_reminder_queue (fire_at, status);

alter table push_settings add column if not exists calendar boolean not null default true;
