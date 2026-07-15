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

test("real unarmed telemetry keeps planned actions separate from actual state", () => {
  const telemetry = core.normalizeTelemetry({
    type: "telemetry",
    project: "smartlife-junior-context",
    actuatorTargets: {fanPercent: 100, servoPosition: "ventilation-open", relayOn: false, buzzerMode: "alarm", rgbState: "red"},
    actuators: {fanPercent: null, servoAngle: null, relayOn: null, buzzerOn: null, rgbState: null},
    safety: {state: "risk", overrideActive: true},
    health: {actuatorApplyState: "unarmed", hardwareVerified: false, calibrationRequired: true},
  });
  const view = core.actuatorPresentation(telemetry);

  assert.equal(view.fan, "计划：100% / 实际：未武装/未应用");
  assert.equal(view.servo, "计划：通风打开 / 实际：未武装/未应用");
  assert.equal(view.relay, "计划：关闭 / 实际：未武装/未应用");
  assert.equal(view.buzzer, "计划：安全报警 / 实际：未武装/未应用");
  assert.equal(view.rgb, "计划：红色 / 实际：未武装/未应用");
  assert.equal(view.applyLabel, "执行器未武装");
  assert.equal(view.calibrationRequired, true);
});

test("mock telemetry labels actual values as simulated execution", () => {
  const telemetry = core.normalizeTelemetry({
    type: "telemetry",
    project: "smartlife-junior-context",
    mock: true,
    actuatorTargets: {fanPercent: 35, servoPosition: "rest", relayOn: false, buzzerMode: "off", rgbState: "blue-low"},
    actuators: {fanPercent: 35, servoAngle: 15, relayOn: false, buzzerOn: false, rgbState: "blue-low"},
    health: {actuatorApplyState: "simulated", hardwareVerified: false, calibrationRequired: true},
  });
  const view = core.actuatorPresentation(telemetry);

  assert.equal(view.fan, "计划：35% / 模拟执行：35%");
  assert.equal(view.servo, "计划：休息位置 / 模拟执行：15°");
  assert.equal(view.applyLabel, "Mock模拟执行");
});

test("future real applied values are never inferred from targets", () => {
  const applied = core.normalizeTelemetry({
    type: "telemetry",
    project: "smartlife-junior-context",
    actuatorTargets: {fanPercent: 70},
    actuators: {fanPercent: 42},
    health: {actuatorApplyState: "applied"},
  });
  const missing = core.normalizeTelemetry({
    type: "telemetry",
    project: "smartlife-junior-context",
    actuatorTargets: {},
    actuators: {},
    health: {},
  });

  assert.equal(core.actuatorPresentation(applied).fan, "计划：70% / 实际：42%");
  assert.equal(core.actuatorPresentation(missing).fan, "计划：未知 / 实际：未知");
});

test("partial buzzer validation shows only GPIO13 as physically available", () => {
  const telemetry = core.normalizeTelemetry({
    type: "telemetry",
    project: "smartlife-junior-context",
    actuatorTargets: {fanPercent: 100, servoPosition: "ventilation-open", relayOn: false, buzzerMode: "alarm", rgbState: "red"},
    actuators: {fanPercent: null, servoAngle: null, relayOn: null, buzzerOn: false, rgbState: null},
    health: {actuatorApplyState: "partial-buzzer-test", buzzerArmed: true, fanArmed: false, servoArmed: false, relayArmed: false, rgbArmed: false, hardwareVerified: false},
  });
  const view = core.actuatorPresentation(telemetry);

  assert.equal(view.applyLabel, "仅蜂鸣器测试已武装");
  assert.equal(view.fan, "计划：100% / 实际：未武装/未应用");
  assert.equal(view.servo, "计划：通风打开 / 实际：未武装/未应用");
  assert.equal(view.relay, "计划：关闭 / 实际：未武装/未应用");
  assert.equal(view.buzzer, "计划：安全报警 / 实际：关闭");
  assert.equal(view.rgb, "计划：红色 / 实际：未武装/未应用");
  assert.equal(view.calibrationRequired, true);
});

test("partial buzzer validation reports the pulse without inferring other outputs", () => {
  const telemetry = core.normalizeTelemetry({
    type: "telemetry",
    project: "smartlife-junior-context",
    actuatorTargets: {buzzerMode: "off"},
    actuators: {buzzerOn: true},
    health: {actuatorApplyState: "partial-buzzer-test", buzzerArmed: true},
  });
  const view = core.actuatorPresentation(telemetry);

  assert.equal(view.buzzer, "计划：关闭 / 实际：开启");
  assert.equal(view.fan, "计划：未知 / 实际：未武装/未应用");
});

test("safety sensor faults have an explicit Chinese label", () => {
  assert.equal(core.alertLabel("safety_sensor_fault"), "安全传感器数据异常");
});
