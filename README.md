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

This plugin includes 32 skills covering:
- **Brain operations** — query, search, enrichment, ingestion
- **Content capture** — ideas, media, meetings, signals
- **Maintenance** — dream cycle, orphan detection, citation fixing
- **Operations** — task management, briefing, cron scheduling, reports

See `skills/RESOLVER.md` for the full skill dispatch table.

## Configuration

Add additional data source MCP servers to `.mcp.json`:

| Category | Purpose |
|----------|---------|
| `erp-accounting` | ERP system for GL, subledger, JE data |
| `data-warehouse` | Financial queries and historical data |
| `spreadsheets` | Workpaper generation |

## Routing Protocol

The `fbrain_route` tool returns the routing protocol on first call. It teaches the agent:
- Which tools to use for which queries
- How to search before guessing
- When to store new knowledge
- How to present unified responses under the 11Mirror brand
