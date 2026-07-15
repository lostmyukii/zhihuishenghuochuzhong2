const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../presentation-core.js");

const PROJECT_ID = "smartlife-junior-context";

function frame(overrides = {}) {
  return {
    type: "telemetry",
    project: PROJECT_ID,
    mock: false,
    sensors: {light: 520, sound: 125, temperature: 24.6, humidity: 51, pir: true, keypad: 0, mq2: 380, water: false, flame: false},
    sensorValid: {light: true, sound: true, temperature: true, humidity: true, pir: true, keypad: true, mq2: true, water: true, flame: true},
    sensorAgeMs: {light: 120, sound: 120, temperature: 800, humidity: 800, pir: 120, keypad: 120, mq2: 120, water: 120, flame: 120},
    actuatorTargets: {fanPercent: 50, servoPosition: "study", relayOn: true, buzzerMode: "off", rgbState: "study"},
    actuators: {fanPercent: 0, servoAngle: 0, relayOn: false, buzzerOn: false, rgbState: "off"},
    safety: {overrideActive: false},
    health: {
      actuatorApplyState: "fully-armed",
      hardwareVerified: false,
      calibrationRequired: true,
      buzzerHardwareVerified: true,
      fanHardwareVerified: false,
      servoHardwareVerified: false,
      relayHardwareVerified: false,
      rgbHardwareVerified: false,
    },
    ...overrides,
  };
}

test("sensor presentation puts required household evidence before extensions", () => {
  const sections = core.sensorSections(frame());
  assert.deepEqual(sections.primary.map((item) => item.key), ["temperature", "humidity", "sound", "pir"]);
  assert.deepEqual(sections.secondary.map((item) => item.key), ["light", "keypad", "mq2", "water", "flame"]);
  assert.equal(sections.primary.find((item) => item.key === "temperature").value, "24.6 °C");
  assert.equal(sections.primary.find((item) => item.key === "humidity").value, "51 %RH");
});

test("sound and MQ2 keep honest relative and raw units", () => {
  const sections = core.sensorSections(frame());
  const sound = sections.primary.find((item) => item.key === "sound");
  const mq2 = sections.secondary.find((item) => item.key === "mq2");
  assert.equal(sound.value, "125");
  assert.equal(sound.unitNote, "相对强度");
  assert.equal(mq2.value, "380 ADC");
  assert.equal(mq2.unitNote, "原始值，不等同空气质量或ppm");
  assert.doesNotMatch(JSON.stringify({sound, mq2}), /dB\(A\)|"unitNote":"ppm"/);
});

test("invalid and aged sensors keep visible validity evidence", () => {
  const base = frame();
  const telemetry = frame({
    sensorValid: {...base.sensorValid, sound: false},
    sensorAgeMs: {...base.sensorAgeMs, sound: 6_800},
  });
  const sound = core.sensorSections(telemetry).primary.find((item) => item.key === "sound");
  assert.equal(sound.valid, false);
  assert.equal(sound.healthLabel, "无效 · 6.8s");
});

test("actuator rows never infer actual state from planned targets", () => {
  const rows = core.actuatorRows(frame());
  const fan = rows.find((item) => item.key === "fan");
  const buzzer = rows.find((item) => item.key === "buzzer");
  assert.equal(fan.plan, "50%");
  assert.equal(fan.actual, "0%");
  assert.equal(fan.verification, "待实物验收");
  assert.equal(buzzer.plan, "关闭");
  assert.equal(buzzer.actual, "关闭");
  assert.equal(buzzer.verification, "已单项验证");
});

test("mock actuals are labeled simulated and do not become verified hardware", () => {
  const base = frame();
  const rows = core.actuatorRows(frame({mock: true, health: {...base.health, actuatorApplyState: "simulated"}}));
  assert.equal(rows[0].actualKind, "模拟执行");
  assert.equal(rows[0].verification, "Mock，不代表实物验收");
});

test("missing actuator actuals remain unknown instead of copying targets", () => {
  const rows = core.actuatorRows(frame({actuators: {}}));
  assert.equal(rows.find((item) => item.key === "fan").actual, "未知");
  assert.equal(rows.find((item) => item.key === "relay").actual, "未知");
});
