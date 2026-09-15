# Authentication

Google OAuth runs in the system browser. The API owns the callback and asks only for `openid email profile`. It validates the authorization code exchange, issuer, audience, expiry, `sub`, verified email, and the OIDC nonce. A random state value and PKCE verifier are stored server-side with a short expiry. The callback creates a short-lived one-time Prior exchange code, never a long-lived session token in a URL.

Desktop returns to `prior://auth/callback?code=...`. Android may use the HTTPS App Link at `https://app.prior.constantsuchet.fr/auth/callback?code=...`. Both are allowlisted by `ALLOWED_AUTH_RETURN_ORIGINS`.

The remaining production setup is external: verify the domain in Google Cloud, add the exact HTTPS callback, configure the OAuth consent screen, and set `GOOGLE_CLIENT_SECRET` only in Coolify.
