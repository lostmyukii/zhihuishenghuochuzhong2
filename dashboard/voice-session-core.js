(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoiceSessionCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STATES = Object.freeze([
    "idle", "permission-requested", "recording", "uploading", "transcribed",
    "intent-resolved", "command-pending", "acked", "observed", "failed",
  ]);
  const TRANSITIONS = Object.freeze({
    idle: new Set(["permission-requested", "uploading"]),
    "permission-requested": new Set(["recording"]),
    recording: new Set(["uploading"]),
    uploading: new Set(["transcribed"]),
    transcribed: new Set(["intent-resolved"]),
    "intent-resolved": new Set(["command-pending", "observed"]),
    "command-pending": new Set(["acked"]),
    acked: new Set(["observed"]),
    observed: new Set(["idle", "permission-requested", "uploading"]),
    failed: new Set(["idle", "permission-requested", "uploading"]),
  });

  function createSession(id = `voice-session-${Date.now()}`) {
    return Object.freeze({
      id: String(id),
      state: "idle",
      text: "",
      intent: null,
      commandId: null,
      ack: null,
      error: "",
      observedAt: null,
      hardwareVerified: false,
    });
  }

  function move(session, next, patch = {}) {
    if (!session || !STATES.includes(session.state)) throw new Error("invalid_voice_session");
    if (!STATES.includes(next)) throw new Error("invalid_voice_state");
    if (!TRANSITIONS[session.state].has(next)) throw new Error(`invalid_voice_transition:${session.state}->${next}`);
    return Object.freeze({...session, ...patch, state: next, hardwareVerified: false});
  }

  function attachCommand(session, commandId) {
    if (!session || session.state !== "command-pending" || !commandId) throw new Error("invalid_voice_command");
    return Object.freeze({...session, commandId: String(commandId), hardwareVerified: false});
  }

  function applyAck(session, ack) {
    if (!session || session.state !== "command-pending" || !session.commandId) return session;
    if (!ack || ack.id !== session.commandId) return session;
    if (ack.ok !== true) return fail(session, String(ack.error || "板端拒绝命令"), {ack});
    return move(session, "acked", {ack});
  }

  function markObserved(session, observedAt = Date.now()) {
    if (!session || !["intent-resolved", "acked"].includes(session.state)) throw new Error("invalid_voice_observation");
    return move(session, "observed", {observedAt, hardwareVerified: false});
  }

  function fail(session, error, patch = {}) {
    if (!session || !STATES.includes(session.state)) throw new Error("invalid_voice_session");
    return Object.freeze({...session, ...patch, state: "failed", error: String(error || "语音流程失败").slice(0, 240), hardwareVerified: false});
  }

  return {STATES, createSession, move, attachCommand, applyAck, markObserved, fail};
});
