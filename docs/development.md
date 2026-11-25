# Development

Requirements: Node.js 22+ and npm (CI uses `npm ci`). A Supabase project and Gemini key are optional; without them the app runs on mock data and localStorage.

## Environment

Copy `.env.example` to `.env`. All variables are optional for demo-only mode.

| Variable                        | Scope                  | Notes                                                     |
| ------------------------------- | ---------------------- | --------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Build + runtime        | Supabase project URL                                      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Build + runtime        | Publishable (anon) key                                    |
| `GEMINI_API_KEY`                | Server only            | Without it, Gemini endpoints fall back to mock data       |
| `GEMINI_MODEL`                  | Server only, optional  | Defaults to `gemini-3.6-flash`                            |
| `USER_KEY_ENCRYPTION_SECRET`    | Server only, BYOK      | `openssl rand -base64 32`                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only, BYOK      | Never in the client. If either BYOK var is unset, the personal-key form in Settings stays disabled |

Database setup is in [database.md](database.md).

## Scripts

| Command                                    | Description                                                 |
| ------------------------------------------ | ----------------------------------------------------------- |
| `npm run dev`                              | Dev server on port 8080                                     |
| `npm run lint`                             | ESLint                                                      |
| `npm run typecheck`                        | `tsc --noEmit`                                              |
| `npm run format`                           | Prettier                                                    |
| `npm run build`                            | Production build (client + Nitro)                           |
| `npm run preview`                          | Preview the local build                                     |
| `npm run test:e2e`                         | Playwright smoke tests (starts the dev server)              |
| `npm run test:e2e:ui`                      | Playwright UI mode                                          |
| `npx tsx scripts/test-topic-moderation.ts` | Gemini moderation cases + RPC/INSERT probes (needs `.env`)  |
| `npx tsx scripts/test-user-key-crypto.ts`  | AES-GCM roundtrip, AAD tamper, hint masking                 |
| `npx tsx scripts/test-error-redaction.ts`  | Error redaction checks                                      |

After a local Node-preset build: `node .output/server/index.mjs`.

Playwright needs Chromium only:

```sh
npx playwright install chromium
npm run test:e2e
```

To run against an already-deployed instance instead of `vite dev`, set `PLAYWRIGHT_BASE_URL`:

```sh
PLAYWRIGHT_BASE_URL=https://your-host.example npm run test:e2e
```

## Project structure

```
src/
  routes/       TanStack Router (landing, dashboard, study, matrix, settings)
  components/   Vortex (shader, atmosphere, particles), auth, topic dialogs, UI
  lib/          auth, mastery-store, gemini*, supabase, mock-data
  server/       token verification, burst/quota RPCs, BYOK crypto + store, topic documents
  styles.css    design tokens and animations
e2e/            Playwright specs
scripts/        tsx check scripts
supabase/sql/   schema, RLS, RPCs
```

## Deployment (Vercel)

`vercel.json` sets the framework to `tanstack-start`; Nitro builds the server. Leave Output Directory empty.

1. Apply `supabase/sql/` in the order from [database.md](database.md) before shipping app code. Shipping code first breaks custom-topic creation.
2. Add the production origin to the Auth redirect URLs.
3. Set the env vars above on Vercel. The service role key must never reach the client.

Production should have both Supabase and Gemini configured so quotas and live AI run. Demo mode is meant for local clones.

## Troubleshooting

- Custom topic creation fails after a deploy: the SQL is out of date. Re-run `user_gemini_keys.sql`, `create_custom_topic.sql`, then `ai_burst_limit.sql`.
- Personal-key form is disabled in Settings: `USER_KEY_ENCRYPTION_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` is unset.
- AI answers look canned: `GEMINI_API_KEY` is unset, so the mock fallback is active.
