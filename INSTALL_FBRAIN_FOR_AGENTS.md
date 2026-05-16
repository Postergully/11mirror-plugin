# fbrain Install Guide for Lolly Agent (Phase 2)

Read this entire file, then follow the steps. Target: ~15 minutes to autopilot ticking inside lolly.

This runbook is for the **openclaw agent (lolly) running inside the openshell sandbox pod**.
Operator-driven host prep MUST be complete before you start. Verify with the operator that they have run:

  1. `./scripts/lolly-fbrain-snapshot-policy.sh` — captured live openshell policy.
  2. `./scripts/lolly-fbrain-add-egress-policy.sh` — added `fbrain_pg` entry with `allowed_ips`.
  3. `./scripts/lolly-fbrain-verify-egress.sh` — confirmed `HTTP/1.1 200 Connection Established` to host PG.
  4. `./scripts/lolly-fbrain-build-tarball.sh` + `./scripts/lolly-fbrain-push-to-pod.sh` — bundle landed at `/sandbox/gbrain/`.

If any of those is incomplete, STOP and ask the operator. Do not improvise.

## Credential strategy (read before Step 1)

fbrain inherits credentials from openclaw. **No new secret files are pushed by us.** The daemon shim in the bundle already knows where to read each:

| Need | Source | Notes |
|---|---|---|
| **Bedrock** (synthesize, dream cycle) | `/sandbox/.secrets/bedrock-key` | Already managed by openclaw. Daemon exports `AWS_BEARER_TOKEN_BEDROCK` + `AWS_REGION=us-east-1`. |
| **OpenAI** (embeddings — `text-embedding-3-large`, 1536 dims) | `/sandbox/.secrets/openai-key` | Phase 1 of the credential-providers migration injects this; operator runs nanoclaw's `set-openai-key.sh` + `restore.sh --inject-openai-key`. |
| **Anthropic Messages API** | openclaw gateway @ `127.0.0.1:18789` (translates → Bedrock) | Daemon exports `ANTHROPIC_BASE_URL=http://127.0.0.1:18789` + `ANTHROPIC_API_KEY` from `~/.openclaw/openclaw.json` `gateway.auth.token`. **No `/sandbox/.secrets/anthropic-key` file is required or expected.** |

If you see a reference to `/sandbox/.secrets/anthropic-key` anywhere, it's stale. Ignore it.

## Step 1: Confirm bundle landed

```bash
ls /sandbox/gbrain
cat /sandbox/gbrain/manifest.json
cat /sandbox/gbrain/EXPECTED_FBRAIN_SHA
ls -la /sandbox/.secrets/bedrock-key /sandbox/.secrets/openai-key
ls /root/.openclaw/openclaw.json $HOME/.openclaw/openclaw.json 2>/dev/null
```

Verify:
- `bun`, `fbrain/`, `start-gbrain-daemon.sh`, `pg-relay.ts`, `INSTALL_FBRAIN_FOR_AGENTS.md`, `uninstall-fbrain.sh`, `manifest.json`, `EXPECTED_FBRAIN_SHA` present in `/sandbox/gbrain`.
- Manifest's `fbrain_sha` matches `EXPECTED_FBRAIN_SHA` (currently `64c1a4f207ea07213c15de2008b2c12a3d1b2342`).
- `/sandbox/.secrets/bedrock-key` exists, mode 600, sandbox-owned, non-zero.
- `/sandbox/.secrets/openai-key` exists, mode 600, sandbox-owned, non-zero.
- At least one of `/root/.openclaw/openclaw.json` OR `$HOME/.openclaw/openclaw.json` exists (provides the gateway token for Anthropic→Bedrock routing).

If `bedrock-key` is missing: ask operator to investigate the openclaw runbook (`docs/runbooks/bedrock-provider.md`).
If `openai-key` is missing: ask operator to run nanoclaw's `./set-openai-key.sh && ./lolly-snapshots/restore.sh --inject-openai-key`.

## Step 2: Confirm relay-via-CONNECT is the only PG path

```bash
node -e '
  const net = require("net");
  const sock = net.connect({ host: "10.200.0.1", port: 3128 });
  sock.once("connect", () => {
    sock.write("CONNECT host.docker.internal:5433 HTTP/1.1\r\nHost: host.docker.internal:5433\r\nProxy-Connection: Keep-Alive\r\n\r\n");
  });
  let buf = Buffer.alloc(0);
  sock.on("data", (c) => {
    buf = Buffer.concat([buf, c]);
    const idx = buf.indexOf("\r\n\r\n");
    if (idx === -1) return;
    const head = buf.slice(0, idx).toString("ascii");
    const status = head.split("\r\n")[0] || "";
    if (status.startsWith("HTTP/1.1 200")) { console.log("OK:", status); sock.end(); process.exit(0); }
    else { console.error("FAIL:", status); process.exit(1); }
  });
  sock.on("error", e => { console.error("FAIL:", e.code); process.exit(1); });
  sock.setTimeout(5000, () => { console.error("TIMEOUT"); sock.destroy(); process.exit(1); });
'
```

Expected: `OK: HTTP/1.1 200 Connection Established`. This proves the openshell egress policy + binary allowlist + `allowed_ips` SSRF bypass are all live for `node`. (Direct TCP connects to `host.docker.internal:5433` are REJECTed by netfilter — only HTTP CONNECT through `10.200.0.1:3128` works. The relay we ship handles this for fbrain.)

If `403 ssrf_denied`: operator's `add-egress-policy.sh` did not include `allowed_ips: [192.168.65.254/32]`. Stop and report.
If `403` with a different reason: binary allowlist mismatch. Stop and report.

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

## Step 5: Start pg-relay (must come up BEFORE doctor + daemons)

The relay listens on `127.0.0.1:5433` and tunnels Postgres bytes via HTTP CONNECT through the openshell proxy. fbrain dials `127.0.0.1:5433` as if it were local. Without the relay, no fbrain command that touches the DB will work.

The daemon shim's `start` subcommand starts the relay first, gates downstream daemons on `/dev/tcp/127.0.0.1/5433` readiness, then starts `jobs work` + `autopilot`. We split it into a manual relay-first probe in this runbook so you can verify the relay before doctor/config calls.

```bash
# Quick manual relay start (doesn't touch jobs-work/autopilot yet):
nohup /sandbox/gbrain/bun /sandbox/gbrain/pg-relay.ts > /sandbox/.gbrain/logs/pg-relay.log 2>&1 &
sleep 2

# Wait for relay readiness (10s budget):
tries=50
while [ $tries -gt 0 ]; do
  if (echo > /dev/tcp/127.0.0.1/5433) 2>/dev/null; then echo "OK: relay listening"; break; fi
  tries=$((tries - 1)); sleep 0.2
done
[ $tries -gt 0 ] || { echo "ERROR: relay never came up"; tail -20 /sandbox/.gbrain/logs/pg-relay.log; exit 1; }
```

Expected: `OK: relay listening`. If the relay log shows `proxy CONNECT failed`, the egress policy is broken — stop and ask operator to re-run verify-egress.

## Step 6: Confirm fbrain CLI is callable + discover subcommand surface

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts --help 2>&1 | head -80
```

Expected: a help text listing subcommands. Look specifically for:
- `jobs` (with `work` subcommand)
- `autopilot`
- `dream` (with `--phase synthesize` and ideally a way to write pages back to disk)
- `config set` / `config get`
- `doctor`
- `stats`
- `models` (so we can configure synthesize to use Bedrock)

**Report to the operator if any of these are missing or named differently.** The daemon wrapper at `/sandbox/gbrain/start-gbrain-daemon.sh` assumes `gbrain jobs work --watch` and `gbrain autopilot --start`. If the actual flags differ, report exactly what `--help` prints and STOP.

## Step 7: Configure fbrain (paths + Bedrock routing + excludePatterns)

Use `127.0.0.1:5433` (the relay) as `DATABASE_URL` for every config call below.

### 7a — Filesystem paths

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set sync.repo_path /sandbox/.gbrain/brain && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set dream.synthesize.session_corpus_dir /sandbox/.gbrain/corpus
```

### 7b — Synthesize via Bedrock (no Anthropic-direct)

We don't have a Anthropic-direct API key. fbrain's synthesize cycle must route through openclaw's gateway → Bedrock. The exact model-string format the recipe registry accepts is one of `bedrock:claude-sonnet-4-6` / `amazon-bedrock/anthropic.claude-sonnet-4-6` / similar — try the first form first; if `gbrain config set` rejects it, try the others. Report whichever shape works:

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set models.tier.subagent bedrock:claude-sonnet-4-6 && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set models.tier.deep bedrock:claude-sonnet-4-6 && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set models.dream.synthesize_verdict bedrock:claude-haiku-4-5
```

If any of those error with "model not in recipe": run `gbrain models` (the read-only routing dashboard introduced in v0.31.12) to see the actual model-string format the registry accepts. Report findings to operator.

### 7c — excludePatterns

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts config set dream.synthesize.excludePatterns '\bmedical\b,\blegal\b,\bcredit[ -]?card\b,\bssn\b,\bpassword\b,\bapi[ _-]?key\b,\bbearer\s+[A-Za-z0-9._-]{12,}\b,\bsk-[A-Za-z0-9]{20,}\b'
```

The 8-pattern set comes from Phase 1 Q3.d. Operator owns extension before transcripts are first written into corpus.

## Step 8: Run doctor

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts doctor --json | head -60
```

Then extract the headline:

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
/sandbox/gbrain/bun run src/cli.ts doctor --json | jq '.health_score, .status'
```

Expected: `health_score >= 80`, `status: "ok"` or `"warnings"`. **If status is "errors", STOP and report which db_check failed.** Do not run the next steps until doctor is clean.

## Step 9: Verify model routing (zero-token reachability probe)

```bash
cd /sandbox/gbrain/fbrain && \
DATABASE_URL=postgres://fbrain:fbrain@127.0.0.1:5433/fbrain \
AWS_BEARER_TOKEN_BEDROCK=$(cat /sandbox/.secrets/bedrock-key) \
AWS_REGION=us-east-1 \
OPENAI_API_KEY=$(cat /sandbox/.secrets/openai-key) \
ANTHROPIC_BASE_URL=http://127.0.0.1:18789 \
ANTHROPIC_API_KEY=$(python3 -c "import json; p=open('${HOME}/.openclaw/openclaw.json' if '${HOME}'!='' else '/root/.openclaw/openclaw.json'); print(json.load(p)['gateway']['auth']['token'])") \
/sandbox/gbrain/bun run src/cli.ts models doctor --json 2>&1 | head -60
```

Expected: every probe returns `ok` for chat + expansion + embedding. If any probe returns `model_not_found`, report the exact model-string the recipe registry expects and adjust Step 7b.

## Step 10: Stop the manual relay; let the daemon shim manage it

```bash
# Find the manual relay PID and kill it (the daemon shim will start its own):
pkill -f 'pg-relay.ts' || true
sleep 1
```

Then start the full daemon stack via the shim:

```bash
/sandbox/gbrain/start-gbrain-daemon.sh start
sleep 5
/sandbox/gbrain/start-gbrain-daemon.sh status
```

Expected: `pg-relay`, `jobs-work`, `autopilot` all show `pid <N>, last log: ...`. If any show `not running`, tail the relevant log:

```bash
tail -50 /sandbox/.gbrain/logs/pg-relay.log
tail -50 /sandbox/.gbrain/logs/jobs-work.log
tail -50 /sandbox/.gbrain/logs/autopilot.log
```

Most likely root causes if startup fails:
- **fbrain SHA drift detected** → bundle was modified post-deploy. Operator must re-run `lolly-fbrain-build-tarball.sh` + `lolly-fbrain-push-to-pod.sh`.
- **`bedrock-key` or `openai-key` missing** → `check_preconditions` fails. Operator restages credentials.
- **Missing flag** (e.g. `--watch` doesn't exist on `jobs work`) → report to operator; daemon wrapper needs an edit.
- **Relay didn't come up** → re-check Step 2 (egress probe).

## Step 11: Report back

Report to the operator:

1. ✅ or ❌ for each step.
2. Output of `/sandbox/gbrain/start-gbrain-daemon.sh status`.
3. First 5 lines of `/sandbox/.gbrain/logs/pg-relay.log`.
4. First 5 lines of `/sandbox/.gbrain/logs/autopilot.log`.
5. First 5 lines of `/sandbox/.gbrain/logs/jobs-work.log`.
6. `gbrain models doctor --json` output from Step 9.
7. Any subcommand-surface differences from Step 6.
8. `cat /sandbox/gbrain/manifest.json` and `cat /sandbox/gbrain/EXPECTED_FBRAIN_SHA`.

The operator will run `docs/runbooks/lolly-fbrain-smoke-test.md` after your report.
