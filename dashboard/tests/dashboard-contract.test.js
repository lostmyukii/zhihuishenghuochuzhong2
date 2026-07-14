const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(dashboard, name), "utf8");

test("dashboard ships the minimal static artifact set", () => {
  for (const name of ["index.html", "style.css", "context-core.js", "app.js"]) {
    assert.equal(fs.existsSync(path.join(dashboard, name)), true, `${name} is missing`);
  }
});

test("dashboard exposes all six modes and all four mock scenarios", () => {
  const html = read("index.html");
  for (const mode of ["detect", "study", "rest", "ventilation", "energy", "custom"]) {
    assert.match(html, new RegExp(`data-mode=["']${mode}["']`));
  }
  for (const scenario of ["normal", "mq2", "water", "flame"]) {
    assert.match(html, new RegExp(`data-scenario=["']${scenario}["']`));
  }
});

test("dashboard distinguishes mock, websocket, usb and mqtt truth", () => {
  const html = read("index.html");
  for (const copy of ["等待数据来源", "WebSocket", "USB", "MQTT", "等待实时数据"]) {
    assert.match(html, new RegExp(copy));
  }
  assert.doesNotMatch(html, /真板在线/);
});

test("client implements query endpoint, ack timeout and stale clearing", () => {
  const source = read("app.js");
  assert.match(source, /searchParams\.get\(["']ws["']\)/);
  assert.match(source, /COMMAND_TIMEOUT_MS\s*=\s*2500/);
  assert.match(source, /TELEMETRY_STALE_MS\s*=\s*3500/);
  assert.match(source, /pendingCommands/);
  assert.match(source, /clearTelemetry/);
  assert.match(source, /等待实时数据/);
  assert.match(source, /telemetry\.mock\s*===\s*true/);
  assert.doesNotMatch(source, /telemetry\.mock\s*!==\s*true\)\s*return/);
  assert.match(source, /ContextCore\.evidenceLabel/);
});
