# Connectors

## How tool references work

Plugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~knowledge-brain` means the fbrain people & process engine.

This plugin is **tool-agnostic** — it describes workflows in terms of categories rather than specific products. The `.mcp.json` pre-configures the 11Mirror gateway, which provides both engines through a single MCP endpoint.

## Connectors for this plugin

| Category | Placeholder | Provided by | Domain |
|----------|-------------|-------------|--------|
| Knowledge brain | `~~knowledge-brain` | 11Mirror gateway (fbrain) | People, playbooks, SOPs, meeting notes, decisions |
| Enterprise data | `~~enterprise-data` | 11Mirror gateway (graph) | Accounting, procurement, vendor payments, financial reports |
| ERP / Accounting | `~~erp` | — (connect via .mcp.json) | NetSuite, SAP, QuickBooks, Xero |
| Data warehouse | `~~data-warehouse` | — (connect via .mcp.json) | Snowflake, BigQuery, Redshift |
| Spreadsheets | `~~spreadsheets` | — (connect via .mcp.json) | Google Sheets, Excel |

## Routing

The 11Mirror gateway exposes both engines through a single MCP endpoint. Routing is handled by the `skills/RESOLVER.md` dispatcher and the routing protocol returned by the `fbrain_route` tool.

- **People, processes, "who/how" questions** → knowledge-brain tools (query, search, get_page)
- **Financial data, accounting, vendor records** → enterprise-data tools (graph_query, entity_search)
- **Store new knowledge** → put_page (process) or knowledge_ingest (structured data)
