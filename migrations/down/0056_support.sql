-- Rollback for 0056_support. Does not touch chat_attempts, posts rows, or members bans.

drop table if exists support_notices;
drop table if exists support_events;
drop table if exists support_templates;
drop table if exists moderation_appeals;
drop table if exists moderation_actions;
drop table if exists content_reports;
drop table if exists support_attachments;
drop table if exists support_messages;
drop table if exists support_tickets;
drop table if exists account_limits;
alter table posts drop column if exists hidden_at;
