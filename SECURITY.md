# Security policy

11Mirror sits between AI agents and enterprise data. Security bugs here are
serious. Please report them responsibly.

## Reporting a vulnerability

Do **not** file a public GitHub issue for security problems.

Email: `kali@neuu.in` with subject `11mirror-plugin security:` followed by a
one-line summary.

Include:
- A description of the vulnerability
- Steps to reproduce (minimal)
- What the attacker gains (credentials, data, DoS, RCE, etc.)
- Your suggested severity
- Whether you've notified anyone else

You should receive an acknowledgment within 72 hours. Coordinated disclosure
window is 90 days by default; shorter if the bug is being actively exploited.

## What's in scope

This repo's surface:
- `bin/mcp-stdio-bridge.js` — config loading, token handling, HTTP client, stdin/stdout contamination
- `openclaw.plugin.json` and `marketplace.json` — manifest injection, placeholder expansion
- `examples/claude-code.mcp.json` — any way a user pasting this into their project exposes credentials
- Skills under `skills/` — prompt injection, data exfiltration, skill-chain confusion

What's **out** of scope for this repo (report to the right place):
- Gateway vulnerabilities → [11mirror-stack](https://github.com/Postergully/11mirror-stack)
- fbrain or Cognee engine vulnerabilities → the respective upstream repos
- OpenClaw plugin-loader vulnerabilities → OpenClaw maintainers

## Trust model

Read `CLAUDE.md` ("Trust boundary") for the full picture. Key points:

1. **The agent is untrusted.** Every tool call goes through the HTTPS gateway,
   which enforces allowlists and tenant scoping. The bridge is a passthrough —
   it cannot grant privileges the gateway refuses.

2. **The bearer token is the only credential.** Possession of
   `gateway_api_key` grants full access to the configured tenant. Treat it
   like a database password.

3. **Config resolution is ordered.** The bridge prefers env > `.config.json` >
   OpenClaw config. A compromised env can override file-based config; this is
   intentional (it lets operators rotate without touching disk) but means
   anyone who can set env vars for the spawned bridge process can redirect it
   to a rogue gateway.

4. **stdin/stdout are typed.** The bridge writes MCP JSON-RPC to stdout and
   diagnostics to stderr. Never put tokens, keys, or payload data in stdout —
   that stream is consumed by the MCP client and may be logged.

## Credential handling — rules for operators

- `.config.json` must be `chmod 600` (readable only by the user running the bridge).
- Never check `.config.json` into version control. The repo has no `.gitignore` entry for it only because the file simply should never appear at the repo root.
- Rotate the gateway API key if any of: token appears in logs, git history, shared Slack/email, or a decommissioned operator's machine. Rotation is a gateway-side operation — see the 11mirror-stack docs.
- Sandbox egress should allowlist only the gateway host + Node binary. Broader egress lets a compromised skill ship data elsewhere.

## Known threat vectors

Listed so contributors know what we actively guard against. Not a confession —
these are patterns we've designed against.

- **Prompt injection in ingested content.** Content ingested via `put_page` or `knowledge_ingest` may try to redirect the agent. Mitigations live in the gateway (`instructions` field + `fbrain_route` routing) and in skill conventions (citation-fixer, frontmatter-guard). If you find a bypass, report it.
- **Tool-name confusion.** An attacker who controls skill content could suggest the agent call a tool that doesn't exist in hopes the agent fabricates output. The gateway's `tools/list` is authoritative — skills should never claim a tool exists without verification.
- **Session-id hijack.** The bridge propagates `Mcp-Session-Id` returned by the gateway. A rogue gateway could set a session id the agent then echoes. Mitigation: operators must verify the `gateway_url` before installing.
- **Config file substitution.** If an attacker can write `/opt/11mirror/.config.json`, they can redirect the bridge. `chmod 600` + ownership is the defense. The bridge logs the resolved config source to stderr every startup so operators can spot drift.

## What this repo does NOT do

We want contributors to know what's out of scope so they don't add it by mistake:

- The bridge does **not** cache tokens or bridge-level state beyond session id. No disk-backed credential store lives here.
- The bridge does **not** re-emit or log tool arguments. Don't add that — the gateway is the single logging point.
- The plugin does **not** ship with a default/embedded gateway URL or API key. There is no "try it out" path that preconfigures credentials.
- The plugin does **not** fetch or execute remote code at install or runtime.
