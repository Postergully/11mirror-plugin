#!/usr/bin/env node
/**
 * MCP stdio → HTTP bridge for the 11Mirror plugin.
 *
 * Reads MCP JSON-RPC messages (newline-delimited) from stdin, relays them to
 * the 11Mirror gateway's HTTP MCP endpoint, and writes responses back to
 * stdout. Lets OpenClaw bundle loaders that only support stdio transports
 * consume the remote gateway.
 *
 * Config resolution (in order; first match wins):
 *   1. Env vars GATEWAY_URL / GATEWAY_API_KEY
 *      (used when the host actually interpolates configSchema into env)
 *   2. ${CLAUDE_PLUGIN_ROOT}/.config.json with {gateway_url, gateway_api_key}
 *      (drop-in override written by the host or the operator)
 *   3. ~/.openclaw/openclaw.json → plugins.entries.11mirror.config
 *      (OpenClaw 2026.5.7 stores configSchema values here; it does not
 *      interpolate them into bundle env, so the bridge reads them itself)
 *
 * No npm dependencies — Node 18+ builtins only (fetch, readline, fs, path).
 */

const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function fail(msg) {
  process.stderr.write(`[11mirror-bridge] ${msg}\n`);
  process.exit(1);
}

function looksUninterpolated(v) {
  // "${gateway_url}" style placeholders the bundle loader never expanded.
  return typeof v === "string" && /^\$\{[^}]+\}$/.test(v.trim());
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    process.stderr.write(`[11mirror-bridge] failed to read ${p}: ${err.message}\n`);
    return null;
  }
}

function fromEnv() {
  const url = process.env.GATEWAY_URL;
  const key = process.env.GATEWAY_API_KEY;
  if (!url || !key) return null;
  if (looksUninterpolated(url) || looksUninterpolated(key)) return null;
  return { url, key, source: "env" };
}

function fromPluginConfigFile() {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (!root) return null;
  const cfg = readJsonSafe(path.join(root, ".config.json"));
  if (!cfg) return null;
  const url = cfg.gateway_url || cfg.GATEWAY_URL;
  const key = cfg.gateway_api_key || cfg.GATEWAY_API_KEY;
  if (!url || !key) return null;
  return { url, key, source: `${root}/.config.json` };
}

function fromOpenclawConfig() {
  const candidates = [
    process.env.OPENCLAW_CONFIG,
    path.join(os.homedir(), ".openclaw", "openclaw.json"),
  ].filter(Boolean);
  for (const p of candidates) {
    const cfg = readJsonSafe(p);
    if (!cfg) continue;
    const entry =
      cfg?.plugins?.entries?.["11mirror"]?.config ||
      cfg?.plugins?.["11mirror"]?.config ||
      null;
    if (!entry) continue;
    const url = entry.gateway_url;
    const key = entry.gateway_api_key;
    if (!url || !key) continue;
    return { url, key, source: p };
  }
  return null;
}

function resolveConfig() {
  return fromEnv() || fromPluginConfigFile() || fromOpenclawConfig();
}

const cfg = resolveConfig();
if (!cfg) {
  fail(
    "Could not resolve gateway_url / gateway_api_key. " +
      "Checked env (GATEWAY_URL/GATEWAY_API_KEY), " +
      "$CLAUDE_PLUGIN_ROOT/.config.json, " +
      "and ~/.openclaw/openclaw.json → plugins.entries.11mirror.config.",
  );
}
if (typeof fetch !== "function") fail("Node 18+ required (global fetch missing)");

const GATEWAY_URL = cfg.url;
const GATEWAY_API_KEY = cfg.key;
process.stderr.write(`[11mirror-bridge] config source: ${cfg.source}\n`);

let sessionId = null;

async function forward(message) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${GATEWAY_API_KEY}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });

  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  // Notifications / responses with no body: 202 Accepted, return nothing.
  if (res.status === 202 || res.status === 204) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gateway HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return await parseSse(res);
  }
  return await res.json();
}

async function parseSse(res) {
  // Minimal SSE parser: return the first `data:` payload that parses as JSON.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastJson = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop();
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          lastJson = JSON.parse(data);
        } catch {
          // ignore keepalives / non-JSON frames
        }
      }
    }
  }
  return lastJson;
}

function writeResponse(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    process.stderr.write(`[11mirror-bridge] invalid JSON on stdin: ${err.message}\n`);
    return;
  }

  forward(msg)
    .then((response) => {
      if (response) writeResponse(response);
    })
    .catch((err) => {
      process.stderr.write(`[11mirror-bridge] ${err.message}\n`);
      if (msg && msg.id !== undefined) {
        writeResponse({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: `gateway bridge error: ${err.message}` },
        });
      }
    });
});

rl.on("close", () => process.exit(0));
