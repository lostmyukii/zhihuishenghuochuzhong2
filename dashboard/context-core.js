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
    safety_sensor_fault: "安全传感器数据异常",
  });
  const SERVO_LABELS = Object.freeze({
    hold: "保持位置",
    study: "学习位置",
    rest: "休息位置",
    "ventilation-open": "通风打开",
    energy: "节能位置",
    "safety-closed": "安全关闭",
  });
  const BUZZER_LABELS = Object.freeze({
    off: "关闭",
    alarm: "安全报警",
    intermittent: "间歇报警",
  });
  const RGB_LABELS = Object.freeze({
    off: "关闭",
    study: "学习状态",
    orange: "橙色",
    "blue-low": "低亮蓝色",
    cyan: "青色",
    yellow: "黄色",
    red: "红色",
    green: "绿色",
    blue: "蓝色",
    purple: "紫色",
    "blue-red": "蓝红提示",
    gray: "灰色",
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
      actuatorTargets: frame.actuatorTargets && typeof frame.actuatorTargets === "object" ? frame.actuatorTargets : {},
      actuators: frame.actuators && typeof frame.actuators === "object" ? frame.actuators : {},
      context: frame.context && typeof frame.context === "object" ? frame.context : {},
      alerts: Array.isArray(frame.alerts) ? frame.alerts : [],
      safety: frame.safety && typeof frame.safety === "object" ? frame.safety : {},
      health: frame.health && typeof frame.health === "object" ? frame.health : {},
    };
  }

  function known(value, formatter) {
    return value === undefined || value === null || value === "" ? "未知" : formatter(value);
  }

  function boolAction(value) {
    return value === true ? "开启" : value === false ? "关闭" : "未知";
  }

  function targetLabels(targets) {
    return {
      fan: known(targets.fanPercent, (value) => `${value}%`),
      servo: known(targets.servoPosition, (value) => SERVO_LABELS[value] || value),
      relay: boolAction(targets.relayOn),
      buzzer: known(targets.buzzerMode, (value) => BUZZER_LABELS[value] || value),
      rgb: known(targets.rgbState, (value) => RGB_LABELS[value] || value),
    };
  }

  function actualLabels(actuators) {
    return {
      fan: known(actuators.fanPercent, (value) => `${value}%`),
      servo: known(actuators.servoAngle, (value) => `${value}°`),
      relay: boolAction(actuators.relayOn),
      buzzer: boolAction(actuators.buzzerOn),
      rgb: known(actuators.rgbState, (value) => RGB_LABELS[value] || value),
    };
  }

  function actuatorPresentation(frame) {
    const telemetry = normalizeTelemetry(frame) || frame || {};
    const targets = targetLabels(telemetry.actuatorTargets || {});
    const actuators = actualLabels(telemetry.actuators || {});
    const health = telemetry.health || {};
    const simulated = telemetry.mock === true || health.actuatorApplyState === "simulated";
    const bootGuard = !simulated && health.actuatorApplyState === "boot-guard";
    const fullyArmed = !simulated && health.actuatorApplyState === "fully-armed";
    const unarmed = !simulated && health.actuatorApplyState === "unarmed";
    const partialBuzzer = !simulated && health.actuatorApplyState === "partial-buzzer-test";
    const partialBuzzerRgb = !simulated && health.actuatorApplyState === "partial-buzzer-rgb-test";
    const actualPrefix = simulated ? "模拟执行" : "实际";
    const actualValue = (key) => unarmed || bootGuard ||
      (partialBuzzer && key !== "buzzer") ||
      (partialBuzzerRgb && key !== "buzzer" && key !== "rgb")
      ? "未武装/未应用"
      : actuators[key];
    const row = (key) => `计划：${targets[key]} / ${actualPrefix}：${actualValue(key)}`;

    return {
      fan: row("fan"),
      servo: row("servo"),
      relay: row("relay"),
      buzzer: row("buzzer"),
      rgb: row("rgb"),
      applyLabel: simulated
        ? "Mock模拟执行"
        : bootGuard
          ? "启动保护中"
          : fullyArmed
            ? "整屋自动联动"
        : unarmed
          ? "执行器未武装"
          : partialBuzzer
            ? "仅蜂鸣器测试已武装"
            : partialBuzzerRgb
              ? "蜂鸣器与RGB测试已武装"
              : "实际状态",
      calibrationRequired: health.calibrationRequired === true || health.hardwareVerified === false,
    };
  }

  return {PROJECT_ID, MODE_LABELS, ALERT_LABELS, EVIDENCE_LABELS, STATUS_LABELS, isFresh, modeLabel, alertLabel, evidenceLabel, statusLabel, normalizeTelemetry, actuatorPresentation};
});
