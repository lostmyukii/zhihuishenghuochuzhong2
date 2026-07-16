const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../voice-core.js");

test("server intent must match this project identity", () => {
  const valid = core.sanitizeServerIntent({
    ok: true,
    type: "voiceIntent",
    project: core.PROJECT_ID,
    profileId: core.PROFILE_ID,
    intent: "setMode",
    mode: "study",
    confidence: 0.91,
  });
  assert.equal(valid.intent, "setMode");
  assert.equal(core.sanitizeServerIntent({...valid, project: "smartlife-junior"}).intent, "unknown");
  assert.equal(core.sanitizeServerIntent({...valid, profileId: "other-profile"}).intent, "unknown");
});

test("browser applies a second whitelist to nine intents and six modes", () => {
  for (const intent of core.ALLOWED_INTENTS) {
    const payload = {
      ok: true,
      type: "voiceIntent",
      project: core.PROJECT_ID,
      profileId: core.PROFILE_ID,
      intent,
      confidence: 0.91,
    };
    if (intent === "setMode") payload.mode = "study";
    if (intent === "confirmContext") payload.candidate = "study";
    if (intent === "correctContext") payload.mode = "rest";
    if (intent === "setThreshold") payload.settings = {soundThreshold: 650};
    assert.equal(core.sanitizeServerIntent(payload).intent, intent);
  }
  assert.equal(core.sanitizeServerIntent({project: core.PROJECT_ID, profileId: core.PROFILE_ID, intent: "setFan", confidence: 1}).intent, "unknown");
  assert.equal(core.sanitizeServerIntent({project: core.PROJECT_ID, profileId: core.PROFILE_ID, intent: "setMode", mode: "party", confidence: 1}).intent, "unknown");
  assert.equal(core.sanitizeServerIntent({project: core.PROJECT_ID, profileId: core.PROFILE_ID, intent: "setMode", mode: "study", confidence: 0.59}).intent, "unknown");
});

test("local fallback covers project queries and safe controls", () => {
  assert.deepEqual(core.parseIntent("我要专心写作业"), {intent: "setMode", mode: "study", confidence: 0.8, provider: "browser-rules"});
  assert.equal(core.parseIntent("为什么判断现在适合学习").intent, "explainContext");
  assert.equal(core.parseIntent("当前是什么情境").intent, "queryContext");
  assert.equal(core.parseIntent("现在安全吗").intent, "querySafety");
  assert.equal(core.parseIntent("蜂鸣器静音").intent, "muteBuzzer");
  assert.equal(core.parseIntent("确认当前判断", {candidate: "study"}).intent, "confirmContext");
  assert.deepEqual(core.parseIntent("这次不对，应该是休息", {candidate: "study"}), {intent: "correctContext", mode: "rest", confidence: 0.8, provider: "browser-rules"});
  assert.equal(core.parseIntent("打开摄像头").intent, "unknown");
});

test("read-only intents never produce a board command", () => {
  for (const intent of ["queryContext", "explainContext", "querySafety", "unknown"]) {
    assert.equal(core.toCommand({intent}, `voice-${intent}`), null);
  }
});

test("control intents emit only standard commands with the supplied id", () => {
  assert.deepEqual(core.toCommand({intent: "setMode", mode: "energy", confidence: 0.9}, "voice-1"), {
    type: "command", project: core.PROJECT_ID, id: "voice-1", mode: "energy",
  });
  assert.deepEqual(core.toCommand({intent: "muteBuzzer", confidence: 0.9}, "voice-2"), {
    type: "command", project: core.PROJECT_ID, id: "voice-2", set: {buzzerEnabled: false},
  });
  assert.deepEqual(core.toCommand({intent: "confirmContext", candidate: "study", confidence: 0.9}, "voice-3"), {
    type: "command", project: core.PROJECT_ID, id: "voice-3", contextConfirm: {candidate: "study", correct: true},
  });
  assert.deepEqual(core.toCommand({intent: "correctContext", mode: "rest", confidence: 0.9}, "voice-4"), {
    type: "command", project: core.PROJECT_ID, id: "voice-4", contextCorrect: {mode: "rest"},
  });
  assert.deepEqual(core.toCommand({intent: "setThreshold", settings: {soundThreshold: 650}, confidence: 0.9}, "voice-5"), {
    type: "command", project: core.PROJECT_ID, id: "voice-5", set: {soundThreshold: 650},
  });
});

test("thresholds are single-field, bounded and stepped", () => {
  const base = {project: core.PROJECT_ID, profileId: core.PROFILE_ID, intent: "setThreshold", confidence: 0.9};
  assert.equal(core.sanitizeServerIntent({...base, settings: {soundThreshold: 650}}).intent, "setThreshold");
  assert.equal(core.sanitizeServerIntent({...base, settings: {soundThreshold: 651}}).intent, "unknown");
  assert.equal(core.sanitizeServerIntent({...base, settings: {soundThreshold: 650, lightThreshold: 500}}).intent, "unknown");
  assert.equal(core.sanitizeServerIntent({...base, settings: {temperatureThreshold: 80}}).intent, "unknown");
  assert.equal(core.sanitizeServerIntent({...base, settings: {mq2Threshold: 2650}}).intent, "unknown");
});

test("intent request carries fixed identity and a bounded context", () => {
  const payload = core.intentRequest("现在是什么情境", {
    fresh: true,
    mode: "detect",
    candidate: "study",
    sensors: {light: 123, unknown: 456},
    password: "do-not-send",
  });
  assert.equal(payload.project, core.PROJECT_ID);
  assert.equal(payload.profileId, core.PROFILE_ID);
  assert.deepEqual(payload.context.sensors, {light: 123});
  assert.equal(payload.context.password, undefined);
});
