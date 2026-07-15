(function () {
  "use strict";

  const COMMAND_TIMEOUT_MS = 2500;
  const TELEMETRY_STALE_MS = 3500;
  const RECONNECT_MS = 1200;
  const MAX_LOG_ITEMS = 12;
  const searchParams = new URLSearchParams(window.location.search);
  const endpoint = searchParams.get("ws") || "ws://127.0.0.1:18766";
  const pendingCommands = new Map();
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  let socket = null;
  let reconnectTimer = null;
  let serialPort = null;
  let serialReader = null;
  let serialWriter = null;
  let serialReadTask = null;
  let lastTelemetryAt = null;
  let currentTelemetry = null;
  let currentSource = null;

  const $ = (id) => document.getElementById(id);
  const setText = (id, value) => {
    const element = $(id);
    if (element) element.textContent = value;
  };
  const valueOrDash = (value) => value === undefined || value === null || value === "" ? "—" : String(value);
  const boolLabel = (value) => value === true ? "是" : value === false ? "否" : "—";
  const percent = (value) => Number.isFinite(Number(value)) ? `${Number(value)}%` : "—";

  setText("ws-endpoint", endpoint);

  function setStatus(id, copy, state) {
    const element = $(id);
    if (!element) return;
    element.textContent = copy;
    element.dataset.state = state;
  }

  function logEvent(message) {
    const list = $("event-log");
    if (!list) return;
    if (list.children.length === 1 && list.firstElementChild.querySelector("time")?.textContent === "—") list.textContent = "";
    const item = document.createElement("li");
    const timestamp = document.createElement("time");
    timestamp.textContent = new Date().toLocaleTimeString("zh-CN", {hour12: false});
    const copy = document.createElement("span");
    copy.textContent = message;
    item.append(timestamp, copy);
    list.prepend(item);
    while (list.children.length > MAX_LOG_ITEMS) list.lastElementChild.remove();
  }

  function commandId(prefix = "web") {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  }

  function connectWebSocket() {
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
      logEvent("WebSocket 已连接，等待项目数据");
    });
    socket.addEventListener("message", (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch (_error) { return; }
      dispatchFrame(frame, "websocket");
    });
    socket.addEventListener("close", () => {
      setStatus("ws-status", "已断开", "danger");
      if (!serialPort) rejectPending("WebSocket 已断开");
      logEvent("WebSocket 已断开，准备重连");
      reconnectTimer = setTimeout(connectWebSocket, RECONNECT_MS);
    });
    socket.addEventListener("error", () => setStatus("ws-status", "连接错误", "danger"));
  }

  async function connectSerial() {
    if (!("serial" in navigator)) {
      setStatus("usb-status", "浏览器不支持", "danger");
      showAck("请使用桌面版 Chrome 或 Edge 打开页面", "danger");
      return;
    }
    if (serialPort) return;
    try {
      serialPort = await navigator.serial.requestPort();
      await serialPort.open({baudRate: 115200});
      serialReader = serialPort.readable.getReader();
      serialWriter = serialPort.writable.getWriter();
      $("serial-connect").disabled = true;
      $("serial-disconnect").disabled = false;
      setStatus("usb-status", "已授权 · 115200", "ok");
      logEvent("Web Serial 已连接，等待 hello / telemetry");
      serialReadTask = readSerialLoop();
    } catch (error) {
      setStatus("usb-status", "连接失败", "danger");
      logEvent(`Web Serial 连接失败：${error.name || error.message}`);
      await disconnectSerial(false);
    }
  }

  async function readSerialLoop() {
    const parser = new SerialCore.LineParser();
    try {
      while (serialReader) {
        const {value, done} = await serialReader.read();
        if (done) break;
        parser.push(textDecoder.decode(value, {stream: true})).forEach((frame) => dispatchFrame(frame, "serial"));
      }
    } catch (error) {
      if (serialPort) logEvent(`串口读取中断：${error.name || error.message}`);
    } finally {
      if (serialPort) await disconnectSerial(false);
    }
  }

  async function disconnectSerial(userInitiated = true) {
    const reader = serialReader;
    const writer = serialWriter;
    serialReader = null;
    serialWriter = null;
    try { if (reader) await reader.cancel(); } catch (_error) {}
    try { if (reader) reader.releaseLock(); } catch (_error) {}
    try { if (writer) writer.releaseLock(); } catch (_error) {}
    try { if (serialPort) await serialPort.close(); } catch (_error) {}
    serialPort = null;
    serialReadTask = null;
    $("serial-connect").disabled = false;
    $("serial-disconnect").disabled = true;
    setStatus("usb-status", "未连接", "muted");
    if (currentSource === "serial") clearTelemetry();
    if (userInitiated) {
      rejectPending("Web Serial 已断开");
      logEvent("Web Serial 已由用户断开");
    }
  }

  function dispatchFrame(frame, source) {
    if (!SerialCore.acceptFrame(frame)) return;
    if (source === "websocket" && serialPort && frame.type !== "health") return;
    if (frame.type === "telemetry") receiveTelemetry(frame, source);
    else if (frame.type === "ack") receiveAck(frame);
    else if (frame.type === "hello") {
      const label = frame.mock === true ? "Mock 模拟板" : "N16R8 开发板";
      logEvent(`收到 ${label} hello · ${frame.firmware || "未知版本"}`);
    } else if (frame.type === "health") {
      if (frame.source === "serial-gateway") logEvent(frame.online ? `Python 串口网关在线：${frame.serialPort}` : "Python 串口网关离线");
    }
  }

  function receiveTelemetry(frame, source) {
    const telemetry = ContextCore.normalizeTelemetry(frame);
    if (!telemetry) return;
    currentTelemetry = telemetry;
    currentSource = source;
    lastTelemetryAt = Date.now();
    const isMock = telemetry.mock === true;
    setText("source-label", isMock ? "Mock 模拟数据" : source === "serial" ? "Web Serial 开发板遥测" : "网关转发开发板遥测");
    setStatus("board-status", isMock ? "模拟板在线" : "开发板数据在线", "ok");
    setStatus("data-status", "新鲜遥测", "ok");
    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.disabled = !isMock;
      button.title = isMock ? "" : "安全场景按钮只用于 Mock 调试";
    });
    renderTelemetry(telemetry);
  }

  function renderTelemetry(telemetry) {
    const context = telemetry.context || {};
    const contextMode = context.candidate || telemetry.mode;
    setText("context-title", ContextCore.modeLabel(contextMode));
    setText("current-mode-pill", ContextCore.modeLabel(telemetry.mode));
    setText("context-description", contextDescription(context.status));
    setText("coverage-value", percent(context.coverage));
    setText("match-value", percent(context.match));
    setText("context-status", ContextCore.statusLabel(context.status));
    renderList("supporting-list", mapEvidence(context.supporting), "暂无支持证据");
    renderList("opposing-list", mapEvidence(context.opposing), "无明显反对证据");
    renderList("missing-list", mapEvidence(context.missing), "关键证据完整");

    const sensors = telemetry.sensors || {};
    setText("sensor-light", valueOrDash(sensors.light));
    setText("sensor-sound", valueOrDash(sensors.sound));
    setText("sensor-temperature", sensors.temperature == null ? "—" : `${sensors.temperature}℃`);
    setText("sensor-humidity", sensors.humidity == null ? "—" : `${sensors.humidity}%`);
    setText("sensor-pir", boolLabel(sensors.pir));
    setText("sensor-keypad", valueOrDash(sensors.keypad));
    setText("sensor-mq2", valueOrDash(sensors.mq2));
    setText("sensor-water", boolLabel(sensors.water));
    setText("sensor-flame", boolLabel(sensors.flame));
    renderSensorHealth(telemetry);

    const targets = telemetry.actuatorTargets;
    const actual = telemetry.actuators;
    const actuatorView = ContextCore.actuatorPresentation(telemetry);
    setText("actuator-buzzer", actuatorView.buzzer);
    setText("actuator-fan", actuatorView.fan);
    setText("actuator-servo", actuatorView.servo);
    setText("actuator-relay", actuatorView.relay);
    setText("actuator-rgb", actuatorView.rgb);
    if (!targets || !actual) logEvent("执行器计划或真实状态字段缺失");

    const alerts = AlertCore.describeAlerts(telemetry);
    renderAlerts(telemetry, alerts);
    renderHouseMap(telemetry, alerts);
    const health = telemetry.health || {};
    const safetyOverride = telemetry.safety?.overrideActive === true;
    if (actuatorView.applyLabel === "Mock模拟执行") {
      setText("safety-state", safetyOverride ? "安全覆盖中 · Mock模拟执行" : "Mock模拟执行");
    } else if (health.actuatorApplyState === "boot-guard") {
      const remaining = Number(health.actuatorBootGuardRemainingMs);
      setText("safety-state", Number.isFinite(remaining) ? `启动保护中 · 剩余 ${Math.ceil(remaining / 1000)} 秒` : "启动保护中");
    } else {
      setText("safety-state", safetyOverride ? `安全覆盖中 · ${actuatorView.applyLabel}` : actuatorView.applyLabel);
    }
    setText("calibration-status", telemetry.mock === true
      ? "Mock 数据只验证协议，不代表实物标定。"
      : actuatorView.calibrationRequired
        ? hardwareVerificationSummary(health)
        : "板端上报硬件标定已完成。");
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === telemetry.mode));
    document.querySelectorAll("[data-scenario]").forEach((button) => button.classList.toggle("active", button.dataset.scenario === telemetry.mockScenario));
    updateAge();
  }

  function renderSensorHealth(telemetry) {
    const valid = telemetry.sensorValid || {};
    const ages = telemetry.sensorAgeMs || {};
    const activeSensors = activeSensorsForMode(telemetry.mode);
    const keys = ["light", "sound", "temperature", "humidity", "pir", "keypad", "mq2", "water", "flame"];
    keys.forEach((key) => {
      const card = document.querySelector(`[data-sensor="${key}"]`);
      const validity = valid[key];
      const mockDefault = telemetry.mock === true && validity === undefined;
      const isValid = mockDefault || validity === true;
      const age = ages[key];
      card?.classList.toggle("is-active", activeSensors.has(key));
      card?.classList.toggle("is-invalid", !isValid);
      const suffix = age == null ? "" : ` · ${age}ms`;
      setText(`valid-${key}`, isValid ? `有效${suffix}` : `无效或待采样${suffix}`);
    });
  }

  function activeSensorsForMode(mode) {
    const table = {
      detect: ["light", "sound", "temperature", "humidity", "pir", "mq2", "water", "flame"],
      study: ["light", "sound", "temperature", "humidity", "pir"],
      rest: ["light", "sound", "temperature", "humidity", "pir"],
      ventilation: ["temperature", "humidity", "pir", "mq2"],
      energy: ["light", "sound", "pir"],
      custom: ["keypad", "light", "sound", "pir"],
    };
    return new Set(table[mode] || []);
  }

  function renderAlerts(telemetry, alerts) {
    const banner = $("alert-banner");
    if (!alerts.length) {
      banner.hidden = true;
      banner.textContent = "";
      return;
    }
    banner.hidden = false;
    banner.textContent = alerts.map((alert) => `${alert.detail} 系统动作：${alert.actions}`).join("；");
    if (telemetry.safety?.buzzerMuted) banner.textContent += "；用户已静音蜂鸣器，其他安全联动继续。";
  }

  function renderHouseMap(telemetry, alerts) {
    const activeRooms = {
      study: ["study", "living"], rest: ["bedroom"], ventilation: ["living", "bedroom"], energy: ["living", "study", "bedroom"], custom: ["living"], detect: [],
    }[telemetry.mode] || [];
    const alertRooms = new Set();
    alerts.forEach((alert) => {
      if (alert.code === "mq2" || alert.code === "flame") alertRooms.add("kitchen");
      if (alert.code === "water") alertRooms.add("bathroom");
      if (alert.code === "safety_sensor_fault") ["kitchen", "bathroom"].forEach((room) => alertRooms.add(room));
    });
    document.querySelectorAll("#house-map [data-room]").forEach((room) => {
      room.classList.toggle("is-active", activeRooms.includes(room.dataset.room));
      room.classList.toggle("is-alert", alertRooms.has(room.dataset.room));
    });
  }

  function hardwareVerificationSummary(health) {
    const waiting = [];
    for (const [key, label] of [["fanHardwareVerified", "风扇"], ["servoHardwareVerified", "舵机"], ["relayHardwareVerified", "继电器"], ["rgbHardwareVerified", "RGB"]]) {
      if (health[key] !== true) waiting.push(label);
    }
    return waiting.length ? `程序已联动；${waiting.join("、")}仍待实物验收。` : "程序已联动；传感器阈值仍待实物复核。";
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

  async function sendCommand(payload, description, suppliedId = null) {
    const id = suppliedId || commandId();
    const command = payload.type === "command"
      ? {...payload, project: ContextCore.PROJECT_ID, id}
      : {type: "command", project: ContextCore.PROJECT_ID, id, ...payload};
    let route = null;
    try {
      if (serialWriter) {
        await serialWriter.write(textEncoder.encode(SerialCore.encodeCommand(command)));
        route = "Web Serial";
      } else if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(command));
        route = "WebSocket";
      }
    } catch (error) {
      showAck(`${description} 发送失败：${error.name || error.message}`, "danger");
      return;
    }
    if (!route) {
      showAck("Web Serial 和 WebSocket 均不可用，命令未发送", "danger");
      return;
    }
    const timeout = setTimeout(() => {
      pendingCommands.delete(id);
      updatePendingCount();
      showAck(`${description} 超时，未收到同 ID ack`, "danger");
      logEvent(`命令超时 ${id}`);
    }, COMMAND_TIMEOUT_MS);
    pendingCommands.set(id, {description, timeout});
    updatePendingCount();
    showAck(`${description} 已经由 ${route} 发送，等待 ack`, "waiting");
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
      showAck(`${pending.description} 已由板端确认`, "ok");
      logEvent(`ack 成功 ${frame.id}`);
    } else {
      showAck(`${pending.description} 被拒绝：${frame.error || "未知错误"}`, "danger");
      logEvent(`ack 失败 ${frame.id} · ${frame.error || "unknown"}`);
    }
  }

  function rejectPending(reason) {
    pendingCommands.forEach((pending) => clearTimeout(pending.timeout));
    if (pendingCommands.size) showAck(`${reason}，待处理命令已取消`, "danger");
    pendingCommands.clear();
    updatePendingCount();
  }

  function updatePendingCount() { setText("pending-count", String(pendingCommands.size)); }
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
    const age = Math.max(0, Math.round((Date.now() - lastTelemetryAt) / 100) / 10);
    setText("telemetry-age", `${age} 秒前`);
    setStatus("data-status", age <= 1.5 ? "新鲜遥测" : "遥测延迟", age <= 1.5 ? "ok" : "waiting");
  }

  function clearTelemetry() {
    currentTelemetry = null;
    lastTelemetryAt = null;
    currentSource = null;
    setText("source-label", "等待数据来源");
    setStatus("board-status", "等待实时数据", "waiting");
    setStatus("data-status", "遥测已过期", "danger");
    setText("context-title", "等待实时数据");
    setText("context-description", "telemetry 已过期，页面已清除旧情境判断与执行器状态。");
    ["coverage-value", "match-value", "context-status", "telemetry-age", "sensor-light", "sensor-sound", "sensor-temperature", "sensor-humidity", "sensor-pir", "sensor-keypad", "sensor-mq2", "sensor-water", "sensor-flame", "actuator-buzzer", "actuator-fan", "actuator-servo", "actuator-relay", "actuator-rgb", "safety-state", "calibration-status"].forEach((id) => setText(id, "—"));
    ["light", "sound", "temperature", "humidity", "pir", "keypad", "mq2", "water", "flame"].forEach((key) => setText(`valid-${key}`, "等待"));
    renderList("supporting-list", [], "等待实时数据");
    renderList("opposing-list", [], "—");
    renderList("missing-list", [], "—");
    $("alert-banner").hidden = true;
    document.querySelectorAll(".is-active, .is-alert, .is-invalid, button.active").forEach((element) => element.classList.remove("is-active", "is-alert", "is-invalid", "active"));
  }

  function parseButtonValue(raw) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw;
  }

  function renderRegistry() {
    const grid = $("registry-grid");
    grid.textContent = "";
    const stored = readRegistry();
    const roomLabels = {kitchen: "厨房", bathroom: "卫生间", living: "客厅", study: "书房", bedroom: "卧室", entry: "门厅"};
    RegistryCore.MODULES.forEach((module) => {
      const row = document.createElement("div");
      row.className = "registry-row";
      const name = document.createElement("strong");
      name.textContent = module.name;
      const pin = document.createElement("small");
      pin.textContent = `GPIO${module.pin} · ${module.kind === "sensor" ? "传感器" : "执行器"}`;
      const select = document.createElement("select");
      select.dataset.registryKey = module.key;
      Object.entries(roomLabels).forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = (stored.rooms?.[module.key] || module.room) === value;
        select.appendChild(option);
      });
      row.append(name, pin, select);
      grid.appendChild(row);
    });
  }

  function readRegistry() {
    try {
      const stored = JSON.parse(localStorage.getItem(RegistryCore.storageKey()) || "null");
      return stored?.profileId === RegistryCore.PROFILE_ID ? stored : RegistryCore.createSnapshot();
    } catch (_error) { return RegistryCore.createSnapshot(); }
  }

  function saveRegistry() {
    const rooms = {};
    document.querySelectorAll("[data-registry-key]").forEach((select) => { rooms[select.dataset.registryKey] = select.value; });
    const snapshot = RegistryCore.createSnapshot(rooms);
    localStorage.setItem(RegistryCore.storageKey(), JSON.stringify(snapshot));
    showAck("设备注册已保存到本浏览器；未冒充云端同步", "ok");
    logEvent("本地设备注册已保存");
  }

  function runVoice(text) {
    const intent = VoiceCore.parseIntent(text);
    if (intent.intent === "unknown") {
      setText("voice-result", "没有匹配到允许的情境或安全命令，未发送到主板。");
      return;
    }
    if (intent.intent === "querySafety") {
      const alerts = currentTelemetry ? AlertCore.describeAlerts(currentTelemetry) : [];
      setText("voice-result", currentTelemetry ? (alerts.length ? alerts.map((item) => `${item.title}：${item.actions}`).join("；") : "当前没有板端安全告警。") : "尚未收到新鲜 telemetry，无法回答安全状态。");
      return;
    }
    const id = commandId("voice");
    const command = VoiceCore.toCommand(intent, id);
    if (!command) return;
    const description = intent.intent === "setMode" ? `网页语义切换到${ContextCore.modeLabel(intent.mode)}` : intent.enabled ? "恢复蜂鸣器安全声音" : "蜂鸣器静音";
    setText("voice-result", `${description}；已转成白名单标准命令。`);
    sendCommand(command, description, id);
  }

  $("serial-connect").addEventListener("click", connectSerial);
  $("serial-disconnect").addEventListener("click", () => disconnectSerial(true));
  $("registry-save").addEventListener("click", saveRegistry);
  $("voice-submit").addEventListener("click", () => runVoice($("voice-text").value));
  $("voice-text").addEventListener("keydown", (event) => { if (event.key === "Enter") runVoice(event.currentTarget.value); });
  document.querySelectorAll("[data-voice-quick]").forEach((button) => button.addEventListener("click", () => {
    $("voice-text").value = button.dataset.voiceQuick;
    runVoice(button.dataset.voiceQuick);
  }));
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => sendCommand({mode: button.dataset.mode}, `切换到${button.textContent}`)));
  document.querySelectorAll("[data-scenario]").forEach((button) => button.addEventListener("click", () => sendCommand({mockScenario: button.dataset.scenario}, `安全场景：${button.textContent}`)));
  document.querySelectorAll("[data-actuator]").forEach((button) => button.addEventListener("click", () => {
    const actuator = button.dataset.actuator;
    const value = parseButtonValue(button.dataset.value);
    sendCommand({actuator: {[actuator]: value}}, `${button.closest("article").querySelector("header span").textContent} · ${button.textContent}`);
  }));
  window.addEventListener("beforeunload", () => {
    clearTimeout(reconnectTimer);
    if (serialReader) serialReader.cancel().catch(() => {});
  });

  renderRegistry();
  setInterval(updateAge, 500);
  connectWebSocket();
})();
