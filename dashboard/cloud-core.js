(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CloudCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROJECT_ID = "smartlife-junior-context";
  const PROFILE_ID = "smartlife-junior-context-detective-v1";
  const PUBLIC_WS_PATH = "/smartlife-context-ws";
  const BOARD_TYPES = new Set(["hello", "telemetry", "health", "ack"]);
  const TRANSPORT_KEYS = new Set(["profileId", "origin", "originClientId", "source", "relayedAt", "usbWritten", "mqttTopic"]);

  function createClientId() {
    const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2);
    return `context-browser-${random}`;
  }

  function defaultEndpoint(locationLike, override = "") {
    if (override) return override;
    const hostname = locationLike?.hostname || "";
    if (["127.0.0.1", "localhost"].includes(hostname)) return "ws://127.0.0.1:18766";
    const scheme = locationLike?.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${locationLike.host}${PUBLIC_WS_PATH}`;
  }

  function isPublicEndpoint(endpoint) {
    try {
      const parsed = new URL(endpoint);
      return parsed.pathname === PUBLIC_WS_PATH;
    } catch (_error) {
      return false;
    }
  }

  function matchesIdentity(frame) {
    return Boolean(frame && frame.project === PROJECT_ID && frame.profileId === PROFILE_ID);
  }

  function decorateBoardFrame(frame, clientId) {
    if (!frame || frame.project !== PROJECT_ID || !BOARD_TYPES.has(frame.type) || !clientId) return null;
    return {...frame, profileId: PROFILE_ID, origin: "web-serial-gateway", source: "browser-usb", originClientId: clientId};
  }

  function decorateClientCommand(command, clientId) {
    if (!command || command.type !== "command" || command.project !== PROJECT_ID || !command.id || !clientId) return null;
    return {...command, profileId: PROFILE_ID, origin: "dashboard", originClientId: clientId};
  }

  function classifyIncoming(frame, ownClientId) {
    if (!matchesIdentity(frame)) return "ignore";
    if (frame.originClientId && frame.originClientId === ownClientId) return "ignore";
    if (BOARD_TYPES.has(frame.type)) return "board";
    if (frame.type === "command" && frame.id) return "command";
    if (frame.type === "relayStatus") return "relay-status";
    return "ignore";
  }

  function commandForSerial(frame) {
    if (classifyIncoming(frame, "__never_self__") !== "command") return null;
    const result = {};
    Object.entries(frame).forEach(([key, value]) => {
      if (!TRANSPORT_KEYS.has(key) && !key.startsWith("_")) result[key] = value;
    });
    return result;
  }

  return {
    PROJECT_ID,
    PROFILE_ID,
    PUBLIC_WS_PATH,
    createClientId,
    defaultEndpoint,
    isPublicEndpoint,
    matchesIdentity,
    decorateBoardFrame,
    decorateClientCommand,
    classifyIncoming,
    commandForSerial,
  };
});
