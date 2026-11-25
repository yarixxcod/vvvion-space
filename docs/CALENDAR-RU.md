# Календарь

Личный календарь в разделе «Сервисы». Общих календарей и синхронизации с Google нет.

## Модель

Миграция `migrations/0063_calendar.sql`.

- `calendar_prefs` — пояс (по умолчанию `Asia/Almaty`), начало недели (понедельник), напоминание по умолчанию (15 минут).
- `calendars` — при первом заходе создаётся «Личный».
- `calendar_events` — время в `timestamptz`, пояс события в `tz`. Повтор — узкий RRULE: `FREQ` DAILY/WEEKLY/MONTHLY/YEARLY, `INTERVAL`, `BYDAY` только у WEEKLY, `UNTIL` или `COUNT` (не оба), плюс `exdates`.
- `calendar_reminders` и `calendar_reminder_queue`. Очередь строится на 35 дней вперёд. Чужой `user_id` не принимается: чужой id отвечает 404.

Правка и удаление повтора: `scope = this | this_and_future | all`. `this` ставит EXDATE (перенос — ещё и новое одиночное событие).

## API

`/api/calendar`, `/prefs`, `/$id`, `/events`, `/events/$id`, `/search`, `/free`, `/parse`, `/due`, `/cron`.
Окно выборки не длиннее 92 дней. Разбор фразы (`POST /parse`) ничего не сохраняет.

Deep link: `/?place=services&svc=calendar&event=<id>` и `/c/services?svc=calendar&event=<id>`.

## Агент

Инструменты `calendar_list`, `calendar_search`, `calendar_create`, `calendar_update`, `calendar_delete`, `calendar_free` выдаются только вошедшему пользователю и не в режиме «кто я». `user_id` из аргументов игнорируется. Удаление и правка серии (`all`, `this_and_future`) выполняются только с `confirm: true`; первый вызов возвращает `needs_confirm`.

## Напоминания

Cron `* * * * *` на `/api/calendar/cron` (секрет `CRON_SECRET` или `PUSH_CRON_SECRET`, как у `/api/push/cron`). Если план Vercel отклонит минутный cron, расписание нужно сменить на `*/5 * * * *`: на Hobby минутной доставки нет.

Пока сайт открыт, клиент раз в минуту зовёт `POST /api/calendar/due` и показывает `appNotify` канала `calendar`. FCM идёт через `sendPush` с видом `calendar` (тумблер включён по умолчанию, приоритет HIGH, TTL час). Тихие часы Москвы соблюдаются, кроме флага `remind_in_quiet` у конкретного напоминания.

Пока сайт не открыт в Windows-приложении и нет `FIREBASE_SERVICE_ACCOUNT_JSON`, фоновое напоминание на устройство не дойдёт. Web Notification API запрашивается только кнопкой в настройках календаря.

## Секреты (имена, не значения)

- `FIREBASE_SERVICE_ACCOUNT_JSON`, при необходимости `FIREBASE_PROJECT_ID`
- `CRON_SECRET` или `PUSH_CRON_SECRET`
- `google-services.json` в веб-репозиторий не кладётся
