-- Задания переноса сайта на свой сервер. Секретов и текста .env здесь нет.

create table if not exists backup_jobs (
  id text primary key,
  created_by text not null,
  status text not null default 'new',
  host_masked text not null default '',
  ssh_port int not null default 22,
  ssh_user text not null default '',
  app_port int not null default 3000,
  public_url text not null default '',
  options jsonb not null default '{}'::jsonb,
  token_hash text not null default '',
  token_expires_at timestamptz,
  percent numeric(5,2) not null default 0,
  stage text not null default '',
  message text not null default '',
  error text not null default '',
  heartbeat_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists backup_jobs_one_active_idx
  on backup_jobs ((1))
  where status in ('running', 'paused');

create table if not exists backup_steps (
  job_id text not null references backup_jobs (id) on delete cascade,
  key text not null,
  title text not null,
  weight int not null default 1,
  status text not null default 'pending',
  percent numeric(5,2) not null default 0,
  detail text not null default '',
  attempts int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  position int not null default 0,
  primary key (job_id, key)
);

create table if not exists backup_log (
  id bigserial primary key,
  job_id text not null references backup_jobs (id) on delete cascade,
  at timestamptz not null default now(),
  level text not null default 'info',
  step text not null default '',
  text text not null
);

create index if not exists backup_log_job_idx on backup_log (job_id, id desc);

create table if not exists backup_settings (
  id int primary key default 1 check (id = 1),
  mirrors jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into backup_settings (id) values (1) on conflict do nothing;
