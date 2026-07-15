const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../dashboard-state-core.js");

const PROJECT_ID = "smartlife-junior-context";
const PROFILE_ID = "smartlife-junior-context-detective-v1";

function hello(overrides = {}) {
  return {type: "hello", project: PROJECT_ID, profileId: PROFILE_ID, mock: false, ...overrides};
}

function telemetry(overrides = {}) {
  return {type: "telemetry", project: PROJECT_ID, profileId: PROFILE_ID, mock: false, ...overrides};
}

test("an open websocket without fresh project telemetry stays waiting", () => {
  const state = core.resolveState({websocketOpen: true, serialConnected: false, now: 10_000});
  assert.equal(state.kind, "waiting");
  assert.equal(state.boardLabel, "等待实时数据");
  assert.equal(state.sourceLabel, "无实时数据");
});

test("fresh explicit mock telemetry is the only route to mock-live", () => {
  const state = core.resolveState({
    hello: hello({mock: true}),
    telemetry: telemetry({mock: true}),
    lastTelemetryAt: 8_000,
    now: 10_000,
    websocketOpen: true,
  });
  assert.equal(state.kind, "mock-live");
  assert.equal(state.boardLabel, "模拟板在线");
  assert.equal(state.sourceLabel, "Mock 模拟数据");
});

test("fresh real telemetry without a captured hello stays visibly live but identity-pending", () => {
  assert.deepEqual(core.STATE_KINDS, ["waiting", "real-telemetry", "real-live", "mock-live", "stale", "offline"]);
  const serial = core.resolveState({
    telemetry: telemetry(),
    lastTelemetryAt: 9_500,
    now: 10_000,
    serialConnected: true,
    telemetryRoute: "serial",
  });
  const gateway = core.resolveState({
    telemetry: telemetry(),
    lastTelemetryAt: 9_500,
    now: 10_000,
    websocketOpen: true,
    telemetryRoute: "websocket",
  });
  assert.equal(serial.kind, "real-telemetry");
  assert.equal(serial.boardLabel, "真板遥测在线");
  assert.equal(serial.sourceLabel, "Web Serial · 未捕获启动身份");
  assert.equal(serial.dataState, "pending");
  assert.equal(gateway.kind, "real-telemetry");
  assert.equal(gateway.sourceLabel, "Python 网关 · 未捕获启动身份");
});

test("real-live requires a matching real hello plus fresh real telemetry", () => {
  const withForeignHello = core.resolveState({
    hello: hello({profileId: "other-profile"}),
    telemetry: telemetry(),
    lastTelemetryAt: 9_500,
    now: 10_000,
    serialConnected: true,
    telemetryRoute: "serial",
  });
  const valid = core.resolveState({
    hello: hello(),
    telemetry: telemetry(),
    lastTelemetryAt: 9_500,
    now: 10_000,
    serialConnected: true,
    telemetryRoute: "serial",
  });
  assert.equal(withForeignHello.kind, "waiting");
  assert.equal(valid.kind, "real-live");
  assert.equal(valid.boardLabel, "真板在线");
  assert.equal(valid.sourceLabel, "Web Serial 真板数据");
});

test("stale telemetry and closed transports never remain online", () => {
  const stale = core.resolveState({
    hello: hello(),
    telemetry: telemetry(),
    lastTelemetryAt: 5_000,
    now: 10_000,
    serialConnected: true,
  });
  const offline = core.resolveState({now: 10_000});
  assert.equal(stale.kind, "stale");
  assert.equal(stale.boardLabel, "数据已过期");
  assert.equal(offline.kind, "offline");
  assert.equal(offline.boardLabel, "开发板离线");
});

test("foreign project telemetry cannot become a live state", () => {
  const state = core.resolveState({
    hello: hello(),
    telemetry: telemetry({project: "other-project"}),
    lastTelemetryAt: 9_900,
    now: 10_000,
    serialConnected: true,
  });
  assert.equal(state.kind, "waiting");
});

test("identity-pending state rejects missing profile and unknown transport routes", () => {
  const missingProfile = core.resolveState({
    telemetry: telemetry({profileId: undefined}),
    lastTelemetryAt: 9_900,
    now: 10_000,
    serialConnected: true,
    telemetryRoute: "serial",
  });
  const unknownRoute = core.resolveState({
    telemetry: telemetry(),
    lastTelemetryAt: 9_900,
    now: 10_000,
    serialConnected: true,
  });
  assert.equal(missingProfile.kind, "waiting");
  assert.equal(unknownRoute.kind, "waiting");
});
