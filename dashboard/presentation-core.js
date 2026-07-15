(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PresentationCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SENSOR_DEFINITIONS = Object.freeze([
    {key: "temperature", name: "温度", gpio: 14, tier: "primary"},
    {key: "humidity", name: "湿度", gpio: 14, tier: "primary"},
    {key: "sound", name: "声音", gpio: 4, tier: "primary", unitNote: "相对强度"},
    {key: "pir", name: "人体感应", gpio: 5, tier: "primary"},
    {key: "light", name: "光照", gpio: 1, tier: "secondary", unitNote: "ADC原始值"},
    {key: "keypad", name: "8键AD", gpio: 10, tier: "secondary", unitNote: "ADC原始值"},
    {key: "mq2", name: "MQ2烟雾/燃气", gpio: 2, tier: "secondary", unitNote: "原始值，不等同空气质量或ppm"},
    {key: "water", name: "水滴", gpio: 8, tier: "secondary"},
    {key: "flame", name: "火焰", gpio: 45, tier: "secondary"},
  ]);

  const SERVO_LABELS = Object.freeze({hold: "保持位置", study: "学习位置", rest: "休息位置", "ventilation-open": "通风打开", energy: "节能位置", "safety-closed": "安全关闭"});
  const BUZZER_LABELS = Object.freeze({off: "关闭", alarm: "安全报警", intermittent: "间歇报警"});
  const RGB_LABELS = Object.freeze({off: "关闭", study: "学习状态", orange: "橙色", "blue-low": "低亮蓝色", cyan: "青色", yellow: "黄色", red: "红色", green: "绿色", blue: "蓝色", purple: "紫色", "blue-red": "蓝红提示", gray: "灰色"});

  const ACTUATOR_DEFINITIONS = Object.freeze([
    {key: "fan", name: "风扇", gpio: 11, target: "fanPercent", actual: "fanPercent", verified: "fanHardwareVerified"},
    {key: "servo", name: "舵机窗", gpio: 9, target: "servoPosition", actual: "servoAngle", verified: "servoHardwareVerified"},
    {key: "relay", name: "继电器LED", gpio: 12, target: "relayOn", actual: "relayOn", verified: "relayHardwareVerified"},
    {key: "buzzer", name: "蜂鸣器", gpio: 13, target: "buzzerMode", actual: "buzzerOn", verified: "buzzerHardwareVerified"},
    {key: "rgb", name: "RGB灯环", gpio: 46, target: "rgbState", actual: "rgbState", verified: "rgbHardwareVerified"},
  ]);

  function isKnown(value) {
    return value !== undefined && value !== null && value !== "";
  }

  function formatAge(age) {
    if (!Number.isFinite(age)) return "等待时间戳";
    if (age < 1000) return `${Math.max(0, Math.round(age))}ms`;
    return `${Math.round(age / 100) / 10}s`;
  }

  function formatSensorValue(key, value) {
    if (!isKnown(value)) return "未知";
    if (key === "temperature") return `${value} °C`;
    if (key === "humidity") return `${value} %RH`;
    if (key === "light" || key === "keypad" || key === "mq2") return `${value} ADC`;
    if (key === "pir") return value === true ? "有人" : value === false ? "无人" : "未知";
    if (key === "water" || key === "flame") return value === true ? "触发" : value === false ? "正常" : "未知";
    return String(value);
  }

  function sensorSections(frame) {
    const sensors = frame?.sensors || {};
    const valid = frame?.sensorValid || {};
    const ages = frame?.sensorAgeMs || {};
    const cards = SENSOR_DEFINITIONS.map((definition) => {
      const isValid = valid[definition.key] === true;
      const ageLabel = formatAge(ages[definition.key]);
      return Object.freeze({
        ...definition,
        value: formatSensorValue(definition.key, sensors[definition.key]),
        valid: isValid,
        ageLabel,
        healthLabel: `${isValid ? "有效" : "无效"} · ${ageLabel}`,
      });
    });
    return Object.freeze({
      primary: cards.filter((item) => item.tier === "primary"),
      secondary: cards.filter((item) => item.tier === "secondary"),
    });
  }

  function boolLabel(value) {
    return value === true ? "开启" : value === false ? "关闭" : "未知";
  }

  function planLabel(key, value) {
    if (!isKnown(value)) return "未知";
    if (key === "fan") return `${value}%`;
    if (key === "servo") return SERVO_LABELS[value] || String(value);
    if (key === "relay") return boolLabel(value);
    if (key === "buzzer") return BUZZER_LABELS[value] || String(value);
    if (key === "rgb") return RGB_LABELS[value] || String(value);
    return String(value);
  }

  function actualLabel(key, value) {
    if (!isKnown(value)) return "未知";
    if (key === "fan") return `${value}%`;
    if (key === "servo") return `${value}°`;
    if (key === "relay" || key === "buzzer") return boolLabel(value);
    if (key === "rgb") return RGB_LABELS[value] || String(value);
    return String(value);
  }

  function actuatorRows(frame) {
    const targets = frame?.actuatorTargets || {};
    const actuals = frame?.actuators || {};
    const health = frame?.health || {};
    const mock = frame?.mock === true || health.actuatorApplyState === "simulated";
    const source = frame?.safety?.overrideActive === true ? "安全覆盖" : "自动联动";
    return ACTUATOR_DEFINITIONS.map((definition) => Object.freeze({
      key: definition.key,
      name: definition.name,
      gpio: definition.gpio,
      plan: planLabel(definition.key, targets[definition.target]),
      actual: actualLabel(definition.key, actuals[definition.actual]),
      actualKind: mock ? "模拟执行" : "板端实际",
      source,
      verification: mock ? "Mock，不代表实物验收" : health[definition.verified] === true ? "已单项验证" : "待实物验收",
    }));
  }

  return {SENSOR_DEFINITIONS, ACTUATOR_DEFINITIONS, formatAge, sensorSections, actuatorRows};
});
