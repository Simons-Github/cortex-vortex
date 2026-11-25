# Security notes

## BYOK threat model

Signed-in users can store their own Gemini key. It is encrypted with AES-256-GCM before it reaches the database.

- Ciphertext lives in the `private` schema, which PostgREST does not expose. The privileged RPCs refuse any JWT except `service_role`. The app server always keys rows by `auth.getUser()`, never by a client-supplied user id.
- The platform Gemini key and the encryption secret stay in server env (no `VITE_` prefix). After saving, the browser only sees a 4-character hint.
- XSS at the moment of paste can still steal a key sitting in the input. Plaintext is not persisted in `localStorage` or cookies.
- A compromised app server that also has `USER_KEY_ENCRYPTION_SECRET` can decrypt every stored key. That is expected without a KMS.
- `USER_KEY_ENCRYPTION_SECRET` has no rotation path: no dual-key decrypt and no re-encryption of existing rows. Payloads are version-prefixed (`v1.`), but there is no `v2` migration. Rotating would mean decrypting every row with the old secret and re-encrypting under a new prefix before removing the old secret. For now, a leaked master secret means every user has to paste their key again.
- Users should restrict their key to the Generative Language API in Google Cloud. IP allowlists are a poor fit for Vercel.

## Other controls

- Gemini is only called from TanStack Start server functions, which are covered by CSRF middleware (`src/start.ts`).
- Mastery, streak, custom topics and quiz attempts are SELECT-only for clients; writes go through SECURITY DEFINER RPCs.
- Topic-name moderation runs in the app server, not inside `create_custom_topic`. A direct PostgREST call to the RPC can skip the Gemini classification (quota and structural title checks still apply).
