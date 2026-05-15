# GBrain Skill Resolver

This is the dispatcher. Skills are the implementation. **Read the skill file before acting.** If two skills could match, read both. They are designed to chain (e.g., ingest then enrich for each entity).

## Always-on (every message)

| Trigger | Skill |
|---------|-------|
| Every inbound message (spawn parallel, don't block) | `skills/signal-detector/SKILL.md` |
| Any brain read/write/lookup/citation | `skills/brain-ops/SKILL.md` |

## Brain operations

| Trigger | Skill |
|---------|-------|
| "What do we know about", "tell me about", "search for", "who is", "background on", "notes on" | `skills/query/SKILL.md` |
| "Who knows who", "relationship between", "connections", "graph query" | `skills/query/SKILL.md` (use graph-query) |
| Creating/enriching a person or company page | `skills/enrich/SKILL.md` |
| Where does a new file go? Filing rules | `skills/repo-architecture/SKILL.md` |
| Fix broken citations in brain pages | `skills/citation-fixer/SKILL.md` |
| "citation audit", "check citations", "fix citations" | `skills/citation-fixer/SKILL.md` (focused fix). For broader brain health, chain into `skills/maintain/SKILL.md` |
| "Research", "track", "extract from email", "investor updates", "donations" | `skills/data-research/SKILL.md` |
| Share a brain page as a link | `skills/publish/SKILL.md` |
| "validate frontmatter", "check frontmatter", "fix frontmatter", "frontmatter audit", "brain lint" | `skills/frontmatter-guard/SKILL.md` |

## Content & media ingestion

| Trigger | Skill |
|---------|-------|
| User shares a link, article, tweet, or idea | `skills/idea-ingest/SKILL.md` |
| Video, audio, PDF, book, YouTube, screenshot | `skills/media-ingest/SKILL.md` |
| "Process this book", "Ingest this PDF book", "summarize this book", generic book ingest without personalization | `skills/media-ingest/SKILL.md` |
| Meeting transcript received | `skills/meeting-ingestion/SKILL.md` |
| Generic "ingest this" (auto-routes to above) | `skills/ingest/SKILL.md` |

## Thinking skills (from GStack)

| Trigger | Skill |
|---------|-------|
| "Brainstorm", "I have an idea", "office hours" | GStack: office-hours |
| "Review this plan", "CEO review", "poke holes" | GStack: ceo-review |
| "Debug", "fix", "broken", "investigate" | GStack: investigate |
| "Retro", "what shipped", "retrospective" | GStack: retro |

> These skills come from GStack. If GStack is installed, the agent reads them directly.
> If not, brain-only mode still works (brain skills function without thinking skills).

## Operational

| Trigger | Skill |
|---------|-------|
| Task add/remove/complete/defer/review | `skills/daily-task-manager/SKILL.md` |
| Morning prep, meeting context, day planning | `skills/daily-task-prep/SKILL.md` |
| Daily briefing, "what's happening today" | `skills/briefing/SKILL.md` |
| Cron scheduling, quiet hours, job staggering | `skills/cron-scheduler/SKILL.md` |
| Save or load reports | `skills/reports/SKILL.md` |
| "Create a skill", "improve this skill" | `skills/skill-creator/SKILL.md` |
| "Skillify this", "is this a skill?", "make this proper" | `skills/skillify/SKILL.md` |
| "Is gbrain healthy?", morning health check, skillpack-check | `skills/skillpack-check/SKILL.md` |
| Post-restart health + auto-fix, "did the container restart break anything", smoke test | `skills/smoke-test/SKILL.md` |
| Cross-modal review, second opinion | `skills/cross-modal-review/SKILL.md` |
| "Validate skills", skill health check | `skills/testing/SKILL.md` |
| Webhook setup, external event processing | `skills/webhook-transforms/SKILL.md` |
| "Spawn agent", "background task", "parallel tasks", "steer agent", "pause/resume agent", "gbrain jobs submit", "submit a gbrain job", "submit a shell job", "shell job" | `skills/minion-orchestrator/SKILL.md` |

## Setup & migration

| Trigger | Skill |
|---------|-------|
| "Set up GBrain", first boot | `skills/setup/SKILL.md` |
| "Migrate from Obsidian/Notion/Logseq" | `skills/migrate/SKILL.md` |
| Brain health check, maintenance run | `skills/maintain/SKILL.md` |
| "Extract links", "build link graph", "populate timeline" | `skills/maintain/SKILL.md` (extraction sections) |
| "Run dream", "process today's session", "synthesize my conversations", "consolidate yesterday's conversations", "what patterns did you see", "did the dream cycle run" | `skills/maintain/SKILL.md` (dream cycle section) |
| "Brain health", "what features am I missing", "brain score" | Run `gbrain features --json` |
| "Set up autopilot", "run brain maintenance", "keep brain updated" | Run `gbrain autopilot --install --repo ~/brain` |
| Agent identity, "who am I", customize agent | `skills/soul-audit/SKILL.md` |
| "Populate links", "extract links", "backfill graph" | `skills/maintain/SKILL.md` (graph population phase) |
| "Populate timeline", "extract timeline entries" | `skills/maintain/SKILL.md` (graph population phase) |

## Identity & access (always-on)

| Trigger | Skill |
|---------|-------|
| Non-owner sends a message | Check `ACCESS_POLICY.md` before responding |
| Agent needs to know its identity/vibe | Read `SOUL.md` |
| Agent needs user context | Read `USER.md` |
| Operational cadence (what to check and when) | Read `HEARTBEAT.md` |

## Disambiguation rules

When multiple skills could match:
1. Prefer the most specific skill (meeting-ingestion over ingest)
2. If the user mentions a URL, route by content type (link → idea-ingest, video → media-ingest)
3. If the user mentions a person/company, check if enrich or query fits better
4. Chaining is explicit in each skill's Phases section
5. When in doubt, ask the user

**Engine choice (11Mirror deployment):** before running the skill table above, decide the shape of the question.

- **Finance-ops / structured / NetSuite-shaped** → cognee FIRST. Examples: "show open vendor bills for subsidiary Y", "what's the TAL remaining-amount field for VPrep", "write a SuiteQL for AP aging", "which record types back the expense-report P&L line", "vendor master for Acme — what are their payment terms", "generate the monthly MIS for Q3", "reconcile the clearing-doc SAP field". Tools: `graph_query`, `entity_search`, `knowledge_ingest`. Datasets: `netsuite-schema-data` (schema + field catalog) or `default__netsuite-rules` (SuiteQL gotchas + sign conventions + customer config).
- **Process / policy / prose** → fbrain. Examples: "what's our month-end close checklist", "how do we handle a subsidiary onboarding", "who signed off on the FY24 audit adjustments", "write this decision as an SOP so next month's close can reuse it". Tools: `query`, `search`, `put_page`.
- **Mixed** (e.g. "who approves vendor payments above ₹50 lakh and what's the NetSuite status code for 'pending approval'") → run BOTH in parallel: cognee for the structured half (status code, approval field), fbrain for the policy half (approval authority, escalation). Merge in the response.

Never invent NetSuite field names, status codes, or sign conventions. If neither engine returns a match, say "not in the knowledge base" and offer to ingest the missing context.

## Conventions (cross-cutting)

These apply to ALL brain-writing skills:
- `skills/conventions/quality.md` — citations, back-links, notability gate
- `skills/conventions/brain-first.md` — check brain before external APIs
- `skills/conventions/brain-routing.md` — which brain (DB) and which source (repo) to target; cross-brain federation is latent-space only
- `skills/conventions/subagent-routing.md` — when to use Minions vs inline work
- `skills/_brain-filing-rules.md` — where files go
- `skills/_output-rules.md` — output quality standards

## Reading & research skills

| Trigger | Skill |
|---------|-------|
| "personalized version of this book", "Mirror this book", "two-column book analysis", "Apply this book to my life", "personalized version" | `skills/book-mirror/SKILL.md` |
| "strategic reading", "Read this through the lens", "Apply this to my problem", "What can I learn from this", "Extract a playbook" | `skills/strategic-reading/SKILL.md` |
| "verify this academic claim", "Check this study", "academic verify", "Validate citation", "Retraction Watch" | `skills/academic-verify/SKILL.md` |
| "perplexity-research", "perplexity research", "What's new about this company", "current state of", "web research pass on", "What changed about" | `skills/perplexity-research/SKILL.md` |

## Brain enrichment & synthesis

| Trigger | Skill |
|---------|-------|
| "enrich this article", "batch enrich", "enriching the article", "enrich brain pages" | `skills/article-enrichment/SKILL.md` |
| "concept synthesis", "Synthesize my concepts", "Find patterns across my notes", "Build my intellectual map", "Trace idea evolution" | `skills/concept-synthesis/SKILL.md` |
| "crawl my archive", "Find gold in my archive", "archive crawler", "Scan my dropbox", "Mine my old files" | `skills/archive-crawler/SKILL.md` |

## Voice, audio & PDF

| Trigger | Skill |
|---------|-------|
| "voice note", "voice memo", "audio message", "audio note", "Transcribe and file" | `skills/voice-note-ingest/SKILL.md` |
| "make pdf from brain", "brain pdf", "Convert brain page to pdf", "Publish this page as pdf", "Export brain page to" | `skills/brain-pdf/SKILL.md` |
