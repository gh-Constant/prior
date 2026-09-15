# Prior architecture

The client is a Vite React TypeScript application wrapped by Tauri 2. React owns presentation and interaction; local persistence, network calls, and authentication are isolated in small services.

The authoritative local store is SQLite through Tauri SQL migrations. A browser fallback in `app/src/lib/localStore.ts` exists so the product can be previewed and tested without a native shell. Each local write is paired with an outbox mutation ID.

The API is one Go process backed by PostgreSQL. It uses an append-only change log with a monotonic revision sequence. Push is idempotent by `(user_id, mutation_id)`, pull is `GET /v1/sync/pull?since=`, and realtime is only a lightweight “sync required” WebSocket invalidation. The server applies the last accepted mutation in revision order.

Google proves identity; Prior creates opaque device sessions. Raw session tokens are hashed in PostgreSQL. No Google access or refresh tokens are retained. Native desktop builds route the session token through a small Rust command backed by the OS credential store. Android routes the same commands through a native Tauri plugin backed by Android Keystore + AES-GCM. Browser preview uses a local fallback so the UI can run without Tauri. The Android widget receives a bounded three-item snapshot from the same client and refreshes on local/sync changes; it never depends on the React webview being alive.
