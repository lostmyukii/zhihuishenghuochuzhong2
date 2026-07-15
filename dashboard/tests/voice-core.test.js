const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../voice-core.js");

test("voice text maps natural Chinese phrases to safe whitelisted commands", () => {
  assert.deepEqual(core.parseIntent("我要专心写作业"), {intent: "setMode", mode: "study"});
  assert.deepEqual(core.parseIntent("房间有点闷，帮我通风"), {intent: "setMode", mode: "ventilation"});
  assert.deepEqual(core.parseIntent("蜂鸣器静音"), {intent: "setBuzzerEnabled", enabled: false});
  assert.deepEqual(core.parseIntent("打开摄像头"), {intent: "unknown"});
});
test("voice intent emits only standard command payloads", () => {
  assert.deepEqual(core.toCommand({intent: "setMode", mode: "energy"}, "voice-1"), {type: "command", project: core.PROJECT_ID, id: "voice-1", mode: "energy"});
  assert.equal(core.toCommand({intent: "unknown"}, "voice-2"), null);
});
