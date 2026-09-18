# Authentication

Prior supports email/password authentication and Google OAuth. Passwords are hashed with bcrypt and are never returned by the API. `POST /v1/auth/register` creates an account and session; `POST /v1/auth/login` validates the credentials and creates a session. Email addresses are normalized to lowercase and are unique. Passwords must contain 8–128 characters.

Google OAuth runs in the system browser. The API owns the callback and asks only for `openid email profile`. It validates the authorization code exchange, issuer, audience, expiry, `sub`, verified email, and the OIDC nonce. A random state value and PKCE verifier are stored server-side with a short expiry. The callback creates a short-lived one-time Prior exchange code, never a long-lived session token in a URL.

Desktop returns to `prior://auth/callback?code=...`. Android may use the HTTPS App Link at `https://app.prior.constantsuchet.fr/auth/callback?code=...`. Both are allowlisted by `ALLOWED_AUTH_RETURN_ORIGINS`. The Android manifest additionally declares a `prior://auth/callback` intent filter so the interstitial page returns without a manual tap.

Android prefers native sign-in: the app opens the system account picker via Credential Manager (`google_sign_in` plugin command) and posts the Google ID token to `POST /v1/auth/google/native`, which verifies signature/issuer/expiry, checks `aud` against `GOOGLE_NATIVE_AUDIENCES` (default: `GOOGLE_CLIENT_ID`), requires a verified email, and mints a session directly with no one-time code. Dismissing the picker does nothing; native failures fall back to the browser flow above. Native setup is external: create an Android OAuth client (package `fr.constantsuchet.prior` + debug/release SHA-1), add its client ID to `GOOGLE_NATIVE_AUDIENCES` (or bake the server client ID into the APK via `GOOGLE_SERVER_CLIENT_ID` at build time), and deploy a real `assetlinks.json` for the App Link return path.

The `users.google_sub` field is nullable so password-only users can exist. The migration adds `password_hash` and keeps Google-only users compatible. The remaining Google production setup is external: verify the domain in Google Cloud, add the exact HTTPS callback, configure the OAuth consent screen, and set `GOOGLE_CLIENT_SECRET` only in Coolify.

## Web secrets & sessions

Session tokens are stored per platform: native builds keep `session_token` in the OS keychain via Tauri commands (`session_get`/`session_set`/`session_clear`); the browser build falls back to `localStorage` (`prior.secret.session_token`) because it has no keychain. Secrets must never be logged, committed, or rendered. API key inputs use `autoComplete="off"`; the assistant chat input and model search are `autoComplete="off"` as well.

`AgentSidebar` holds the session token in React state only (memory): it is fetched once via `getToken()`, cleared when the user signs out, and never written to disk outside the secret store.

Sign-out (`clearSession`) removes the token from the secret store, drops the cached user, and clears assistant settings (`clearAgentSettings`, including the pre-v0.3.50 unscoped key) so a different account never inherits keys. Remote revocation (`POST /v1/auth/logout`) is best-effort after local state is already cleared.

Because browser `localStorage` is more exposed than the keychain, prefer a short `SESSION_TTL` (e.g. `168h`) when the API primarily serves the web client. `last_used_at` slides probabilistically (~1% of authenticated requests) so reads stay cheap.

`GET /v1/sessions` lists active sessions (the current one flagged), `DELETE /v1/sessions/{id}` revokes one, and `DELETE /v1/sessions` revokes all ("sign out everywhere"); live realtime sockets observe revocation within a minute and close with code `4401`. Every `401` response carries `{"code":"UNAUTHENTICATED","error":...}` for the client's central session handling.

Long-term direction is a backend-for-frontend: `POST /v1/agent/complete` proxies OpenRouter with the user's stored key (allowlisted models only, email redaction, budget logging). The client-direct OpenRouter path remains as fallback.
