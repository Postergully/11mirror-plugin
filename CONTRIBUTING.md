# Contributing to 11Mirror plugin

Thanks for helping. This repo is the agent-facing layer for the 11Mirror
stack — thin by design. Most substantive changes happen upstream in
[11mirror-stack](https://github.com/Postergully/11mirror-stack). Before you
send a PR, check it fits the plugin surface.

## Does your change belong here?

Belongs in this repo:
- Stdio MCP bridge improvements (`bin/mcp-stdio-bridge.js`)
- Manifest changes (`openclaw.plugin.json`, `marketplace.json`)
- Agent-facing docs (`AGENTS.md`, `INSTALL_FOR_AGENTS.md`, `README.md`, `CLAUDE.md`)
- Skills (`skills/<name>/SKILL.md`) when adding an 11Mirror-specific flow
- Connector recommendations (`CONNECTORS.md`)
- Example configs (`examples/*.json`)

Belongs upstream in `11mirror-stack`:
- Tool changes (adding, renaming, or modifying any of the 47 MCP tools)
- Gateway behavior (routing, auth, rate limiting)
- Cognee or fbrain engine changes
- `fbrain_route` protocol content
- Cognee dataset naming or schema

Belongs upstream in `fbrain` itself:
- Core brain operations
- Skills that ship as part of the fbrain skill pack (most of `skills/`)

If you're unsure, open an issue first and ask.

## PR workflow

1. **Branch from main.** Use a descriptive name: `feat/...`, `fix/...`, `docs/...`.
2. **One concern per PR.** Don't bundle a bridge fix with a docs rewrite; reviewers need to reason about each surface independently.
3. **Local verification.** If you touched the bridge, run the smoke test in `CLAUDE.md` ("Testing locally"). Paste the output in the PR description.
4. **Commit style.** Conventional commits encouraged: `fix:`, `feat:`, `docs:`, `chore:`. Subject ≤72 chars; body explains *why*, not just *what*.
5. **PR description.** Link the issue, summarize the root cause, list acceptance criteria as checkboxes.
6. **Merge.** Squash-merge to keep history linear. Delete the branch after merge.

## Manifest changes — extra care

`openclaw.plugin.json` is parsed by three different loader implementations
(OpenClaw native bundle, OpenClaw legacy, Claude Code). Small-looking changes
can regress one of them silently. Follow the invariants in `CLAUDE.md` ("Manifest rules"):

- No `.claude-plugin/` directory.
- `mcpServers.11mirror` stays minimal (`command` + `args`).
- No `${gateway_url}` placeholders in `env` — the bridge self-configures.
- Shebang + 0755 mode on `bin/mcp-stdio-bridge.js`.

If you need to test against OpenClaw, coordinate with a sandbox agent — this
repo can't run OpenClaw inside itself.

## Skill changes

Before adding or editing a skill:

- **Is there an upstream fbrain equivalent?** If yes, make the change there
  and re-sync downstream. If the change is 11Mirror-specific (finance ops,
  NetSuite, SuiteQL, Cognee datasets), it belongs here.
- **Update RESOLVER.md.** Every skill needs a row in `skills/RESOLVER.md` so
  the agent can dispatch to it.
- **Update openclaw.plugin.json.** Add the skill path to `skills[]`. If it
  should not ship to users, add it to `excluded_from_install[]`.
- **Follow the conventions.** Read `skills/conventions/quality.md` and
  `skills/_brain-filing-rules.md` before writing.

## Documentation changes

Docs target three audiences. Don't conflate them:

- **`AGENTS.md`** — for non-Claude AI agents. Operating protocol, Rule 0, engine routing, trust boundary. Short.
- **`INSTALL_FOR_AGENTS.md`** — 8-step runbook an autonomous agent can follow. Copy/paste commands. Troubleshooting section.
- **`README.md`** — for humans. Install paths, capabilities, tool inventory, dataset names, where to go next.
- **`CLAUDE.md`** — for agents editing THIS repo. Architecture, trust boundary, invariants, common mistakes.

When you edit one, check whether the others need to stay in sync. A new config
path in the bridge affects all three audiences.

## Security

Never commit credentials. The bridge config file (`.config.json`) holds the
gateway bearer token and is explicitly per-install — it's not in the repo and
should not be. If you accidentally commit one, rotate the key immediately and
open a PR to remove the file (the history still has it; use `git filter-branch`
or let the maintainer handle rotation).

Report vulnerabilities privately — see `SECURITY.md`.

## License

By contributing, you agree your contributions are licensed under the same
terms as the rest of the repository.
