# DROIN — Backend

Bun + Hono + PostgreSQL. Migrations are plain SQL files in `migrations/`.

```bash
bun install
bun run db:up      # start Postgres in Docker (Docker Desktop must be running)
bun run migrate    # apply migrations that have not run yet
bun run dev        # API at http://localhost:3000 (check: GET /health)
bun test           # run the tests against a separate bukukas_test database
bun run typecheck
```

API docs (Swagger UI): http://localhost:3000/docs. Register or log in there, then press **Authorize** and paste
the token. The spec lives in `openapi.yaml` and is written by hand: update it whenever an endpoint changes.

New migration: add a file `NNN_name.sql` with the next number. Applied files are recorded in `schema_migrations`.

## Accounts

Everything except `/health`, `/auth/register` and `/auth/login` needs `Authorization: Bearer <token>`.
Tokens last 90 days (extended while in use); only their hash is stored.

Data created before accounts existed belongs to `owner@localhost`, which has no password yet:

```bash
bun run set-password owner@localhost <new-password>
```

## Features

| Area | Endpoints | Notes |
|---|---|---|
| Auth | `/auth/*` | register (seeds default categories), login, logout, profile, password |
| Wallets | `/wallets` | type, icon, color, opening balance, archive |
| Categories | `/categories` | icon, color, archive; system categories for opening balance and transfer fees |
| Transactions | `/transactions` | search `q`, `tag`, `origin`, `X-Total-Count` header, tags |
| Receipts | `/transactions/:id/attachments`, `/attachments/:id` | jpeg/png/webp/heic/pdf, max 5 MB, stored in `UPLOAD_DIR` |
| Transfers | `/transfers` | optional admin `fee`, counted as an expense |
| Reports | `/reports/categories, tags, balances, monthly, daily` | transfers and debts are never income/expense |
| Budgets | `/budgets`, `/budgets/status` | per category or overall, monthly; spent / remaining / daily allowance |
| Recurring | `/recurring` | auto-create or confirm/skip; the scheduler runs due rules every 10 minutes |
| Goals | `/goals` | deposits/withdrawals, progress, monthly amount needed |
| Debts | `/debts` | payable/receivable, repayments, optional wallet movements |
| Tags | `/tags` | created on the fly from transactions |
| Insights | `/insights` | spending pace, budget alerts, savings rate, due debts/goals, "Nothing happened here. Suspicious." |
| Quick input | `/quick-input/parse`, `/quick-input/voice` | "makan 25k gopay kemarin" → a transaction draft; voice: a recording → transcript + drafts (needs `STT_API_KEY`) |
| Export | `/export/transactions.csv`, `/export/monthly-report.html` | CSV for Excel; HTML report → PDF via expo-print |
| Sync | `/sync/changes?since=` | changed rows + deletion tombstones for offline phones |
| Notifications | `/notifications/*` | Expo push tokens, daily reminder at the user's chosen time |

### Safe retries

Send an `Idempotency-Key` header (a UUID created when the user taps Save) with POST requests. If the
request is retried with the same key, the first response is returned (`Idempotency-Replayed: true`)
instead of creating a duplicate. Keys are kept for 24 hours.

### Background jobs

`src/scheduler.ts` runs inside the API process: daily reminders (every minute), recurring rules
(every 10 minutes) and idempotency-key cleanup (hourly).

## Environment

See `.env.example`: `PORT`, `DATABASE_URL`, `TEST_DATABASE_URL`, `UPLOAD_DIR`, and `PUSH_NOTIFICATIONS`
(`off` logs push notifications instead of sending them through Expo), and `STT_*` for voice input:
an OpenAI-compatible speech-to-text API (Groq by default; OpenAI works with `STT_API_URL`/`STT_MODEL`).
Without `STT_API_KEY`, `POST /quick-input/voice` answers 503 and the app falls back to typing.
