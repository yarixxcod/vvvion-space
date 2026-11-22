-- Support tickets, reports and moderation. Additive only: existing tables stay.

alter table posts add column if not exists hidden_at timestamptz;

create table if not exists account_limits (
  user_id text primary key,
  posts_until timestamptz,
  suspended_until timestamptz
);

create table if not exists support_tickets (
  id text primary key,
  user_id text not null,
  category text not null,
  subject text not null,
  status text not null,
  priority text not null default 'normal',
  assignee_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists support_tickets_user_idx on support_tickets (user_id, updated_at desc);
create index if not exists support_tickets_status_idx on support_tickets (status, updated_at desc);

create table if not exists support_messages (
  id text primary key,
  ticket_id text not null references support_tickets (id),
  author_id text not null,
  body text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx on support_messages (ticket_id, created_at);

create table if not exists support_attachments (
  id text primary key,
  ticket_id text not null references support_tickets (id),
  message_id text,
  owner_id text not null,
  name text not null,
  mime text not null,
  bytes integer not null,
  data text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_attachments_ticket_idx on support_attachments (ticket_id);

create table if not exists content_reports (
  id text primary key,
  reporter_id text not null,
  target_type text not null,
  target_id text not null,
  author_id text,
  reason text not null,
  comment text not null default '',
  snapshot text not null default '',
  status text not null default 'new',
  priority text not null default 'normal',
  assignee_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_reports_open_idx
  on content_reports (reporter_id, target_type, target_id)
  where status in ('new', 'open');
create index if not exists content_reports_queue_idx on content_reports (status, priority, created_at desc);

create table if not exists moderation_actions (
  id text primary key,
  report_id text,
  actor_id text not null,
  target_user_id text,
  target_type text,
  target_id text,
  kind text not null,
  reason text not null,
  until_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists moderation_actions_user_idx on moderation_actions (target_user_id, created_at desc);
create index if not exists moderation_actions_report_idx on moderation_actions (report_id);

create table if not exists moderation_appeals (
  id text primary key,
  action_id text not null references moderation_actions (id),
  user_id text not null,
  body text not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists moderation_appeals_user_idx on moderation_appeals (user_id, created_at desc);

create table if not exists support_templates (
  id text primary key,
  title text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

create table if not exists support_events (
  id text primary key,
  actor_id text,
  kind text not null,
  ref_id text,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists support_events_created_idx on support_events (created_at desc);

create table if not exists support_notices (
  id text primary key,
  user_id text not null,
  title text not null,
  body text not null,
  href text not null default '/',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists support_notices_user_idx on support_notices (user_id, created_at desc);

insert into support_templates (id, title, body)
select v.id, v.title, v.body
from (
  values
    ('ask', 'Нужны подробности', 'Спасибо за обращение. Напишите, пожалуйста, что именно происходит и когда это началось.'),
    ('got', 'Жалоба получена', 'Жалоба принята. Мы посмотрим её и сообщим о результате, без лишних подробностей.'),
    ('done', 'Решение', 'Мы рассмотрели обращение и приняли решение. Если останутся вопросы, ответьте в этом диалоге.'),
    ('no', 'Отказ', 'По этим сведениям нарушения не видно, поэтому мера не применяется.'),
    ('fix', 'Как проверить', 'Обновите страницу. Если ошибка останется, пришлите скриншот и примерное время.')
) as v(id, title, body)
where not exists (select 1 from support_templates);
