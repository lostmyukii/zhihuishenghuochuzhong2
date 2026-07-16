(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VoiceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROJECT_ID = "smartlife-junior-context";
  const PROFILE_ID = "smartlife-junior-context-detective-v1";
  const MODES = Object.freeze(["detect", "study", "rest", "ventilation", "energy", "custom"]);
  const ALLOWED_INTENTS = Object.freeze([
    "queryContext", "explainContext", "setMode", "confirmContext", "correctContext",
    "setThreshold", "querySafety", "muteBuzzer", "unknown",
  ]);
  const CONTROL_INTENTS = new Set(["setMode", "confirmContext", "correctContext", "setThreshold", "muteBuzzer"]);
  const READ_ONLY_INTENTS = new Set(["queryContext", "explainContext", "querySafety"]);
  const THRESHOLD_RULES = Object.freeze({
    lightThreshold: Object.freeze({min: 0, max: 4095, step: 100}),
    soundThreshold: Object.freeze({min: 0, max: 4095, step: 50}),
    temperatureThreshold: Object.freeze({min: 10, max: 45, step: 1}),
    humidityThreshold: Object.freeze({min: 20, max: 95, step: 5}),
    mq2Threshold: Object.freeze({min: 0, max: 2600, step: 50}),
  });
  const MODE_RULES = [
    ["ventilation", /(通风|闷|湿热|换气)/],
    ["study", /(学习|写作业|专心|专注)/],
    ["rest", /(休息|睡觉|安静)/],
    ["energy", /(节能|离开|出门|无人)/],
    ["custom", /(自定义|我的情境)/],
    ["detect", /(侦测|检查|侦探|看看家里)/],
  ];
  const SENSOR_KEYS = new Set(["light", "sound", "temperature", "humidity", "pir", "keypad", "mq2", "water", "flame"]);
  const CONTEXT_KEYS = new Set(["fresh", "mode", "candidate", "coverage", "match", "alerts", "thresholds", "sensors"]);

  function finiteNumber(value) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function validMode(mode) {
    return MODES.includes(mode);
  }

  function validThresholdSettings(settings) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
    const entries = Object.entries(settings);
    if (entries.length !== 1) return null;
    const [key, raw] = entries[0];
    const rule = THRESHOLD_RULES[key];
    const value = finiteNumber(raw);
    if (!rule || value === null || value < rule.min || value > rule.max) return null;
    if (Math.abs((value - rule.min) / rule.step - Math.round((value - rule.min) / rule.step)) > 1e-9) return null;
    return {[key]: value};
  }

  function unknown(reason = "意图不在网页白名单或参数无效") {
    return {intent: "unknown", confidence: 0, provider: "browser-whitelist", reason};
  }

  function sanitizeServerIntent(payload) {
    if (!payload || typeof payload !== "object") return unknown("服务端意图格式无效");
    if (payload.project !== PROJECT_ID || payload.profileId !== PROFILE_ID) return unknown("项目身份不匹配");
    if (!ALLOWED_INTENTS.includes(payload.intent)) return unknown();

    const confidence = Math.max(0, Math.min(1, finiteNumber(payload.confidence) ?? 0));
    if (CONTROL_INTENTS.has(payload.intent) && confidence < 0.6) return unknown("控制意图置信度不足");
    const result = {
      intent: payload.intent,
      confidence,
      provider: String(payload.provider || "server"),
      reason: String(payload.reason || "").slice(0, 160),
      reply: String(payload.reply || "").slice(0, 200),
      text: String(payload.text || "").slice(0, 500),
    };

    if (payload.intent === "setMode") {
      if (!validMode(payload.mode)) return unknown();
      result.mode = payload.mode;
    } else if (payload.intent === "confirmContext") {
      if (!validMode(payload.candidate)) return unknown();
      result.candidate = payload.candidate;
    } else if (payload.intent === "correctContext") {
      if (!validMode(payload.mode)) return unknown();
      result.mode = payload.mode;
    } else if (payload.intent === "setThreshold") {
      const settings = validThresholdSettings(payload.settings);
      if (!settings) return unknown();
      result.settings = settings;
    }
    return result;
  }

  function fallback(intent, details = {}) {
    return {intent, ...details, confidence: 0.8, provider: "browser-rules"};
  }

  function parseIntent(text, context = {}) {
    const normalized = String(text || "").trim();
    if (!normalized) return unknown("没有可解析文字");
    if (/(为什么|依据|理由|怎么判断|解释).*(情境|判断|学习|休息|通风|节能)?/.test(normalized)) return fallback("explainContext");
    if (/(安全|风险|报警).*(查询|怎么样|状态|吗|有没有)?/.test(normalized)) return fallback("querySafety");
    if (/(当前|现在|家里).*(什么情境|哪种情境|什么状态|在做什么)/.test(normalized)) return fallback("queryContext");
    if (/(确认|没错|就是这样|判断正确)/.test(normalized) && validMode(context.candidate)) {
      return fallback("confirmContext", {candidate: context.candidate});
    }
    if (/(不对|不正确|判断错|纠正)/.test(normalized)) {
      for (const [mode, pattern] of MODE_RULES) {
        if (pattern.test(normalized)) return fallback("correctContext", {mode});
      }
      return unknown("纠正语句缺少合法情境");
    }
    if (/(蜂鸣|报警).*(静音|不要响|关闭声音)/.test(normalized)) return fallback("muteBuzzer");
    for (const [mode, pattern] of MODE_RULES) {
      if (pattern.test(normalized)) return fallback("setMode", {mode});
    }
    return unknown("本地规则无法安全归并");
  }

  function toCommand(intent, id) {
    if (!intent || !id || !CONTROL_INTENTS.has(intent.intent)) return null;
    if (intent.confidence !== undefined && (finiteNumber(intent.confidence) ?? 0) < 0.6) return null;
    const base = {type: "command", project: PROJECT_ID, id: String(id)};
    if (intent.intent === "setMode" && validMode(intent.mode)) return {...base, mode: intent.mode};
    if (intent.intent === "muteBuzzer") return {...base, set: {buzzerEnabled: false}};
    if (intent.intent === "confirmContext" && validMode(intent.candidate)) {
      return {...base, contextConfirm: {candidate: intent.candidate, correct: true}};
    }
    if (intent.intent === "correctContext" && validMode(intent.mode)) {
      return {...base, contextCorrect: {mode: intent.mode}};
    }
    if (intent.intent === "setThreshold") {
      const settings = validThresholdSettings(intent.settings);
      return settings ? {...base, set: settings} : null;
    }
    return null;
  }

  function safeContext(context) {
    const source = context && typeof context === "object" ? context : {};
    const result = {};
    for (const key of CONTEXT_KEYS) {
      if (!(key in source)) continue;
      if (key === "mode" || key === "candidate") {
        if (validMode(source[key])) result[key] = source[key];
      } else if (key === "sensors") {
        const sensors = {};
        if (source.sensors && typeof source.sensors === "object") {
          for (const [sensor, value] of Object.entries(source.sensors)) {
            if (SENSOR_KEYS.has(sensor) && (value === null || typeof value === "boolean" || finiteNumber(value) !== null)) sensors[sensor] = value;
          }
        }
        result.sensors = sensors;
      } else if (key === "thresholds") {
        const thresholds = {};
        if (source.thresholds && typeof source.thresholds === "object") {
          for (const [name, value] of Object.entries(source.thresholds)) {
            if (THRESHOLD_RULES[name] && finiteNumber(value) !== null) thresholds[name] = value;
          }
        }
        result.thresholds = thresholds;
      } else if (key === "alerts") {
        result.alerts = Array.isArray(source.alerts) ? source.alerts.slice(0, 8).map((value) => String(value).slice(0, 80)) : [];
      } else if (key === "fresh") {
        result.fresh = source.fresh === true;
      } else {
        const value = finiteNumber(source[key]);
        if (value !== null) result[key] = value;
      }
    }
    return result;
  }

  function intentRequest(text, context = {}) {
    return {
      text: String(text || "").trim().slice(0, 500),
      project: PROJECT_ID,
      profileId: PROFILE_ID,
      context: safeContext(context),
    };
  }

  return {
    PROJECT_ID,
    PROFILE_ID,
    MODES,
    ALLOWED_INTENTS,
    READ_ONLY_INTENTS,
    THRESHOLD_RULES,
    parseIntent,
    sanitizeServerIntent,
    toCommand,
    intentRequest,
  };
});
