---
name: fbrain-tooling
type: convention
audience: lolly, openclaw agents inside the lolly pod
applies_to: every fbrain CLI invocation from inside lolly
last_updated: 2026-05-17
---

# fbrain tooling — invocation rules

Read before invoking any fbrain command from inside the lolly pod.

## Always use the wrapper

There's exactly **one** correct path to fbrain CLI from inside the pod:

```
/sandbox/.local/bin/gbrain <subcommand> [args]
```

The wrapper auto-loads:
- `DATABASE_URL` pointing at the pg-relay (so writes hit host PG, not a fresh PGLite).
- Bedrock + OpenAI credentials from `/sandbox/.secrets/`.
- Anthropic Messages API routing through the openclaw gateway.
- Destructive-subcommand deny-list.

## Forbidden invocation patterns

These bypass the wrapper. **DO NOT** use them:

| Pattern | Why it's wrong |
|---|---|
| `/sandbox/gbrain/bun run src/cli.ts ...` | Bypasses env loading; falls through to fresh PGLite. Also: not allowlisted in openclaw exec-approvals — will block + require operator approval per call. |
| `/sandbox/gbrain/bun /sandbox/gbrain/fbrain/src/cli.ts ...` | Same problem, more explicit. Same operator-approval requirement. |
| `bash -c "gbrain ..."` | The wrapper detects shell-wrap parents and refuses (evasion guard). Set `GBRAIN_ALLOW_DESTRUCTIVE=1` only if intentional + audited. |
| `sh -c "gbrain ..."` / `zsh -c ...` / `eval gbrain ...` | Same as above. |

## What gets denied (even via the wrapper)

The wrapper refuses these subcommands by default:

- `sources remove` — cascades to pages/chunks/embeddings. The `--keep-storage` flag is a stub in upstream; it does **not** preserve data.
- `sources purge` — hard-delete archived sources.
- `pages purge-deleted` — hard-delete soft-deleted pages.
- `repair-jsonb` — rewrites JSONB columns.
- `apply-migrations` — schema mutation.
- `init` — would overwrite config.
- `migrate` — engine swap.
- `config set DATABASE_URL` / `GBRAIN_DATABASE_URL` — redirects writes.

If you need these, **escalate to the operator**. Do NOT attempt to bypass via shell-wrap, direct CLI, or `GBRAIN_ALLOW_DESTRUCTIVE=1`. The wrapper logs every bypass attempt.

## Use soft-delete instead

For 95% of "I need to remove a thing" situations, use the soft-delete path:

| Want to … | Use this | Recovery |
|---|---|---|
| Hide a source from search | `gbrain sources archive <id>` | `gbrain sources restore <id>` (within 72h) |
| Delete a page | MCP `delete_page` (soft) | MCP `restore_page` (within 72h) |
| Stop syncing a path | edit `dream.synthesize.session_corpus_dir` config | revert config |

Hard-delete is the operator's call, not yours.

## When operator-approval kicks in

If you accidentally invoke a non-wrapper path (e.g., `/sandbox/gbrain/bun ...`), openclaw exec-approvals will block the call and surface a prompt to the operator. **Do not retry** — re-issue via the wrapper. The retry loops are the most common pattern for accidental destructive calls in agent logs.

## Audit trail

Every wrapper invocation that hits the deny-list or evasion guard writes to stderr. Conversation logs surface those errors to the operator. If you see your own wrapper-deny error, that's a signal: ask the operator, don't retry.
