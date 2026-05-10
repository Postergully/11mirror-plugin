# 11Mirror Install Guide for AI Agents

Read this entire file, then follow the steps. Ask the user for values when needed.
Target: ~10 minutes to a working `11mirror__query` round-trip.

This runbook is for **OpenClaw agents** (and any other agent) installing 11mirror
into their own workspace. It is **not** a human-facing setup guide — humans should
read [`README.md`](./README.md). It is also not `openclaw plugins install` — that
path has known issues with `configSchema` interpolation and filtered subprocess env
(see [#8](https://github.com/Postergully/11mirror-plugin/pull/8)); this runbook is
the supported path.

Before you start, confirm with the user:
- The gateway URL (e.g., `https://connect.neuu.in/mcp`)
- The gateway API key (bearer token — treat as sensitive)
- The sandbox path layout (paths below assume `/opt/` and `/sandbox/`; adjust to match)

## Step 1: Clone the plugin repo

```bash
git clone https://github.com/Postergully/11mirror-plugin /opt/11mirror
```

Verify:

```bash
test -x /opt/11mirror/bin/mcp-stdio-bridge.js && echo ok
node --version   # must be 18+
```

If Node is missing or <18, ask the user to install Node 18 or newer before
continuing. The bridge has no npm dependencies — no `npm install` needed.

## Step 2: Register the MCP bridge with OpenClaw

```bash
openclaw mcp set 11mirror --json '{
  "command": "node",
  "args": ["/opt/11mirror/bin/mcp-stdio-bridge.js"]
}'
```

This writes an entry into `~/.openclaw/openclaw.json` under `mcp.servers.11mirror`.
The native OpenClaw loader spawns this command on every MCP session and pipes
JSON-RPC through stdin/stdout.

Verify:

```bash
openclaw mcp list | grep 11mirror
```

## Step 3: Drop gateway config where the bridge reads it

The bridge resolves `gateway_url` and `gateway_api_key` in this order:

1. Env vars `GATEWAY_URL` / `GATEWAY_API_KEY` (only works if the host interpolates them — OpenClaw currently does not)
2. `$CLAUDE_PLUGIN_ROOT/.config.json` with `{gateway_url, gateway_api_key}`
3. `~/.openclaw/openclaw.json` → `plugins.entries.11mirror.config`

Path 2 is the most reliable for agent installs. Drop a config file next to the
plugin:

```bash
cat > /opt/11mirror/.config.json <<'EOF'
{
  "gateway_url": "<ASK USER — e.g. https://connect.neuu.in/mcp>",
  "gateway_api_key": "<ASK USER — treat as sensitive>"
}
EOF
chmod 600 /opt/11mirror/.config.json
```

Then set `CLAUDE_PLUGIN_ROOT=/opt/11mirror` in the spawn env for the MCP bridge so
the bridge finds the file. If your OpenClaw version doesn't let you set per-server
env, skip this and use path 3 instead: add the config under
`plugins.entries.11mirror.config` in `~/.openclaw/openclaw.json`.

The bridge logs its resolved config source to stderr on startup, e.g.
`[11mirror-bridge] config source: /opt/11mirror/.config.json`. Use this to confirm
the right path was taken.

## Step 4: Deploy skills into the workspace

Skills are markdown files the agent reads at dispatch time. Copy them into the
workspace's skill directory:

```bash
rsync -a /opt/11mirror/skills/ /sandbox/.openclaw/workspace/skills/11mirror/
```

Verify the count matches the plugin's skill inventory (41 as of v0.26.6-fbrain.1):

```bash
ls /sandbox/.openclaw/workspace/skills/11mirror/ | wc -l
```

## Step 5: Teach the agent the operating protocol

The agent needs to know which tools exist, when to call `fbrain_route`, and how
to split queries between `fbrain` (people/prose) and Cognee (structured data).
Two options — pick one:

**Option A (preferred):** Copy this file into the workspace skill set so the
agent can re-read it on demand:

```bash
cp /opt/11mirror/AGENTS.md /sandbox/.openclaw/workspace/skills/11mirror/AGENTS.md
```

**Option B:** Append 11mirror's operating section to the workspace's root
`AGENTS.md` (if one exists). Look for the section headed "## 11Mirror operating
protocol" in `/opt/11mirror/AGENTS.md` and copy that block.

Either way, the agent's first-session routing MUST call `fbrain_route` before any
other 11mirror tool — the gateway's `instructions` field enforces this and
non-compliant sessions return wrong results.

## Step 6: Ensure egress is allowed

The bridge makes outbound HTTPS calls to the gateway. If the sandbox has an
egress policy, ask the user to:

- Allow the gateway host (from `gateway_url`) in the sandbox's outbound allowlist.
- Add `/usr/local/bin/node` (or wherever `node` resolves) to the binaries allowed
  to make network calls.

Verify:

```bash
node -e "fetch('<gateway_url>/health').then(r => r.text()).then(console.log).catch(console.error)"
```

Expect a `200` health response. A timeout or `ECONNREFUSED` means egress is
blocked; a `401` / `403` means egress works but the bearer token is wrong.

## Step 7: Restart the gateway container

11Mirror's gateway runs in Container A (see the main stack repo for the
container layout). The bridge talks to it over HTTPS, so the gateway must be
healthy.

```bash
openshell sandbox connect <container-a>
cognee restart gateway
```

Check `/health` returns `200` from inside the sandbox.

## Step 8: Verify

From the workspace, invoke a live round-trip:

```bash
openclaw agent --message "Use 11mirror__query to search for 'company overview' and list the first 3 results."
```

Expect a real response — a list of pages, not a "tool not available" refusal and
not an empty result. If the agent refuses, re-check Step 5 (the agent doesn't
know about the tool). If it returns empty, re-check Step 3 (config resolution)
and the bridge's stderr for the `config source:` line.

## Upgrade

```bash
cd /opt/11mirror && git pull origin main
rsync -a /opt/11mirror/skills/ /sandbox/.openclaw/workspace/skills/11mirror/ --delete
```

Re-register the MCP entry only if the bridge path or args changed. `.config.json`
is preserved across upgrades; `git pull` will not touch it.

## Troubleshooting

- **`config source: env` but gateway returns 401:** The host interpolated placeholder strings. Drop them from the MCP entry and rely on `/opt/11mirror/.config.json` (Step 3).
- **Bridge logs `Could not resolve gateway_url / gateway_api_key`:** None of the three resolution paths found both values. Check `ls -la /opt/11mirror/.config.json` and verify it's readable by the user spawning the bridge.
- **`fetch failed` with no status:** Egress is blocked. Re-check Step 6.
- **Tool not in `tools/list`:** Gateway isn't running or the bridge isn't reaching it. Run `node /opt/11mirror/bin/mcp-stdio-bridge.js` manually, send an `initialize` + `tools/list` on stdin, and read stderr.
