# Telegram workspace

## Setup

Admin → Telegram → paste BotFather token → Save and connect. The server verifies getMe, configures the production webhook, commands, description and menu. Diagnostics show API/webhook status, Telegram pending deliveries, linked accounts, delivery errors and last event. Repair refreshes commands and webhook without dropping pending updates. The old token is never returned to the browser. New token writes use AES-256-GCM with TELEGRAM_TOKEN_KEY or the existing stable BETTER_AUTH_SECRET; keep this key stable across deployments. Legacy plaintext tokens remain readable until replaced.

Users link their account from Profile → VVVion in Telegram. Codes expire after 15 minutes and are consumed atomically. Private chat and sender ID must match; callbacks recheck account bans. Bot replacement removes old Telegram links as before; token rotation for the same username preserves them.

## Commands

| Commands | Behavior |
| --- | --- |
| /ai, /ask question | Enable AI mode or ask once; plain messages in AI mode continue the selected conversation |
| /models | Paginated live site catalog, no API keys in callback data |
| /new, /chats, /stop | New conversation, continue one of the last eight site conversations, leave AI mode |
| /bank, /balance, /topup | Shared wallet, recent operations and authenticated site topup flow |
| /grant | Existing daily check-in link; no new minting logic |
| /books, /videos | Live shelf and video catalog with links |
| /files, /disk | Own recent file names / folders and links, or upload to Mega as before (Telegram 20 MB limit) |
| /friends, /requests, /say, /unread, /feed | Existing social actions and notifications |
| /profile, /admin, /help, /menu | Account, admin-only summary/link, help and navigation |

Games are excluded. Payment, transfers, purchases, role editing and model/price configuration stay in the site's authenticated screens; the bot does not ask for passwords or auto-confirm financial operations. AI responses are text-only: this release does not give Telegram models disk tools, web tools or image-generation capabilities.

## AI and delivery

The trusted server-only completion entry uses the site's model configuration, catalog prompts, ordered provider router and daily limit policy. Attempts and token usage go to the existing statistics. It never accepts a model endpoint or user ID from the Telegram message. Context is bounded to 20 text messages, 12k characters per message, output 3072 tokens, a 65-second overall deadline. Empty-text responses move to the next provider. A per-account lease prevents overlapping bot generations. Site and bot use saved_chats; each insert/append checks ownership and takes a short row lock. Cloud synchronization is not a CRDT; simultaneous edits from multiple website clients retain the existing site's conflict semantics.

The webhook verifies its secret, atomically records the update ID and acknowledges promptly using Vercel waitUntil. Duplicate update IDs do not run actions twice. At most 30 private-chat events per minute are dispatched. Delivery receipts track done/failed and diagnostic views flag stale processing records. This is at-most-once dispatch, not a transactional outbox: a function terminated after receipt claim can leave an incomplete action; it is shown as stale and the user can send a new command. No automatic replay of monetary or social actions.

The additive 0054 migration creates only telegram_sessions / telegram_updates and their indexes. An idempotent lazy initializer also installs these two empty tables on the first authenticated admin or valid webhook call, so build:web deployment does not need the broad migration runner. Existing wallets, purchases and history are untouched. No production database credentials or bot token were needed for development.

## Verification

Isolated PGlite integration tests execute the real webhook and workspace handlers against mocked Telegram and AI transports. They cover private sender checks, forged secrets, duplicate deliveries, one-time linking, bans, chat ownership, encrypted token roundtrips/tampering, failed provider lease release, busy session guards, file ownership and non-mutating wallet reads, plus diagnostics and menu repair. Full site checks and mobile/desktop admin UI verification run separately. A live BotFather token and linked Telegram user are required for the final real Telegram network smoke test; automated tests do not message production users.
