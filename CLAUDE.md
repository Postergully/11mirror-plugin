# CLAUDE.md — 11Mirror plugin

Architecture and trust-boundary reference for agents editing this repo.

This plugin is **not** the 11Mirror engines. It's the thin agent-facing layer:
manifest, stdio MCP bridge, skill set, and docs. The engines (fbrain + Cognee +
gateway) live upstream in [11mirror-stack](https://github.com/Postergully/11mirror-stack).
Editing this repo cannot change engine behavior — only how agents reach it.

## Repository map

```
11mirror-plugin/
├── AGENTS.md                    # entry point for non-Claude agents (OpenClaw, Codex, ...)
├── INSTALL_FOR_AGENTS.md        # 8-step runbook the agent follows autonomously
├── README.md                    # human-facing overview
├── CLAUDE.md                    # this file — architecture ref for agents editing the plugin
├── CONTRIBUTING.md              # PR workflow + conventions
├── SECURITY.md                  # credential handling, trust boundary
├── CONNECTORS.md                # recommended .mcp.json connectors for finance ops
├── openclaw.plugin.json         # native-bundle manifest (configSchema, mcpServers, skills)
├── marketplace.json             # root manifest for Claude/Cowork plugin marketplaces
├── bin/
│   └── mcp-stdio-bridge.js      # stdio → HTTP MCP bridge. Zero npm deps. Self-configures.
├── examples/
│   └── claude-code.mcp.json     # template for Claude Code users (copy to project root)
└── skills/                      # ~42 skills (markdown dispatched via RESOLVER.md)
    ├── RESOLVER.md              # top-level skill dispatcher
    ├── _brain-filing-rules.md   # where files go
    ├── _output-rules.md         # output quality
    ├── _friction-protocol.md    # when to push back
    └── <skill-name>/SKILL.md    # individual skills
```

## The three surfaces

| Surface | Who consumes it | Key files |
|---|---|---|
| **Claude Code / Cowork** | users installing via `claude plugin install` or the Claude marketplace | `marketplace.json`, `examples/claude-code.mcp.json`, `skills/` |
| **OpenClaw (native bundle)** | OpenClaw's `plugins install` loader | `openclaw.plugin.json`, `bin/mcp-stdio-bridge.js`, `skills/` |
| **Agent-driven install** | any agent (OpenClaw, Codex, Cursor, Aider) reading the runbook | `AGENTS.md`, `INSTALL_FOR_AGENTS.md`, `bin/`, `skills/` |

Changes touching `openclaw.plugin.json` structure affect surface 2. Changes to
`examples/claude-code.mcp.json` affect surface 1. Changes to
`INSTALL_FOR_AGENTS.md` affect surface 3. Keep the three decoupled: a fix for
one surface should not silently change another.

## Trust boundary (critical)

The agent never has direct DB or filesystem access to the brain. Every call
traverses:

```
agent → stdio MCP bridge → HTTPS → gateway (:8200/mcp) → fbrain or Cognee
```

The gateway enforces:
- Tool allowlist (44 fbrain + 3 Cognee). Agents can't invoke anything else.
- `submit_job` type allowlist — `shell` is rejected over MCP.
- `purge_deleted_pages` is CLI-only. `delete_page` is soft; recovery window 72h.
- Tenant scoping on file uploads and ingestion.

The bridge is a thin passthrough — it does not interpret payloads, cache results,
or drop tools. It only: reads config, opens a TLS connection, forwards JSON-RPC,
propagates `Mcp-Session-Id`. Keeping the bridge dumb preserves the gateway as
the single enforcement point. Do not add filtering, logging of tool arguments,
or tool-name rewrites in the bridge.

## The stdio bridge (bin/mcp-stdio-bridge.js)

### Why it exists
OpenClaw 2026.5.7's bundle MCP loader only supports stdio transports. The
gateway is HTTP. The bridge translates.

### Config resolution
Three paths, first match wins:

1. **Env vars** `GATEWAY_URL` + `GATEWAY_API_KEY` — used when the host
   interpolates `configSchema` into subprocess env. OpenClaw's native bundle
   loader does NOT do this (confirmed in `bundle-mcp-DPPOalPH.js`, only
   `${CLAUDE_PLUGIN_ROOT}` is expanded). Claude Code's native MCP loader does,
   so this path is used there.
2. **`$CLAUDE_PLUGIN_ROOT/.config.json`** with `{gateway_url, gateway_api_key}`
   — drop-in override. The agent install runbook uses this path.
3. **`~/.openclaw/openclaw.json` → `plugins.entries.11mirror.config`** — where
   OpenClaw stores configSchema values. Overridable via `$OPENCLAW_CONFIG`.

Uninterpolated `"${...}"` env values are treated as absent and fall through
to the next path. The bridge logs its resolved source to stderr on startup.

### Invariants
- **Zero npm dependencies.** Node 18+ builtins only (fetch, readline, fs, path, os).
- **Shebang present, file mode 0755.** The manifest spawns the script directly;
  `git update-index --chmod=+x` if you ever lose the executable bit.
- **All errors go to stderr.** stdout is MCP JSON-RPC only — contaminating it
  breaks every session.
- **Session id propagation.** If the gateway returns `Mcp-Session-Id`, the
  bridge persists and re-sends it on every subsequent request.
- **SSE + JSON both supported.** The gateway may return either; the bridge
  parses both.

## Manifest rules (openclaw.plugin.json)

`mcpServers.11mirror` is deliberately minimal: `{command: "./bin/mcp-stdio-bridge.js", args: []}`.

- Do NOT add `type: "stdio"` — implicit, sometimes misinterpreted.
- Do NOT add `command: "node"` and put the script in `args` — the shebang
  handles that; the extra layer triggers some loaders' Claude-format detection.
- Do NOT add `env` with `${gateway_url}` placeholders — OpenClaw's native
  loader doesn't interpolate them; the bridge reads config itself.
- Do NOT add a `.claude-plugin/` directory. That forces `bundleFormat: claude`,
  which activates a different loader path that ignores `openclaw.plugin.json`
  entirely. (See PR #8 for evidence and fix.)

`configSchema` stays — UIs use it for the config form. `skills[]` stays — that's
the skill inventory. `openclaw.compat.pluginApi` stays — version gate.

## Skills

Every skill is a markdown file under `skills/<name>/SKILL.md`. The agent reads
`skills/RESOLVER.md` first and uses it to dispatch.

When adding a new skill:
1. Create `skills/<new-name>/SKILL.md` with YAML frontmatter (`name`, `description`, trigger hints).
2. Add a row to the appropriate section of `skills/RESOLVER.md`.
3. Add the path to `skills[]` in `openclaw.plugin.json`.
4. If the skill should NOT ship to users (e.g., setup/migrate/publish), add it to `excluded_from_install[]`.

Conventions under `skills/conventions/` apply to ALL brain-writing skills.
Shared deps (`_brain-filing-rules.*`, `_friction-protocol.md`, `_output-rules.md`)
are declared at the manifest root and loaded alongside any skill.

## Testing locally

No automated test suite lives in this repo — changes are verified against a
running 11mirror-stack gateway:

```bash
# From 11mirror-stack/
cognee status   # ensure gateway on :8200 is healthy

# From the plugin repo:
KEY=$(grep ^GATEWAY_API_KEY= ../11mirror-stack/.env | cut -d= -f2-)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | \
  GATEWAY_URL=http://localhost:8200/mcp GATEWAY_API_KEY="$KEY" \
  node bin/mcp-stdio-bridge.js
```

Expect an `initialize` response with `serverInfo.name == "11mirror-gateway"` and
the critical-system-rule `instructions` field. Follow with `tools/list` to see
all 47 tools.

## Common editing mistakes to avoid

- **Putting `.claude-plugin/plugin.json` back.** It was removed in PR #8 on
  purpose. Adding it re-breaks OpenClaw installs.
- **Editing fbrain skills in place.** fbrain ships skills of the same name; the
  plugin is a snapshot. If an upstream fbrain skill changes substantially,
  re-sync intentionally — don't hand-merge one-off diffs.
- **Adding provider-specific logic to the bridge.** If the gateway needs to
  treat an agent differently, that's a gateway change, not a bridge change.
- **Committing `.config.json`.** That file holds the bearer token. It's
  per-install, never in git. The repo has no `.config.json`; if you add it by
  accident, `git rm` it and rotate the key.
