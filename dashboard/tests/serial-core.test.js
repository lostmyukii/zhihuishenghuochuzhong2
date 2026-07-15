const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../serial-core.js");

test("serial line parser handles split and multiple JSON lines", () => {
  const parser = new core.LineParser();
  assert.deepEqual(parser.push('{"type":"hello","project":"smartlife-junior-context"'), []);
  const frames = parser.push('}\n{"type":"telemetry","project":"smartlife-junior-context"}\r\n');
  assert.equal(frames.length, 2);
  assert.equal(frames[0].type, "hello");
  assert.equal(frames[1].type, "telemetry");
});
test("serial core rejects foreign frames and encodes commands with newline", () => {
  assert.equal(core.acceptFrame({type: "telemetry", project: core.PROJECT_ID}), true);
  assert.equal(core.acceptFrame({type: "telemetry", project: "other"}), false);
  assert.equal(core.encodeCommand({type: "command", project: core.PROJECT_ID, id: "x", mode: "study"}), '{"type":"command","project":"smartlife-junior-context","id":"x","mode":"study"}\n');
  assert.throws(() => core.encodeCommand({type: "command", project: core.PROJECT_ID, mode: "study"}), /id/);
});
