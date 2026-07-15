(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DashboardStateCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROJECT_ID = "smartlife-junior-context";
  const PROFILE_ID = "smartlife-junior-context-detective-v1";
  const DEFAULT_STALE_MS = 3500;
  const STATE_KINDS = Object.freeze(["waiting", "real-live", "mock-live", "stale", "offline"]);

  function matchesIdentity(frame, type) {
    return Boolean(frame) && frame.type === type && frame.project === PROJECT_ID && frame.profileId === PROFILE_ID;
  }

  function isFresh(lastTelemetryAt, now, staleMs) {
    return Number.isFinite(lastTelemetryAt) && Number.isFinite(now) && now - lastTelemetryAt <= staleMs;
  }

  function state(kind, boardLabel, sourceLabel, dataLabel, dataState) {
    return Object.freeze({kind, boardLabel, sourceLabel, dataLabel, dataState});
  }

  function resolveState(options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const staleMs = Number.isFinite(options.staleMs) ? options.staleMs : DEFAULT_STALE_MS;
    const telemetryMatches = matchesIdentity(options.telemetry, "telemetry");
    const telemetryFresh = telemetryMatches && isFresh(options.lastTelemetryAt, now, staleMs);
    const helloMatches = matchesIdentity(options.hello, "hello");

    if (telemetryFresh && options.telemetry.mock === true) {
      return state("mock-live", "模拟板在线", "Mock 模拟数据", "新鲜模拟遥测", "ok");
    }

    if (telemetryFresh && options.telemetry.mock !== true && helloMatches && options.hello.mock !== true) {
      const sourceLabel = options.telemetryRoute === "serial" ? "Web Serial 真板数据" : "Python 网关真板数据";
      return state("real-live", "真板在线", sourceLabel, "新鲜真板遥测", "ok");
    }

    if (telemetryMatches && Number.isFinite(options.lastTelemetryAt) && !telemetryFresh) {
      return state("stale", "数据已过期", "缓存已清除", "遥测已过期", "danger");
    }

    if (options.serialConnected || options.websocketOpen) {
      return state("waiting", "等待实时数据", "无实时数据", "等待项目遥测", "waiting");
    }

    return state("offline", "开发板离线", "无实时数据", "连接未建立", "muted");
  }

  return {PROJECT_ID, PROFILE_ID, DEFAULT_STALE_MS, STATE_KINDS, matchesIdentity, isFresh, resolveState};
});
