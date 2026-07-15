(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AlertCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const META = {
    mq2: {title: "烟雾/燃气风险", key: "mq2", gpio: 2},
    water: {title: "漏水风险", key: "water", gpio: 8},
    flame: {title: "火焰风险", key: "flame", gpio: 45},
    safety_sensor_fault: {title: "安全传感器数据异常", key: null, gpio: null},
  };

  function actionSummary(frame) {
    const actual = frame.actuators || {};
    const values = [];
    if (actual.fanPercent !== undefined && actual.fanPercent !== null) values.push(`风扇 ${actual.fanPercent}%`);
    if (actual.relayOn !== undefined && actual.relayOn !== null) values.push(`继电器${actual.relayOn ? "吸合" : "断开"}`);
    if (actual.rgbState) values.push(`RGB ${actual.rgbState}`);
    if (actual.buzzerOn === true) values.push("蜂鸣器报警");
    else if (frame.safety && frame.safety.buzzerMuted) values.push("蜂鸣器已静音");
    return values.length ? values.join("、") : "等待真实执行状态";
  }

  function describeAlerts(frame) {
    const seen = new Set();
    const codes = [
      ...(Array.isArray(frame.alerts) ? frame.alerts : []),
      ...(frame.safety && Array.isArray(frame.safety.causes) ? frame.safety.causes : []),
    ];
    return codes.filter((code) => {
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    }).map((code) => {
      const meta = META[code];
      if (!meta) return {code, title: `设备上报异常：${code}`, detail: "板端上报了未知代码。", actions: actionSummary(frame)};
      const value = meta.key && frame.sensors ? frame.sensors[meta.key] : null;
      const threshold = code === "mq2" && frame.health ? frame.health.mq2AlertRaw : null;
      const pieces = [meta.gpio === null ? meta.title : `${meta.title}，来源 GPIO${meta.gpio}`];
      if (value !== null && value !== undefined) pieces.push(`当前值 ${value}`);
      if (threshold !== null && threshold !== undefined) pieces.push(`阈值 ${threshold}`);
      return {code, title: meta.title, detail: `${pieces.join("，")}。`, actions: actionSummary(frame)};
    });
  }

  return {describeAlerts};
});
