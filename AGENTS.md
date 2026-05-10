# Agents working with 11Mirror

This is your install + operating protocol. Claude Code reads `./CLAUDE.md` in
the workspace automatically. Everyone else (OpenClaw, Codex, Cursor, Aider,
Continue, or an LLM fetching this file by URL): start here.

## What 11Mirror is

11Mirror is the integration layer between enterprises and their AI agents. It
composes two knowledge engines behind a single MCP gateway:

- **fbrain** — people, playbooks, SOPs, meeting notes, prose knowledge. Hybrid
  RAG with vector + keyword + multi-query expansion.
- **Cognee** — structured enterprise data (accounting, procurement, vendor
  payments, org structure). Knowledge graph with embeddings.

You talk to 11Mirror through **one endpoint** and **47 tools**. The gateway
routes each call to the right engine. Never call the underlying services
directly.

## Install (10 min)

If you are an OpenClaw agent being asked to install 11Mirror into a workspace,
read [`./INSTALL_FOR_AGENTS.md`](./INSTALL_FOR_AGENTS.md) and follow the 8-step
runbook. Do not try `openclaw plugins install` — that path has known issues with
`configSchema` interpolation and subprocess env filtering (see PR #8).

Short version:

1. `git clone https://github.com/Postergully/11mirror-plugin /opt/11mirror`
2. `openclaw mcp set 11mirror --json '{"command":"node","args":["/opt/11mirror/bin/mcp-stdio-bridge.js"]}'`
3. Drop gateway config at `/opt/11mirror/.config.json` (chmod 600)
4. `rsync -a /opt/11mirror/skills/ /sandbox/.openclaw/workspace/skills/11mirror/`
5. Copy this file into the workspace skill set
6. Allow egress to the gateway host + `/usr/local/bin/node`
7. Restart the gateway
8. Verify with `openclaw agent --message "use 11mirror__query ..."`

## Read this order

1. `./AGENTS.md` (this file) — install + operating protocol.
2. [`./INSTALL_FOR_AGENTS.md`](./INSTALL_FOR_AGENTS.md) — the 8-step install runbook.
3. [`./README.md`](./README.md) — human-facing overview: capabilities, tool list, cognee dataset names.
4. [`./CONNECTORS.md`](./CONNECTORS.md) — connector configuration (ERP, data warehouse, spreadsheets).
5. `./skills/RESOLVER.md` (inside the plugin) — skill dispatcher. Read before any task.

## 11Mirror operating protocol

### Rule 0 — Always call `fbrain_route` first

The gateway's `instructions` field enforces this. Every session starts with:

```
fbrain_route()
```

This returns the live routing protocol that tells you which tools to use for
which queries. Skipping this step produces wrong results — queries go to the
wrong engine and return empty or garbage.

### Which engine for which query

After `fbrain_route` you have 47 tools. The routing is:

- **People, playbooks, meeting notes, prose, process knowledge** → fbrain tools:
  `query`, `search`, `get_page`, `list_pages`, `put_page`, `traverse_graph`,
  `get_backlinks`, `get_chunks`, and ~36 others.
- **Structured business data** (accounting, procurement, vendor master, org
  hierarchy, GL codes, invoices, budgets) → Cognee tools: `graph_query`
  (synthesized answer), `entity_search` (raw chunks), `knowledge_ingest`.

If a query is ambiguous, default to `query` (fbrain hybrid) first. If it
returns nothing useful, try `graph_query` with the appropriate dataset.

### Cognee dataset names — read this before calling `graph_query`

The librarian stores content under `{tenant}__{dataset}`. The name the user
typed when ingesting is **not** the name you pass as `dataset_name`. Current
production datasets on the primary deployment:

- `netsuite-schema-data` (schema DB, no tenant prefix)
- `default__netsuite-rules` (YAML rule files, default tenant)

Calling `graph_query` or `entity_search` without `dataset_name` returns an
error. If the user's deployment is different, ask them for the dataset name
or list datasets via the gateway's admin endpoints.

### Writing new knowledge

- **Prose / meeting notes / playbooks** → `put_page` with full markdown +
  frontmatter. The engine chunks, embeds, reconciles tags, and extracts graph
  links automatically.
- **Structured text that should land in the graph** → `knowledge_ingest` (runs
  cognee's `add` + `cognify` pipeline).
- **Files (PDFs, images, attachments)** → `file_upload` with a page slug to
  associate.

Always backlink related pages via `add_link` (typed edges like `invested_in`,
`works_at`, `reports_to`). The graph is what makes future queries good.

### Trust boundary

The gateway sees every call. The agent does not have direct DB access. This
means:

- Destructive tools (`delete_page`, `purge_deleted_pages`) exist but `purge` is
  CLI-only — you cannot hard-delete over MCP. Treat `delete_page` as soft
  delete (recoverable within 72h via `restore_page`).
- File uploads are scoped to the workspace's tenant. You cannot read or write
  across tenants.
- Background jobs (`submit_job`) accept a type allowlist. The `shell` type is
  rejected over MCP — agents cannot exec arbitrary commands.

Assume the gateway enforces all of this. Do not try to bypass it.

### Stats, health, diagnostics

- `get_stats` → page count, chunk count, embedding coverage.
- `get_health` → stale pages, orphans, dead embeddings.
- `find_orphans` → pages with no backlinks. Good for enrichment cycles.
- `get_ingest_log` → recent ingestion events.

Run these periodically. A healthy brain has >95% embedding coverage and a
shrinking orphan count.

## Common tasks

- **Answer a user question** → `fbrain_route` → `query` → cite results with
  page slugs.
- **Add meeting notes** → `put_page` with markdown; let auto-link extract
  entities.
- **Check what's in the graph about a vendor** → `graph_query` with
  `dataset_name: default__<dataset>` + vendor name.
- **Weekly hygiene** → `get_health`, `find_orphans`, address gaps.

## Before reporting "done"

- If you wrote a page, confirm with `get_page`.
- If you added a link, confirm with `get_links` or `traverse_graph`.
- If you ingested data, confirm with `get_stats` (counts went up).
- Never say "the brain knows this now" without a read-back verifying it.

## Forks

If you are a fork, keep this file's structure but update paths, the gateway URL,
and the dataset-name table for your deployment. The operating protocol (Rule 0,
engine routing, trust boundary) stays the same.
