drop table if exists desktop_release;
drop table if exists desktop_release_pref;
alter table app_release drop column if exists storage;
