const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../alert-core.js");

test("alerts name cause GPIO and truthful actions", () => {
  const mq2 = core.describeAlerts({alerts: ["mq2"], sensors: {mq2: 2700}, health: {mq2AlertRaw: 2600}, actuators: {fanPercent: 100, buzzerOn: true, rgbState: "red"}});
  assert.equal(mq2.length, 1);
  assert.match(mq2[0].detail, /GPIO2/);
  assert.match(mq2[0].detail, /2700/);
  assert.match(mq2[0].actions, /风扇 100%/);
});

test("unknown alerts stay visible", () => {
  const alerts = core.describeAlerts({alerts: ["future-code"], sensors: {}, actuators: {}});
  assert.equal(alerts[0].title, "设备上报异常：future-code");
});

test("safety sensor faults remain visible when reported only in safety causes", () => {
  const alerts = core.describeAlerts({alerts: [], safety: {causes: ["safety_sensor_fault"]}, sensors: {}, actuators: {}});
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].code, "safety_sensor_fault");
});
