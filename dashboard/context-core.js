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

  function isFresh(lastAt, now, staleMs) {
    return Number.isFinite(lastAt) && now - lastAt <= staleMs;
  }

  function modeLabel(mode) {
    return MODE_LABELS[mode] || mode || "—";
  }

  function alertLabel(alert) {
    return ALERT_LABELS[alert] || alert;
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

  return {PROJECT_ID, MODE_LABELS, ALERT_LABELS, isFresh, modeLabel, alertLabel, normalizeTelemetry};
});
