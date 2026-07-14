(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ContextCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROJECT_ID = "smartlife-junior-context";
  const MODE_LABELS = Object.freeze({
    detect: "情境侦探",
    study: "专注学习",
    rest: "安心休息",
    ventilation: "通风换气",
    energy: "节能离家",
    custom: "自定义",
  });
  const ALERT_LABELS = Object.freeze({
    mq2: "烟雾或燃气风险",
    water: "检测到积水风险",
    flame: "检测到火焰风险",
  });
  const EVIDENCE_LABELS = Object.freeze({
    pir_active: "检测到近期人体活动",
    no_occupancy: "暂未检测到人体活动",
    pir_missing: "人体活动证据缺失",
    activity_low: "人体活动较少",
    light_suitable: "当前光照适合学习",
    light_not_suitable: "当前光照不符合该情境",
    light_missing: "光照证据缺失",
    light_dim: "当前光照较暗",
    light_too_bright: "当前光照偏亮",
    daylight_available: "自然光较充足",
    sound_study_quiet: "声音强度适合学习",
    sound_quiet: "环境声音较低",
    sound_high: "环境声音强度偏高",
    sound_missing: "声音强度证据缺失",
    dht_comfortable: "温湿度处于暂定舒适范围",
    dht_outside_comfort: "温湿度不在暂定舒适范围",
    dht_missing: "温湿度证据缺失或已过期",
    temperature_high: "温度达到暂定通风条件",
    temperature_not_high: "温度未达到暂定通风条件",
    temperature_missing: "温度证据缺失或已过期",
    humidity_high: "湿度达到暂定通风条件",
    humidity_not_high: "湿度未达到暂定通风条件",
    humidity_missing: "湿度证据缺失或已过期",
    custom_rule_unconfigured: "尚未配置自定义情境规则",
    all_context_sensors_missing: "没有可用于判断的新鲜情境证据",
  });
  const STATUS_LABELS = Object.freeze({
    matched: "证据匹配",
    possible: "可能情境",
    ambiguous: "多个情境接近",
    evidence_missing: "证据不足",
    confirmed: "用户已确认",
    corrected: "用户已纠正",
    unknown: "暂无法判断",
  });

  function isFresh(lastAt, now, staleMs) {
    return Number.isFinite(lastAt) && now - lastAt <= staleMs;
  }

  function modeLabel(mode) {
    return MODE_LABELS[mode] || mode || "—";
  }

  function alertLabel(alert) {
    return ALERT_LABELS[alert] || alert;
  }

  function evidenceLabel(evidence) {
    return EVIDENCE_LABELS[evidence] || evidence;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || "—";
  }

  function normalizeTelemetry(frame) {
    if (!frame || frame.type !== "telemetry" || frame.project !== PROJECT_ID) return null;
    return {
      ...frame,
      sensors: frame.sensors && typeof frame.sensors === "object" ? frame.sensors : {},
      actuators: frame.actuators && typeof frame.actuators === "object" ? frame.actuators : {},
      context: frame.context && typeof frame.context === "object" ? frame.context : {},
      alerts: Array.isArray(frame.alerts) ? frame.alerts : [],
    };
  }

  return {PROJECT_ID, MODE_LABELS, ALERT_LABELS, EVIDENCE_LABELS, STATUS_LABELS, isFresh, modeLabel, alertLabel, evidenceLabel, statusLabel, normalizeTelemetry};
});
