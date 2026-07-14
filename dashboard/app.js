(function () {
  "use strict";

  const COMMAND_TIMEOUT_MS = 2500;
  const TELEMETRY_STALE_MS = 3500;
  const RECONNECT_MS = 1200;
  const searchParams = new URLSearchParams(window.location.search);
  const endpoint = searchParams.get("ws") || "ws://127.0.0.1:18766";
  const pendingCommands = new Map();
  let socket = null;
  let reconnectTimer = null;
  let lastTelemetryAt = null;
  let currentTelemetry = null;

  const $ = (id) => document.getElementById(id);
  const setText = (id, value) => { $(id).textContent = value; };
  const boolLabel = (value) => value === true ? "是" : value === false ? "否" : "—";
  const onOff = (value) => value === true ? "开启" : value === false ? "关闭" : "—";
  const percent = (value) => Number.isFinite(value) ? `${value}%` : "—";

  setText("ws-endpoint", endpoint);

  function setStatus(id, text, state) {
    const element = $(id);
    element.textContent = text;
    element.dataset.state = state;
  }

  function logEvent(message) {
    const list = $("event-log");
    if (list.children.length === 1 && list.firstElementChild.querySelector("time").textContent === "—") list.textContent = "";
    const item = document.createElement("li");
    const timestamp = document.createElement("time");
    timestamp.textContent = new Date().toLocaleTimeString("zh-CN", {hour12: false});
    const copy = document.createElement("span");
    copy.textContent = message;
    item.append(timestamp, copy);
    list.prepend(item);
    while (list.children.length > 5) list.lastElementChild.remove();
  }

  function connect() {
    clearTimeout(reconnectTimer);
    setStatus("ws-status", "连接中", "waiting");
    try {
      socket = new WebSocket(endpoint);
    } catch (error) {
      setStatus("ws-status", "地址无效", "danger");
      logEvent(`WebSocket 地址无效：${error.message}`);
      return;
    }
    socket.addEventListener("open", () => {
      setStatus("ws-status", "已连接", "ok");
      logEvent("WebSocket 已连接，等待项目 telemetry");
    });
    socket.addEventListener("message", (event) => {
      let frame;
      try { frame = JSON.parse(event.data); }
      catch (_error) { return; }
      if (frame.project !== ContextCore.PROJECT_ID) return;
      if (frame.type === "telemetry") receiveTelemetry(frame);
      else if (frame.type === "ack") receiveAck(frame);
      else if (frame.type === "hello") logEvent(frame.mock === true ? "收到 mock board hello" : "收到开发板 hello");
    });
    socket.addEventListener("close", () => {
      setStatus("ws-status", "已断开", "danger");
      logEvent("WebSocket 已断开，准备重连");
      rejectPending("连接断开");
      reconnectTimer = setTimeout(connect, RECONNECT_MS);
    });
    socket.addEventListener("error", () => setStatus("ws-status", "连接错误", "danger"));
  }

  function receiveTelemetry(frame) {
    const telemetry = ContextCore.normalizeTelemetry(frame);
    if (!telemetry) return;
    currentTelemetry = telemetry;
    lastTelemetryAt = Date.now();
    const isMock = telemetry.mock === true;
    setText("source-label", isMock ? "Mock 模拟数据" : "开发板遥测");
    setStatus("board-status", isMock ? "模拟板在线" : "开发板数据在线", "ok");
    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.disabled = !isMock;
      button.title = isMock ? "" : "安全场景按钮只用于 mock 调试";
    });
    renderTelemetry(telemetry);
  }

  function renderTelemetry(telemetry) {
    const context = telemetry.context;
    setText("context-title", ContextCore.modeLabel(context.candidate || telemetry.mode));
    setText("context-description", contextDescription(context.status));
    setText("coverage-value", percent(context.coverage));
    setText("match-value", percent(context.match));
    setText("context-status", ContextCore.statusLabel(context.status));
    renderList("supporting-list", mapEvidence(context.supporting), "暂无支持证据");
    renderList("opposing-list", mapEvidence(context.opposing), "无明显反对证据");
    renderList("missing-list", mapEvidence(context.missing), "关键证据完整");

    const sensors = telemetry.sensors;
    setText("sensor-light", valueOrDash(sensors.light));
    setText("sensor-sound", valueOrDash(sensors.sound));
    setText("sensor-temperature", valueOrDash(sensors.temperature));
    setText("sensor-humidity", valueOrDash(sensors.humidity));
    setText("sensor-pir", boolLabel(sensors.pir));
    setText("sensor-keypad", valueOrDash(sensors.keypad));
    setText("sensor-mq2", valueOrDash(sensors.mq2));
    setText("sensor-hazards", `${sensors.water ? "积水" : "无积水"} / ${sensors.flame ? "火焰" : "无火焰"}`);

    const actuators = telemetry.actuators;
    setText("actuator-buzzer", onOff(actuators.buzzer));
    setText("actuator-fan", Number.isFinite(actuators.fan) ? `${actuators.fan}%` : "—");
    setText("actuator-servo", Number.isFinite(actuators.servo) ? `${actuators.servo}°` : "—");
    setText("actuator-relay", onOff(actuators.relay));
    setText("actuator-rgb", valueOrDash(actuators.rgb));

    const alerts = telemetry.alerts.map(ContextCore.alertLabel);
    const banner = $("alert-banner");
    banner.hidden = alerts.length === 0;
    banner.textContent = alerts.length ? `安全优先：${alerts.join("、")}` : "";
    const actuatorsReady = telemetry.health && telemetry.health.actuatorsReady !== false;
    setText("safety-state", telemetry.safety && telemetry.safety.overridden ? "安全覆盖中" : actuatorsReady ? "情境策略" : "阶段 3 未驱动");
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === telemetry.mode));
    document.querySelectorAll("[data-scenario]").forEach((button) => button.classList.toggle("active", button.dataset.scenario === telemetry.mockScenario));
    updateAge();
  }

  function renderList(id, items, emptyCopy) {
    const list = $(id);
    list.textContent = "";
    const values = Array.isArray(items) && items.length ? items : [emptyCopy];
    values.forEach((value) => {
      const item = document.createElement("li");
      item.textContent = value;
      list.appendChild(item);
    });
  }

  function mapEvidence(items) {
    return Array.isArray(items) ? items.map(ContextCore.evidenceLabel) : [];
  }

  function contextDescription(status) {
    if (status === "matched" || status === "possible") return "当前多源证据相互支持，形成可解释的候选情境。";
    if (status === "ambiguous") return "两个或多个情境得分接近，需要补充证据或人工确认。";
    if (status === "evidence_missing") return "必需传感器失效或证据覆盖不足，系统不会强行下结论。";
    return "当前证据尚不足以形成稳定判断。";
  }

  function valueOrDash(value) {
    return value === undefined || value === null || value === "" ? "—" : String(value);
  }

  function sendCommand(payload, description) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      showAck("WebSocket 未连接，命令未发送", "danger");
      return;
    }
    const id = `web-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    const command = {type: "command", project: ContextCore.PROJECT_ID, id, ...payload};
    const timeout = setTimeout(() => {
      pendingCommands.delete(id);
      updatePendingCount();
      showAck(`${description} 超时，未收到同 ID ack`, "danger");
      logEvent(`命令超时 ${id}`);
    }, COMMAND_TIMEOUT_MS);
    pendingCommands.set(id, {description, timeout});
    updatePendingCount();
    socket.send(JSON.stringify(command));
    showAck(`${description} 已发送，等待 ack`, "waiting");
  }

  function receiveAck(frame) {
    const pending = pendingCommands.get(frame.id);
    if (!pending) {
      logEvent(`收到未匹配 ack：${frame.id || "空 ID"}`);
      return;
    }
    clearTimeout(pending.timeout);
    pendingCommands.delete(frame.id);
    updatePendingCount();
    if (frame.ok) {
      showAck(`${pending.description} 已确认`, "ok");
      logEvent(`ack 成功 ${frame.id}`);
    } else {
      showAck(`${pending.description} 被拒绝：${frame.error || "未知错误"}`, "danger");
      logEvent(`ack 失败 ${frame.id}`);
    }
  }

  function rejectPending(reason) {
    pendingCommands.forEach((pending) => clearTimeout(pending.timeout));
    if (pendingCommands.size) showAck(`${reason}，待处理命令已取消`, "danger");
    pendingCommands.clear();
    updatePendingCount();
  }

  function updatePendingCount() {
    setText("pending-count", `${pendingCommands.size} 待处理`);
  }

  function showAck(copy, state) {
    const summary = $("ack-summary");
    summary.textContent = copy;
    summary.dataset.state = state;
  }

  function updateAge() {
    if (!ContextCore.isFresh(lastTelemetryAt, Date.now(), TELEMETRY_STALE_MS)) {
      if (currentTelemetry) clearTelemetry();
      return;
    }
    setText("telemetry-age", `${Math.max(0, Math.round((Date.now() - lastTelemetryAt) / 100) / 10)} 秒前`);
  }

  function clearTelemetry() {
    currentTelemetry = null;
    lastTelemetryAt = null;
    setText("source-label", "等待数据来源");
    setStatus("board-status", "等待实时数据", "waiting");
    setText("context-title", "等待实时数据");
    setText("context-description", "telemetry 已过期，页面已清除旧情境判断。");
    ["coverage-value", "match-value", "context-status", "telemetry-age", "sensor-light", "sensor-sound", "sensor-temperature", "sensor-humidity", "sensor-pir", "sensor-keypad", "sensor-mq2", "sensor-hazards", "actuator-buzzer", "actuator-fan", "actuator-servo", "actuator-relay", "actuator-rgb", "safety-state"].forEach((id) => setText(id, "—"));
    renderList("supporting-list", [], "等待实时数据");
    renderList("opposing-list", [], "—");
    renderList("missing-list", [], "—");
    $("alert-banner").hidden = true;
    document.querySelectorAll("button.active").forEach((button) => button.classList.remove("active"));
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => sendCommand({mode: button.dataset.mode}, `切换到${button.textContent}`)));
  document.querySelectorAll("[data-scenario]").forEach((button) => button.addEventListener("click", () => sendCommand({mockScenario: button.dataset.scenario}, `安全场景：${button.textContent}`)));
  setInterval(updateAge, 500);
  connect();
})();
