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

### Sandboxed OpenClaw (no outbound git)

If `git clone` fails because the sandbox blocks outbound git/SSH (common in
locked-down OpenClaw containers — the sandbox can reach the gateway but not
GitHub), fall back to a user-mediated zip drop:

1. Ask the user to download the plugin zip from
   `https://github.com/Postergully/11mirror-plugin/archive/refs/heads/main.zip`
   on their own machine.
2. Ask them to place the zip at a known path inside the sandbox — the
   conventional location is `/sandbox/uploads/11mirror-plugin-main.zip` (or
   whatever upload path the sandbox exposes).
3. Unzip to `/opt/11mirror` and continue from Step 2:
   ```bash
   unzip -q /sandbox/uploads/11mirror-plugin-main.zip -d /tmp/11mirror-extract
   mv /tmp/11mirror-extract/11mirror-plugin-main /opt/11mirror
   chmod +x /opt/11mirror/bin/mcp-stdio-bridge.js
   ```

Verify as above. Skip `git pull` for upgrades; in sandbox mode, the user
repeats the zip-drop to upgrade. Everything else in this runbook works
identically — the manifest, the bridge, and the skills don't care whether
they arrived via git or zip.

If the sandbox also blocks HTTPS to the gateway host, stop here and ask the
user to update the egress policy before proceeding (Step 6 covers this, but
it's a blocker for the rest of the runbook too).

## Step 2: Register the MCP bridge with OpenClaw

```bash
openclaw mcp set 11mirror --json '{
  "command": "/usr/local/bin/node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/bin/mcp-stdio-bridge.js"]
}'
```

This writes an entry into `~/.openclaw/openclaw.json` under `mcp.servers.11mirror`.
The native OpenClaw loader spawns this command on every MCP session and pipes
JSON-RPC through stdin/stdout.

Verify:

```bash
openclaw mcp list | grep 11mirror
```

### NemoClaw / OpenShell sandbox (env-strip workaround)

OpenClaw 2026.5.7 **strips the parent process env when spawning MCP children**.
Inside a NemoClaw/OpenShell sandbox, that means `HTTPS_PROXY`,
`NODE_EXTRA_CA_CERTS`, and friends disappear — the bridge launches, can't reach
the proxy, and every `fetch` to the gateway fails with `fetch failed` (no
status). The bridge self-configures fine; the problem is one layer below.

Fix: wrap the command in `/bin/sh -lc` and set the env inline. Replace the
Step 2 invocation with:

```bash
openclaw mcp set 11mirror '{
  "command": "/bin/sh",
  "args": [
    "-lc",
    "HTTPS_PROXY=http://10.200.0.1:3128 HTTP_PROXY=http://10.200.0.1:3128 NO_PROXY=127.0.0.1,localhost,::1 NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/etc/openshell-tls/openshell-ca.pem SSL_CERT_FILE=/etc/openshell-tls/ca-bundle.pem exec /usr/local/bin/node ${CLAUDE_PLUGIN_ROOT}/bin/mcp-stdio-bridge.js"
  ]
}'
```

Important notes on this form:
- `10.200.0.1:3128` is the **NemoClaw/OpenShell** proxy address. Other sandbox
  vendors use different IPs/ports — ask the user or read the sandbox's
  networking docs before pasting this verbatim.
- `/etc/openshell-tls/openshell-ca.pem` is OpenShell's TLS intercept CA.
  If the sandbox intercepts TLS with a different CA bundle, point
  `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE` at the right file.
- `exec /usr/local/bin/node ...` replaces the shell with Node so signals and
  stdio pipe through cleanly — don't drop the `exec`.
- The outer JSON is a single line; the shell command inside `args[1]` uses
  spaces, not newlines. Keeping it on one line avoids JSON-escape headaches.

For OpenClaw installs **outside a sandbox** (no proxy, no TLS intercept), the
simpler non-wrapped form at the top of this step works fine. Use the wrapped
form only when you've confirmed the sandbox strips env and forces a proxy.

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
- **`fetch failed` with no status:** Egress is blocked, OR the host stripped the parent env and the bridge never saw `HTTPS_PROXY` / `NODE_EXTRA_CA_CERTS`. If you're in a NemoClaw/OpenShell sandbox, switch the MCP entry to the `/bin/sh -lc` wrapped form in Step 2. Outside a sandbox, re-check Step 6.
- **Tool not in `tools/list`:** Gateway isn't running or the bridge isn't reaching it. Run `node /opt/11mirror/bin/mcp-stdio-bridge.js` manually, send an `initialize` + `tools/list` on stdin, and read stderr.
