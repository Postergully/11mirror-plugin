# fbrain Install Guide for Lolly Agent (Phase 2)

Read this entire file, then follow the steps. Target: ~15 minutes to autopilot ticking inside lolly.

This runbook is for the **nanoclaw / openclaw agent running inside the lolly pod**.
Operator-driven host prep (egress policy, bundle push, secrets) MUST be complete
before you start. Verify with the operator that they have run:

  1. `./scripts/lolly-fbrain-snapshot-policy.sh`
  2. `./scripts/lolly-fbrain-add-egress-policy.sh` (with apply confirmation)
  3. `./scripts/lolly-fbrain-verify-egress.sh` (printed `OK: connected`)
  4. `./scripts/set-anthropic-key.sh` + `./scripts/set-openai-key.sh`
  5. `./scripts/lolly-fbrain-build-tarball.sh`
  6. `./scripts/lolly-fbrain-push-to-pod.sh`

If any of those is incomplete, STOP and ask the operator. Do not improvise.

## Step 1: Confirm bundle landed

```bash
ls /sandbox/gbrain
cat /sandbox/gbrain/manifest.json
ls /sandbox/.secrets/anthropic-key /sandbox/.secrets/openai-key
```

Verify: `bun`, `fbrain/`, `start-gbrain-daemon.sh`, `INSTALL_FBRAIN_FOR_AGENTS.md`,
`uninstall-fbrain.sh`, `manifest.json` present in `/sandbox/gbrain`. Manifest says
`fbrain_sha = baf1a47798cb145d00bfce4fa94f85a94c8d7e07`. Both secret files exist
with non-zero size.

If anything missing: ask operator to re-run `lolly-fbrain-push-to-pod.sh`.

## Step 2: Confirm DB is reachable from pod

```bash
node -e "
  const net = require('net');
  const sock = net.connect({ host: '192.168.65.254', port: 5433, family: 4 }, () => {
    console.log('OK'); sock.end(); process.exit(0);
  });
  sock.on('error', e => { console.error('FAIL', e.code); process.exit(1); });
  sock.setTimeout(5000, () => { console.error('TIMEOUT'); sock.destroy(); process.exit(1); });
"
```

Expected: `OK`. If `ECONNREFUSED`, the operator's egress policy entry didn't take —
ask them to re-run `lolly-fbrain-add-egress-policy.sh` and `verify-egress.sh`.

## Step 3: Install fbrain dependencies

```bash
cd /sandbox/gbrain/fbrain
/sandbox/gbrain/bun install
```

Expected: `bun install` completes. Some peer-dep warnings are normal; errors are not.

## Step 4: Initialize the brain repo + corpus dirs

```bash
mkdir -p /sandbox/.gbrain/brain /sandbox/.gbrain/corpus /sandbox/.gbrain/logs /sandbox/.gbrain/pids
( cd /sandbox/.gbrain/brain && \
  git init -b main && \
  printf '# 11mirror Brain\n\nInitialized: %s\n' "$(date -u +%FT%TZ)" > README.md && \
  git add README.md && \
  git -c user.email=lolly@local -c user.name='lolly' commit -m 'chore: brain repo init' )
ls /sandbox/.gbrain/
```

Expected: empty `corpus/`, `logs/`, `pids/`; `brain/` has one commit.

## Step 5: Confirm fbrain CLI is callable + discover subcommand surface

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@192.168.65.254:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts --help 2>&1 | head -50
```

Expected: a help text listing subcommands. Look specifically for:
- `jobs` (with `work` subcommand)
- `autopilot`
- `dream` (with `--phase synthesize` and a way to write pages back to disk)
- `config set` / `config get`
- `doctor`
- `stats`
- `skillpack`

**Report to the operator if any of these are missing or named differently.** The
daemon wrapper at `/sandbox/gbrain/start-gbrain-daemon.sh` assumes
`gbrain jobs work --watch` and `gbrain autopilot --start`. If the actual flags
differ, report exactly what `--help` prints and STOP.

## Step 6: Configure fbrain

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@192.168.65.254:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set sync.repo_path /sandbox/.gbrain/brain && \
DATABASE_URL=postgres://fbrain:fbrain@192.168.65.254:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set dream.synthesize.session_corpus_dir /sandbox/.gbrain/corpus && \
DATABASE_URL=postgres://fbrain:fbrain@192.168.65.254:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set dream.synthesize.excludePatterns '\bmedical\b,\blegal\b,\bcredit[ -]?card\b,\bssn\b,\bpassword\b,\bapi[ _-]?key\b,\bbearer\s+[A-Za-z0-9._-]{12,}\b,\bsk-[A-Za-z0-9]{20,}\b'
```

The 8-pattern excludePatterns set comes from Phase 1 Q3.d (decision doc:
`docs/superpowers/plans/2026-05-16-phase1-decisions.md`). Operator will confirm
or extend this list before transcripts are first written into corpus.

## Step 7: Run doctor

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@192.168.65.254:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts doctor --json | jq '.health_score, .status'
```

Expected: `health_score >= 80`, `status: "ok"` or `"warnings"`. **If status is
"errors", STOP and report which db_check failed.** Do not run the next steps until
doctor is clean.

## Step 8: Run dream once to spill DB pages out as markdown (optional but recommended)

The brain repo at `/sandbox/.gbrain/brain` is empty. Phase 1 Q1 noted the brain
has been DB-only — 30 pages exist in DB with `source_path = NULL`. Optionally run:

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@192.168.65.254:5433/fbrain \
ANTHROPIC_API_KEY=$(tr -d '\n\r' < /sandbox/.secrets/anthropic-key) \
OPENAI_API_KEY=$(tr -d '\n\r' < /sandbox/.secrets/openai-key) \
/sandbox/gbrain/bun run src/cli.ts sync --direction db-to-fs --dry-run
```

If `--direction db-to-fs` isn't a valid flag, look at `--help` for `sync` and find
the flag that exports DB pages to filesystem. Report back to the operator with the
real flag name and the dry-run output. **Do NOT run without `--dry-run` until the
operator approves the diff.**

## Step 9: Start the daemons

```bash
/sandbox/gbrain/start-gbrain-daemon.sh start
sleep 3
/sandbox/gbrain/start-gbrain-daemon.sh status
```

Expected: both `jobs-work` and `autopilot` show `pid <N>, last log: ...`. If
either says `not running`, tail the log:

```bash
tail -50 /sandbox/.gbrain/logs/jobs-work.log
tail -50 /sandbox/.gbrain/logs/autopilot.log
```

Most likely root causes if startup fails:
- DB unreachable → re-run Step 2 probe.
- Missing flag (e.g., `--watch` doesn't exist on `jobs work`) → report to operator,
  the daemon wrapper needs an edit.
- Secrets unreadable → `ls -la /sandbox/.secrets/`, both files mode 600, sandbox
  owner.

## Step 10: Report back

Report to the operator:

1. ✅ or ❌ for each step.
2. The output of `/sandbox/gbrain/start-gbrain-daemon.sh status`.
3. The first 5 lines of `/sandbox/.gbrain/logs/autopilot.log`.
4. The first 5 lines of `/sandbox/.gbrain/logs/jobs-work.log`.
5. Any subcommand surface differences from Step 5 (anything not where this runbook
   expected it).
6. A copy of `cat /sandbox/gbrain/manifest.json`.

The operator will run `docs/runbooks/lolly-fbrain-smoke-test.md` after your report.
