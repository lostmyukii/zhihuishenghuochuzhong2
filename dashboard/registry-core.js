(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RegistryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROFILE_ID = "smartlife-junior-context-detective-v1";
  const MODULES = Object.freeze([
    {key: "light", name: "光敏", pin: 1, kind: "sensor", room: "study"},
    {key: "sound", name: "声音强度", pin: 4, kind: "sensor", room: "study"},
    {key: "dht", name: "温湿度", pin: 14, kind: "sensor", room: "living"},
    {key: "pir", name: "人体红外", pin: 5, kind: "sensor", room: "entry"},
    {key: "keypad", name: "8键AD", pin: 10, kind: "sensor", room: "living"},
    {key: "mq2", name: "MQ2烟雾/燃气", pin: 2, kind: "sensor", room: "kitchen"},
    {key: "water", name: "水滴", pin: 8, kind: "sensor", room: "bathroom"},
    {key: "flame", name: "火焰", pin: 45, kind: "sensor", room: "kitchen"},
    {key: "buzzer", name: "蜂鸣器", pin: 13, kind: "actuator", room: "living"},
    {key: "fan", name: "风扇", pin: 11, kind: "actuator", room: "living"},
    {key: "servo", name: "舵机窗", pin: 9, kind: "actuator", room: "bedroom"},
    {key: "relay", name: "低压LED继电器", pin: 12, kind: "actuator", room: "study"},
    {key: "rgb", name: "RGB灯环", pin: 46, kind: "actuator", room: "bedroom"},
  ]);

  function storageKey() { return `smartlife.n16r8.registry.${PROFILE_ID}`; }
  function createSnapshot(rooms) {
    const defaults = Object.fromEntries(MODULES.map((module) => [module.key, module.room]));
    return {profileId: PROFILE_ID, updatedAt: Date.now(), rooms: {...defaults, ...(rooms || {})}};
  }

  return {PROFILE_ID, MODULES, storageKey, createSnapshot};
});
