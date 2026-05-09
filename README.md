# 11Mirror — Enterprise Knowledge Plugin

Enterprise knowledge layer for finance operations. Connects to company knowledge brain (people, playbooks, SOPs) and structured data graph (accounting, procurement, vendor payments, financial reports).

Built for Claude Cowork, also compatible with Claude Code.

## Installation

### Cowork
Install from [claude.com/plugins](https://claude.com/plugins/) or:
```bash
claude plugins add 11mirror
```

### Claude Code
```bash
claude plugin install 11mirror
```

### OpenClaw
This repository includes `openclaw.plugin.json` for OpenClaw installs. Configure the plugin with:

| Key | Description |
|-----|-------------|
| `gateway_url` | HTTPS URL of the 11Mirror gateway `/mcp` endpoint, for example `https://connect.neuu.in/mcp` |
| `gateway_api_key` | Bearer token for the gateway |

## Capabilities

### Knowledge Brain (People & Process)
- Query people, relationships, contacts
- Search playbooks, SOPs, operational processes
- Retrieve meeting notes, decisions, action items
- Store new process knowledge

### Structured Data (Enterprise Graph)
- Query financial records, accounting data
- Search vendor master data, supplier info
- Analyze org structure, department hierarchies
- Ingest structured business data

## Skills

This plugin ships 41 skills (as of v0.26.6-fbrain.1) covering:
- **Brain operations** — query, search, enrichment, ingestion, citation fixing
- **Content capture** — ideas, articles, media, meetings, voice notes, signals
- **Maintenance** — dream cycle, orphan detection, frontmatter guard, testing
- **Operations** — task management, briefing, cron scheduling, reports, minion orchestration

See `skills/RESOLVER.md` for the full skill dispatch table.

## Tools behind the MCP gateway

The gateway exposes **47 tools** through a single `/mcp` endpoint:

- **44 fbrain tools** for people, playbooks, meeting notes, and prose knowledge. Primary ones: `query`, `search`, `get_page`, `list_pages`, `put_page`, `traverse_graph`, `get_backlinks`, `get_chunks`. Write via `put_page`, `add_link`, `add_tag`, `add_timeline_entry`.
- **3 cognee tools** for the structured-data knowledge graph: `graph_query` (synthesized answer via GRAPH_COMPLETION), `entity_search` (raw chunk hits via CHUNKS), `knowledge_ingest` (text → `add` + `cognify` pipeline).

Call `fbrain_route` first in every session — it returns the live routing protocol. Tool schemas are always discoverable via MCP `tools/list`.

### Cognee tool naming vs upstream cognee-mcp

Upstream cognee-mcp exposes a deliberately abstracted "Minimal Memory API" (`remember`, `recall`, `forget`) over `@mcp.tool()`. 11Mirror proxies cognee's native HTTP surface (`/api/v1/search`, `/api/v1/add`, `/api/v1/cognify`) and names the tools after their domain role: `graph_query`, `entity_search`, `knowledge_ingest`. If you are reading cognee docs that reference `remember`/`recall`/`forget`, the mapping is:

| cognee-mcp (upstream) | 11Mirror gateway | Native HTTP |
|---|---|---|
| `remember` | `knowledge_ingest` | `POST /api/v1/add` then `POST /api/v1/cognify` |
| `recall` (graph) | `graph_query` | `POST /api/v1/search` with `search_type: GRAPH_COMPLETION` |
| `recall` (chunks) | `entity_search` | `POST /api/v1/search` with `search_type: CHUNKS` |
| `forget` | _not proxied_ | cognee REST delete endpoints |

### Cognee dataset naming gotcha

The 11Mirror librarian stores content under `{tenant}__{dataset}`, so the cognee dataset name an agent queries is not what a human typed when running `librarian-ingest`. Current production datasets on the primary deployment:

- `netsuite-schema-data` (schema DB ingested direct, no tenant prefix)
- `default__netsuite-rules` (4 YAML rule files ingested via the `file` subcommand)

Pass these names as `dataset_name` on `graph_query` / `entity_search`. Calling these tools with no dataset returns an error.

## Configuration

Add additional data source MCP servers to `.mcp.json`:

| Category | Purpose |
|----------|---------|
| `erp-accounting` | ERP system for GL, subledger, JE data |
| `data-warehouse` | Financial queries and historical data |
| `spreadsheets` | Workpaper generation |

## Routing Protocol

The `fbrain_route` tool returns the routing protocol on first call. It teaches the agent:
- Which tools to use for which queries (all 47, split by engine)
- How to search before guessing
- When to store new knowledge
- How to present unified responses under the 11Mirror brand

`fbrain_route` also points at two key resources: `fbrain://docs/AGENTS.md` (operating protocol) and `fbrain://skills/RESOLVER.md` (skill dispatcher). Both have been extended with 11Mirror-specific routing — read them before acting.
