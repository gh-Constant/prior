# Synchronization

The local store is always the first write path. Outbox records contain a mutation UUID and the complete task snapshot at that point. The API treats a repeated mutation UUID as a successful no-op and returns the original canonical task.

Every accepted mutation gets a PostgreSQL sequence revision. Pull returns task snapshots after the client’s last server revision, including tombstones. A delete is a tombstone and is retained for at least 30 days before future compaction work is considered.

Conflicts are intentionally simple: the server’s accepted mutation order wins. A WebSocket event only says that a newer revision exists; clients still pull deltas over HTTPS. Missing WebSocket events are therefore harmless.

While a task has an unsynced outbox mutation, the client does not replace that task with an incoming remote snapshot. Once the mutation is accepted and its outbox entry is removed, the next pull reconciles the task using the server revision.
