const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../voice-session-core.js");

test("voice session follows the approved state sequence", () => {
  let session = core.createSession("session-1");
  for (const next of ["permission-requested", "recording", "uploading", "transcribed", "intent-resolved", "command-pending"]) {
    session = core.move(session, next);
  }
  session = core.attachCommand(session, "voice-1");
  const acked = core.applyAck(session, {type: "ack", id: "voice-1", ok: true});
  assert.equal(acked.state, "acked");
  const observed = core.markObserved(acked, 1234);
  assert.equal(observed.state, "observed");
  assert.equal(observed.observedAt, 1234);
  assert.equal(observed.hardwareVerified, false);
});

test("invalid state jumps are rejected", () => {
  const session = core.createSession("session-2");
  assert.throws(() => core.move(session, "command-pending"), /invalid_voice_transition/);
  assert.throws(() => core.move(session, "unknown-state"), /invalid_voice_state/);
});

test("ack must match the current command id", () => {
  let session = core.createSession("session-3");
  for (const next of ["permission-requested", "recording", "uploading", "transcribed", "intent-resolved", "command-pending"]) {
    session = core.move(session, next);
  }
  session = core.attachCommand(session, "voice-expected");
  assert.equal(core.applyAck(session, {type: "ack", id: "voice-other", ok: true}), session);
  assert.equal(core.applyAck(session, {type: "ack", id: "voice-expected", ok: false, error: "unsupported"}).state, "failed");
});

test("read-only result can be observed without pretending hardware execution", () => {
  let session = core.createSession("session-4");
  session = core.move(session, "permission-requested");
  session = core.move(session, "recording");
  session = core.move(session, "uploading");
  session = core.move(session, "transcribed");
  session = core.move(session, "intent-resolved");
  session = core.markObserved(session, 2000);
  assert.equal(session.state, "observed");
  assert.equal(session.commandId, null);
  assert.equal(session.hardwareVerified, false);
});

test("fail keeps a safe public error and no hardware claim", () => {
  const failed = core.fail(core.createSession("session-5"), "麦克风权限被拒绝");
  assert.equal(failed.state, "failed");
  assert.equal(failed.error, "麦克风权限被拒绝");
  assert.equal(failed.hardwareVerified, false);
});
