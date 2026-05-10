#!/usr/bin/env node
/**
 * MCP stdio → HTTP bridge for the 11Mirror plugin.
 *
 * Reads MCP JSON-RPC messages (newline-delimited) from stdin, relays them to
 * the 11Mirror gateway's HTTP MCP endpoint, and writes responses back to
 * stdout. Lets OpenClaw bundle loaders that only support stdio transports
 * consume the remote gateway.
 *
 * Environment:
 *   GATEWAY_URL        Required. Full URL of the gateway /mcp endpoint.
 *   GATEWAY_API_KEY    Required. Bearer token forwarded to the gateway.
 *
 * No npm dependencies — Node 18+ builtins only (fetch, readline).
 */

const readline = require("node:readline");

const GATEWAY_URL = process.env.GATEWAY_URL;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;

function fail(msg) {
  process.stderr.write(`[11mirror-bridge] ${msg}\n`);
  process.exit(1);
}

if (!GATEWAY_URL) fail("GATEWAY_URL is required");
if (!GATEWAY_API_KEY) fail("GATEWAY_API_KEY is required");
if (typeof fetch !== "function") fail("Node 18+ required (global fetch missing)");

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
