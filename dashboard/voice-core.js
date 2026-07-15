(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoiceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROJECT_ID = "smartlife-junior-context";
  const MODE_RULES = [
    ["ventilation", /(通风|闷|湿热|换气)/],
    ["study", /(学习|写作业|专心|专注)/],
    ["rest", /(休息|睡觉|安静)/],
    ["energy", /(节能|离开|出门|无人)/],
    ["custom", /(自定义|我的情境)/],
    ["detect", /(侦测|检查|侦探|看看家里)/],
  ];

  function parseIntent(text) {
    const normalized = String(text || "").trim();
    if (!normalized) return {intent: "unknown"};
    if (/(蜂鸣|报警).*(静音|不要响|关闭声音)/.test(normalized)) {
      return {intent: "setBuzzerEnabled", enabled: false};
    }
    if (/(恢复|开启).*(蜂鸣|报警声)/.test(normalized)) {
      return {intent: "setBuzzerEnabled", enabled: true};
    }
    for (const [mode, pattern] of MODE_RULES) {
      if (pattern.test(normalized)) return {intent: "setMode", mode};
    }
    if (/(安全|风险|报警).*(查询|怎么样|状态)/.test(normalized)) {
      return {intent: "querySafety"};
    }
    return {intent: "unknown"};
  }

  function toCommand(intent, id) {
    if (!intent || !id) return null;
    if (intent.intent === "setMode") {
      return {type: "command", project: PROJECT_ID, id, mode: intent.mode};
    }
    if (intent.intent === "setBuzzerEnabled") {
      return {type: "command", project: PROJECT_ID, id, set: {buzzerEnabled: intent.enabled}};
    }
    return null;
  }

  return {PROJECT_ID, parseIntent, toCommand};
});
