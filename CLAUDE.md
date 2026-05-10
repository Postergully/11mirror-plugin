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

---

## Appendix: Lessons learned from shipping this plugin

Captured from PRs #4–#12 so the next integration doesn't re-run the same
archaeology. Every bullet below traces to a concrete failure we debugged, and
where possible the reference is an openclaw source file or a PR in this repo.

### A1. Three install surfaces, three different loaders

There is no single "Claude plugin" format. The same repo gets parsed three
different ways depending on who installs it:

- **Claude Code** reads `marketplace.json` at the repo root and `.mcp.json` in
  the consuming project. Supports `type: "http"` MCP servers natively;
  interpolates `${ENV_VAR}` from the user's shell env.
- **Cowork (Claude.com marketplace)** reads `marketplace.json` and follows the
  plugin's own manifest conventions. Behaves closer to Claude Code than to
  OpenClaw.
- **OpenClaw 2026.5.7** has TWO loader paths:
  - **Native bundle loader** — reads `openclaw.plugin.json` at the repo root.
    This is the preferred path. Gives us `configSchema`, `skills[]`,
    `excluded_from_install[]`, `openclaw.compat`.
  - **Claude-format bundle loader** — activates when `.claude-plugin/plugin.json`
    exists. Reads the MCP manifest from there and **ignores**
    `openclaw.plugin.json`. Source: `openclaw/dist/bundle-mcp-DPPOalPH.js` →
    `MANIFEST_PATH_BY_FORMAT.claude = ".claude-plugin/plugin.json"`.

**Rule:** decide one path and don't ship artifacts that accidentally trigger the
other. Shipping `.claude-plugin/plugin.json` alongside `openclaw.plugin.json`
loses: OpenClaw picks the Claude-format path and drops all the nice stuff.

### A2. OpenClaw native-bundle loader — what it actually does

From reading `bundle-mcp-DPPOalPH.js`:

- **Expands exactly one placeholder: `${CLAUDE_PLUGIN_ROOT}`.** Anything else
  (`${pluginDir}`, `${gateway_url}`, `${gateway_api_key}`, …) passes through as
  a literal string. Confirmed by the bridge receiving `process.env.GATEWAY_URL
  === "${gateway_url}"` and failing with `Failed to parse URL from
  ${gateway_url}`.
- **Does NOT interpolate `configSchema` values into subprocess env.** Even
  though `configSchema` is the mechanism the UI uses to collect values, those
  values do not propagate to the MCP child process. They're stored at
  `~/.openclaw/openclaw.json → plugins.entries.<plugin>.config` but never
  piped to the child.
- **Strips the parent process env when spawning MCP children.** Inside a
  sandbox, this means `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` all
  disappear. The child launches in a near-empty env.
- **Resolves relative `command` paths against the plugin root.** So
  `"command": "./bin/mcp-stdio-bridge.js"` works if the bridge has a shebang +
  `0755`. `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/bin/foo.js"]` also
  works.
- **`type` is implicit when `command` is set.** Declaring `type: "stdio"`
  explicitly sometimes triggers misinterpretation in downstream tooling — drop
  it unless you need HTTP.

### A3. The minimum viable OpenClaw MCP entry

```json
"mcpServers": {
  "<name>": {
    "command": "./bin/<bridge>.js",
    "args": []
  }
}
```

That's it. Everything else is either redundant, unsupported, or actively
harmful in one of the three loaders.

- **DO NOT** add `"type": "stdio"`.
- **DO NOT** add `"env": { "GATEWAY_URL": "${gateway_url}" }` — OpenClaw native
  won't interpolate it; the bridge has to self-configure anyway (A5). Leaving
  it in makes the debugging harder because the bridge will see literal
  placeholder strings.
- **DO NOT** add `.claude-plugin/plugin.json` or `.claude-plugin/marketplace.json`
  to try to broaden compatibility. See A1.
- **DO** keep `configSchema` at the top level of `openclaw.plugin.json` — UIs
  still use it for the config form. The bridge reads the persisted values
  itself (A5).

### A4. The stdio bridge pattern

When the target server is HTTP and the host only supports stdio MCP:

- **Zero npm dependencies.** Node 18+ has `fetch`, `readline`, `fs`, `path`,
  `os` as builtins. Adding `npm install` on top makes install-from-zip harder
  in sandboxes.
- **Shebang + `0755`.** `#!/usr/bin/env node` and `git update-index --chmod=+x`.
  Without these the relative-path `command` form can't spawn.
- **stdout is JSON-RPC only.** Every diagnostic goes to stderr. A single
  `console.log` with debug info breaks the MCP session.
- **Propagate `Mcp-Session-Id`.** The server sets it on the first response;
  the bridge must echo it on every subsequent request.
- **Handle both JSON and SSE.** The MCP HTTP transport lets the server pick
  `application/json` or `text/event-stream` per response. The bridge parses
  both.
- **Don't add policy.** No filtering, no tool-name rewrites, no request
  logging. The bridge is a dumb pipe; enforcement lives upstream in the
  gateway. Adding logic here creates two places the security review has to
  reason about.

### A5. Three-tier config resolution for bridges

Because OpenClaw doesn't interpolate configSchema into env (A2), the bridge
has to find its config itself. Ordered first-match-wins:

1. **Env vars** — for hosts that DO interpolate (Claude Code, future OpenClaw
   versions). Guard with a `looksUninterpolated()` check so `"${gateway_url}"`
   strings fall through instead of short-circuiting.
2. **`$CLAUDE_PLUGIN_ROOT/.config.json`** — the drop-in path for agent
   installs. The `INSTALL_FOR_AGENTS.md` runbook writes it with `chmod 600`.
3. **`~/.openclaw/openclaw.json → plugins.entries.<name>.config`** —
   OpenClaw's own persistence. Overridable via `$OPENCLAW_CONFIG` for testing.

Log the resolved source to stderr on startup (`[bridge] config source: <path>`).
Every field-debug session of this plugin has started with "which path did the
bridge take?" and that one line saves 20 minutes.

### A6. Sandbox-specific gotchas (NemoClaw / OpenShell)

- **Env strip + forced proxy.** Wrap the MCP command in `/bin/sh -lc` with
  inline env vars. Don't drop the `exec` — you need Node as PID 1 of that
  spawn so stdio and signals pipe correctly.
- **TLS intercept.** Sandboxes often MITM outbound TLS with their own CA. Set
  both `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE` to the vendor's bundle
  (`/etc/openshell-tls/openshell-ca.pem` for NemoClaw/OpenShell). Node's HTTPS
  client uses the former; tools that shell out to `curl`/`openssl` read the
  latter.
- **No outbound git.** Sandboxes commonly allow HTTPS to specific hosts but
  block `git://` and SSH to GitHub. Every install runbook targeting sandboxes
  must have a zip-drop fallback (download on the user's machine, upload
  through the sandbox's file-share path, `unzip` into place).
- **Single-line shell command in `args[1]`.** JSON escapes across newlines get
  mangled by at least one of the three loaders. Keep the wrapped command on
  one line.
- **Proxy IP is vendor-specific.** `10.200.0.1:3128` is NemoClaw/OpenShell.
  AWS Workspaces, Cursor sandboxes, Replit, and others use different
  addresses. Ask, don't assume.

### A7. Debugging checklist when something 401s / `fetch failed`s

In order — each step rules out the layer above:

1. **Gateway healthy?** `curl http://<gateway>/health` from your machine.
   200 → skip. Anything else → fix the gateway first.
2. **Bearer key correct?** `curl -H "Authorization: Bearer $KEY"
   <gateway>/mcp` with a real MCP `initialize` payload. 401 → wrong key. 200
   → skip.
3. **Bridge reaches the gateway from its own env?** `GATEWAY_URL=... GATEWAY_API_KEY=... node bin/mcp-stdio-bridge.js` locally with a piped
   `initialize`. stderr should say `config source: env` and a response should
   come back. Failure → bridge bug, fix here.
4. **Bridge sees config when spawned by the host?** Read stderr for the
   `config source:` line. If it says `Could not resolve …`, the host filtered
   env and none of the fallback files exist / are readable. Fix with
   `.config.json` (A5).
5. **Outbound HTTPS works from the spawn environment?** In a sandbox, the
   env-strip issue (A2, A6) eats `HTTPS_PROXY` and the bridge can't reach
   anything. Switch to the wrapped form.
6. **TLS intercept CA is trusted?** `NODE_EXTRA_CA_CERTS` missing → `fetch
   failed` with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` in stderr (if you're
   lucky) or just `fetch failed` (if you're not).

### A8. Two different "API keys", easy to confuse

- **Cognee API key** — issued in the Cognee UI dashboard. Authenticates
  against `:8000/api/v1/*`. Irrelevant to the plugin.
- **Gateway bearer (`GATEWAY_API_KEY`)** — a plain string in
  `11mirror-stack/.env`. Authenticates against `:8200/mcp`. This is the one
  the plugin needs. Rotate by editing `.env` and `cognee restart gateway`.

Pasting the Cognee UI key into `.config.json` returns `401` every time. The
error is identical to a wrong/absent gateway key — that's the trap.

### A9. What we'd do differently on a greenfield plugin

Tactical notes for the next one:

- **Start with `openclaw.plugin.json` and the stdio bridge from day one.**
  We wasted PRs #4, #6, #8 discovering the three-loader problem. If you know
  the host is OpenClaw, skip the `.claude-plugin/` and HTTP transport
  detours.
- **Write `INSTALL_FOR_AGENTS.md` before writing code.** The runbook forces
  you to think about the 8 steps an autonomous agent needs to execute. Every
  step that's unclear in the doc is a hidden assumption in the code.
- **Treat the bridge's stderr as the primary UX for agents.** Emit the
  config source, the gateway URL (not the key), the Node version, and any
  fallback decisions. Agents triage by grepping stderr; make that easy.
- **Ship `AGENTS.md` with engine routing rules.** For any multi-engine
  system (fbrain + Cognee here), agents will route the wrong way ~30% of the
  time without concrete example queries and dataset names. Don't make them
  infer.
- **Never commit `.config.json` or `.env`.** Add to `.gitignore` on day one.
  The PR that creates the runbook is the moment this risk enters the repo.

### A10. Reference artifacts

- `openclaw/dist/bundle-mcp-DPPOalPH.js` — ground truth for the native-bundle
  loader. Read before theorizing about what OpenClaw does.
- `garrytan/gbrain` repo — the reference plugin. `openclaw.plugin.json` shape,
  `AGENTS.md` + `INSTALL_FOR_AGENTS.md` structure. When in doubt, mirror it.
- This repo's PRs #4 (initial bridge), #6 (the `.claude-plugin/` detour — the
  lesson), #7 (three-tier config resolver), #8 (native-bundle fix — the real
  solution), #9 (runbook), #11 (zip-drop fallback), #12 (sandbox env-strip
  wrapper). Read in order for the full arc.
