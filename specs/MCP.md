# Claude Code / MCP connection

Prior's API exposes a remote [Model Context Protocol](https://modelcontextprotocol.io) server so Claude Code (or any MCP client) can read and edit a user's Prior data directly.

- Endpoint: `POST https://api.prior.constantsuchet.fr/mcp` (Streamable HTTP transport, stateless, JSON responses; `GET`/`DELETE` return 405).
- Auth: `Authorization: Bearer <key>`. Any live session works, but users should mint a dedicated key.
- Code: `server/internal/httpapi/mcp.go` (protocol + tools), `server/internal/store/mcp.go` (read queries).

## Connecting Claude Code

1. In Prior, open **Settings → Integrations → Claude Code** and click **Create access key**. The app shows the full command once:

   ```bash
   claude mcp add --transport http prior https://api.prior.constantsuchet.fr/mcp \
     --header "Authorization: Bearer <key>"
   ```

2. Run it once in a terminal. Add `--scope user` to make Prior available in every project. `claude mcp list` should show `prior … ✓ Connected`.

Without the app, a key can be minted with an existing session token: `curl -X POST https://api.prior.constantsuchet.fr/v1/mcp/tokens -H "Authorization: Bearer <session>"`.

To share the setup through a repository without committing the key, use a `.mcp.json` with environment expansion:

```json
{ "mcpServers": { "prior": { "type": "http", "url": "https://api.prior.constantsuchet.fr/mcp", "headers": { "Authorization": "Bearer ${PRIOR_MCP_TOKEN}" } } } }
```

## Access keys

`POST /v1/mcp/tokens` (session auth, rate-limited like settings) stores a session row with `platform = 'mcp'`, device name "Claude Code" and a 365-day TTL, and returns the raw key once. Only its SHA-256 hash is stored.

MCP keys are confined to `/mcp`: `UserForToken` and `SessionUserForToken` reject them, so a leaked key cannot read settings or API keys, change the password, mint more keys, or open the realtime socket. Keys are listed and revoked from the Integrations tab (they are regular sessions, so `DELETE /v1/sessions/{id}` and "sign out everywhere" revoke them too). `/mcp` is rate-limited to 120 requests per minute per key.

## Tools

| Tool | Effect |
| --- | --- |
| `list_tasks` | Open tasks by default (`filter`: open/completed/all), optional `query`, `project_id`, `due_before`, `limit`; sorted by due date then priority. Includes tasks of projects shared with the user. |
| `get_task` | One task with every field. |
| `create_task` | Title required; description, due/scheduled date and time, priority 1–4, importance, urgency, status, project/area, `reminder_at` (RFC 3339) and `checklist` (`[{title, done?}]`, at most 100). |
| `update_task` | Patch an existing task; omitted fields are kept, `null` clears optional dates, project/area and the reminder. `checklist` replaces the whole list (pass existing `id`s to keep items). |
| `complete_task` | Mark done, or reopen with `completed: false`. |
| `delete_task` | Soft-delete (same as deleting in the app). |
| `list_habits`, `create_habit`, `complete_habit` | Read habits, create one, check/uncheck a day (default today, UTC). |
| `list_projects` | Areas and projects with IDs, own and shared. |

Every write is a normal sync mutation through `Store.Push`, so validation, collaboration permissions, revisions, the change log and realtime notifications are exactly those of the apps: open Prior clients update immediately. Validation failures come back as tool results with `isError: true` so the model can correct itself.
