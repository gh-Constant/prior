# Authentication

Prior supports email/password authentication and Google OAuth. Passwords are hashed with bcrypt and are never returned by the API. `POST /v1/auth/register` creates an account and session; `POST /v1/auth/login` validates the credentials and creates a session. Email addresses are normalized to lowercase and are unique. Passwords must contain 8–128 characters.

Google OAuth runs in the system browser. The API owns the callback and asks only for `openid email profile`. It validates the authorization code exchange, issuer, audience, expiry, `sub`, verified email, and the OIDC nonce. A random state value and PKCE verifier are stored server-side with a short expiry. The callback creates a short-lived one-time Prior exchange code, never a long-lived session token in a URL.

Desktop returns to `prior://auth/callback?code=...`. Android may use the HTTPS App Link at `https://app.prior.constantsuchet.fr/auth/callback?code=...`. Both are allowlisted by `ALLOWED_AUTH_RETURN_ORIGINS`.

The `users.google_sub` field is nullable so password-only users can exist. The migration adds `password_hash` and keeps Google-only users compatible. The remaining Google production setup is external: verify the domain in Google Cloud, add the exact HTTPS callback, configure the OAuth consent screen, and set `GOOGLE_CLIENT_SECRET` only in Coolify.
