const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../context-core.js");

test("freshness expires without new telemetry", () => {
  assert.equal(core.isFresh(10_000, 12_000, 3_500), true);
  assert.equal(core.isFresh(10_000, 13_501, 3_500), false);
  assert.equal(core.isFresh(null, 12_000, 3_500), false);
});

test("all six modes have stable Chinese labels", () => {
  assert.deepEqual(Object.keys(core.MODE_LABELS), [
    "detect",
    "study",
    "rest",
    "ventilation",
    "energy",
    "custom",
  ]);
  assert.equal(core.modeLabel("study"), "专注学习");
  assert.equal(core.modeLabel("not-known"), "not-known");
});

test("telemetry is accepted only for this project", () => {
  const current = core.normalizeTelemetry({
    type: "telemetry",
    project: "smartlife-junior-context",
    sensors: {},
    actuators: {},
    context: {},
    alerts: [],
  });
  const foreign = core.normalizeTelemetry({type: "telemetry", project: "other"});

  assert.equal(current.project, "smartlife-junior-context");
  assert.equal(foreign, null);
});

test("unknown alert codes remain visible instead of being hidden", () => {
  assert.equal(core.alertLabel("mq2"), "烟雾或燃气风险");
  assert.equal(core.alertLabel("future-alert"), "future-alert");
});

test("fixed firmware evidence codes become Chinese explanations", () => {
  assert.equal(core.evidenceLabel("pir_active"), "检测到近期人体活动");
  assert.equal(core.evidenceLabel("dht_missing"), "温湿度证据缺失或已过期");
  assert.equal(core.evidenceLabel("future-evidence"), "future-evidence");
});
