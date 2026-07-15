const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../registry-core.js");

test("registry freezes all thirteen installed modules and GPIO", () => {
  assert.equal(core.MODULES.length, 13);
  const pins = Object.fromEntries(core.MODULES.map((module) => [module.key, module.pin]));
  assert.deepEqual(pins, {light: 1, sound: 4, dht: 14, pir: 5, keypad: 10, mq2: 2, water: 8, flame: 45, buzzer: 13, fan: 11, servo: 9, relay: 12, rgb: 46});
});
test("registry persistence is profile scoped", () => {
  assert.equal(core.storageKey(), "smartlife.n16r8.registry.smartlife-junior-context-detective-v1");
  const snapshot = core.createSnapshot({fan: "living"});
  assert.equal(snapshot.profileId, core.PROFILE_ID);
  assert.equal(snapshot.rooms.fan, "living");
});
