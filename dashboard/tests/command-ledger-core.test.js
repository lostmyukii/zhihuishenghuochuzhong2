const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../command-ledger-core.js");

function command(id = "web-1") {
  return {type: "command", project: "smartlife-junior-context", id, mode: "study"};
}

test("ledger requires a command id and records source plus route", () => {
  const ledger = new core.CommandLedger({timeoutMs: 2500});
  assert.throws(() => ledger.start({...command(), id: ""}, {source: "web", route: "Web Serial", sentAt: 100}), /id/);
  const entry = ledger.start(command(), {source: "web", route: "Web Serial", description: "切换学习", sentAt: 100});
  assert.equal(entry.id, "web-1");
  assert.equal(entry.source, "web");
  assert.equal(entry.route, "Web Serial");
  assert.equal(entry.status, "pending");
  assert.equal(ledger.pendingCount(), 1);
});

test("ack only closes the matching id", () => {
  const ledger = new core.CommandLedger({timeoutMs: 2500});
  ledger.start(command("a"), {source: "web", sentAt: 100});
  ledger.start(command("b"), {source: "voice", sentAt: 120});
  const unmatched = ledger.receiveAck({type: "ack", id: "other", ok: true}, 200);
  assert.equal(unmatched.matched, false);
  assert.equal(ledger.pendingCount(), 2);
  const matched = ledger.receiveAck({type: "ack", id: "b", ok: true, applied: {mode: "study"}}, 220);
  assert.equal(matched.matched, true);
  assert.equal(matched.entry.status, "ack-ok");
  assert.deepEqual(matched.entry.applied, {mode: "study"});
  assert.equal(matched.entry.hardwareVerified, false);
  assert.equal(ledger.pendingCount(), 1);
});

test("failed ack and timeout keep explicit reasons", () => {
  const ledger = new core.CommandLedger({timeoutMs: 2500});
  ledger.start(command("failed"), {source: "web", sentAt: 100});
  ledger.start(command("late"), {source: "voice", sentAt: 200});
  const failed = ledger.receiveAck({type: "ack", id: "failed", ok: false, error: "unsupported_mode"}, 300);
  assert.equal(failed.entry.status, "ack-error");
  assert.equal(failed.entry.error, "unsupported_mode");
  const expired = ledger.expire(2_701);
  assert.deepEqual(expired.map((entry) => entry.id), ["late"]);
  assert.equal(expired[0].status, "timeout");
});

test("disconnect cancels every pending command without changing completed entries", () => {
  const ledger = new core.CommandLedger({timeoutMs: 2500});
  ledger.start(command("done"), {source: "web", sentAt: 100});
  ledger.receiveAck({type: "ack", id: "done", ok: true}, 150);
  ledger.start(command("pending-a"), {source: "web", sentAt: 200});
  ledger.start(command("pending-b"), {source: "voice", sentAt: 220});
  const cancelled = ledger.cancelPending("WebSocket 已断开", 300);
  assert.deepEqual(cancelled.map((entry) => entry.id), ["pending-a", "pending-b"]);
  assert.equal(ledger.find("done").status, "ack-ok");
  assert.equal(ledger.find("pending-a").status, "cancelled");
  assert.equal(ledger.find("pending-a").error, "WebSocket 已断开");
  assert.equal(ledger.pendingCount(), 0);
});

test("observing a later telemetry frame is separate from ack and hardware acceptance", () => {
  const ledger = new core.CommandLedger({timeoutMs: 2500});
  ledger.start(command("observe"), {source: "web", sentAt: 100});
  ledger.receiveAck({type: "ack", id: "observe", ok: true}, 150);
  const observed = ledger.markObservedActual("observe", 200);
  assert.equal(observed.status, "observed");
  assert.equal(observed.observedActualAt, 200);
  assert.equal(observed.hardwareVerified, false);
});
