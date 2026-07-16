(function () {
  "use strict";

  const COMMAND_TIMEOUT_MS = 2500;
  const TELEMETRY_STALE_MS = 3500;
  const RECONNECT_MS = 1200;
  const MAX_LOG_ITEMS = 30;
  const MAX_RECENT_ITEMS = 5;
  const WORKBENCHES = new Set(["overview", "registry", "linkage", "voice", "debug", "logs"]);
  const searchParams = new URLSearchParams(window.location.search);
  const endpoint = searchParams.get("ws") || "ws://127.0.0.1:18766";
  const localVoice = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  const transcribeEndpoint = searchParams.get("stt") || (localVoice ? "http://127.0.0.1:19468/api/voice/transcribe" : "/api/voice/transcribe");
  const intentEndpoint = searchParams.get("intent") || (localVoice ? "http://127.0.0.1:19468/api/voice/intent" : "/api/voice/intent");
  const commandLedger = new CommandLedgerCore.CommandLedger({timeoutMs: COMMAND_TIMEOUT_MS, maxEntries: 40});
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  let socket = null;
  let websocketOpen = false;
  let reconnectTimer = null;
  let serialPort = null;
  let serialReader = null;
  let serialWriter = null;
  let serialReadTask = null;
  let latestHello = null;
  let latestHelloSource = null;
  let lastTelemetryAt = null;
  let currentTelemetry = null;
  let currentSource = null;
  let lastAlertSignature = "";
  let voiceSession = VoiceSessionCore.createSession();
  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceStopTimer = null;

  const $ = (id) => document.getElementById(id);
  const setText = (id, value) => {
    const element = $(id);
    if (element) element.textContent = value;
  };
  const percent = (value) => Number.isFinite(Number(value)) ? `${Number(value)}%` : "—";

  setText("ws-endpoint", endpoint);

  function setStatus(id, copy, state) {
    const element = $(id);
    if (!element) return;
    element.textContent = copy;
    element.dataset.state = state;
  }

  function appendEvent(list, message, limit) {
    if (!list) return;
    if (list.children.length === 1 && list.firstElementChild.querySelector("time")?.textContent === "—") list.textContent = "";
    const item = document.createElement("li");
    const timestamp = document.createElement("time");
    timestamp.dateTime = new Date().toISOString();
    timestamp.textContent = new Date().toLocaleTimeString("zh-CN", {hour12: false});
    const copy = document.createElement("span");
    copy.textContent = message;
    item.append(timestamp, copy);
    list.prepend(item);
    while (list.children.length > limit) list.lastElementChild.remove();
  }

  function logEvent(message) {
    appendEvent($("event-log"), message, MAX_LOG_ITEMS);
    appendEvent($("recent-events"), message, MAX_RECENT_ITEMS);
  }

  function commandId(prefix = "web") {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  }

  function activateWorkbench(requested) {
    const route = WORKBENCHES.has(requested) ? requested : "overview";
    document.querySelectorAll("[data-workbench]").forEach((section) => {
      section.hidden = section.dataset.workbench !== route;
    });
    document.querySelectorAll(".workbench-nav a").forEach((link) => {
      const active = link.getAttribute("href") === `#${route}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function refreshConnectionTruth() {
    const matchingHello = latestHelloSource === currentSource ? latestHello : null;
    const state = DashboardStateCore.resolveState({
      hello: matchingHello,
      telemetry: currentTelemetry,
      lastTelemetryAt,
      now: Date.now(),
      serialConnected: Boolean(serialPort),
      websocketOpen,
      telemetryRoute: currentSource,
      staleMs: TELEMETRY_STALE_MS,
    });
    setStatus("board-status", state.boardLabel, state.dataState);
    setStatus("source-status", state.sourceLabel, state.dataState);
    setText("source-label", state.sourceLabel);
    return state;
  }

  function connectWebSocket() {
    clearTimeout(reconnectTimer);
    setStatus("ws-status", "连接中", "waiting");
    try {
      socket = new WebSocket(endpoint);
    } catch (error) {
      websocketOpen = false;
      setStatus("ws-status", "地址无效", "danger");
      logEvent(`WebSocket 地址无效：${error.message}`);
      refreshConnectionTruth();
      return;
    }
    socket.addEventListener("open", () => {
      websocketOpen = true;
      setStatus("ws-status", "已连接", "ok");
      logEvent("WebSocket 已连接，等待项目数据");
      refreshConnectionTruth();
    });
    socket.addEventListener("message", (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch (_error) { return; }
      dispatchFrame(frame, "websocket");
    });
    socket.addEventListener("close", () => {
      websocketOpen = false;
      setStatus("ws-status", "重连中", "waiting");
      if (!serialPort) rejectPending("WebSocket 已断开");
      if (currentSource === "websocket") clearTelemetry();
      if (latestHelloSource === "websocket") {
        latestHello = null;
        latestHelloSource = null;
      }
      logEvent("WebSocket 已断开，准备重连");
      refreshConnectionTruth();
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
      latestHello = null;
      latestHelloSource = null;
      $("serial-connect").disabled = true;
      $("serial-disconnect").disabled = false;
      setStatus("usb-status", "已授权 · 115200", "ok");
      logEvent("Web Serial 已连接，等待 hello / telemetry");
      refreshConnectionTruth();
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
    if (latestHelloSource === "serial") {
      latestHello = null;
      latestHelloSource = null;
    }
    if (userInitiated) {
      rejectPending("Web Serial 已断开");
      logEvent("Web Serial 已由用户断开");
    }
    refreshConnectionTruth();
  }

  function dispatchFrame(frame, source) {
    if (!SerialCore.acceptFrame(frame)) return;
    if (source === "websocket" && serialPort && frame.type !== "health") return;
    if (frame.type === "telemetry") receiveTelemetry(frame, source);
    else if (frame.type === "ack") receiveAck(frame);
    else if (frame.type === "hello") {
      latestHello = frame;
      latestHelloSource = source;
      const label = frame.mock === true ? "Mock 模拟板" : "N16R8 开发板";
      logEvent(`收到 ${label} hello · ${frame.firmware || "未知版本"}`);
      refreshConnectionTruth();
    } else if (frame.type === "health" && frame.source === "serial-gateway") {
      logEvent(frame.online ? `Python 串口网关在线：${frame.serialPort}` : "Python 串口网关离线");
    }
  }

  function receiveTelemetry(frame, source) {
    const telemetry = ContextCore.normalizeTelemetry(frame);
    if (!telemetry) return;
    currentTelemetry = telemetry;
    currentSource = source;
    lastTelemetryAt = Date.now();
    const isMock = telemetry.mock === true;
    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.disabled = !isMock;
      button.title = isMock ? "" : "安全场景按钮只用于 Mock 调试";
    });
    commandLedger.entries().filter((entry) => entry.status === "ack-ok").forEach((entry) => updateSourceCard(commandLedger.markObservedActual(entry.id, lastTelemetryAt)));
    if (voiceSession.state === "acked") {
      voiceSession = VoiceSessionCore.markObserved(voiceSession, lastTelemetryAt);
      renderVoiceSession("同ID ACK后已收到新遥测；实物验收状态保持独立。", "ok");
    }
    renderTelemetry(telemetry);
    refreshConnectionTruth();
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
    setText("house-verdict", `${ContextCore.modeLabel(contextMode)} · ${ContextCore.statusLabel(context.status)}`);
    renderList("supporting-list", mapEvidence(context.supporting), "暂无支持证据");
    renderList("opposing-list", mapEvidence(context.opposing), "无明显反向证据");
    renderList("missing-list", mapEvidence(context.missing), "关键证据完整");

    renderSensors(telemetry);

    const targets = telemetry.actuatorTargets;
    const actual = telemetry.actuators;
    const rows = PresentationCore.actuatorRows(telemetry);
    rows.forEach((row) => {
      setText(`actuator-plan-${row.key}`, `${row.source}：${row.plan}`);
      setText(`actuator-actual-${row.key}`, `${row.actualKind}：${row.actual}`);
      setText(`actuator-verify-${row.key}`, row.verification);
      setText(`actuator-${row.key}`, `计划：${row.plan} / ${row.actualKind}：${row.actual}`);
      document.querySelector(`[data-actuator-row="${row.key}"]`)?.classList.toggle("is-verified", row.verification === "已单项验证");
    });
    if (!targets || !actual) logEvent("执行器计划或真实状态字段缺失");

    const alerts = AlertCore.describeAlerts(telemetry);
    renderAlerts(telemetry, alerts);
    renderHouseMap(telemetry, alerts);
    renderSafetyAndCalibration(telemetry);
    renderKeypadSource(telemetry);
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === telemetry.mode));
    document.querySelectorAll("[data-scenario]").forEach((button) => button.classList.toggle("active", button.dataset.scenario === telemetry.mockScenario));
    updateAge();
  }

  function renderSensors(telemetry) {
    const sections = PresentationCore.sensorSections(telemetry);
    const activeSensors = activeSensorsForMode(telemetry.mode);
    const all = [...sections.primary, ...sections.secondary];
    all.forEach((item) => {
      setText(`sensor-${item.key}`, item.value);
      setText(`valid-${item.key}`, item.healthLabel);
      const card = document.querySelector(`[data-sensor="${item.key}"]`);
      card?.classList.toggle("is-active", activeSensors.has(item.key));
      card?.classList.toggle("is-invalid", !item.valid);
    });
    const validCount = all.filter((item) => item.valid).length;
    setText("sensor-summary", `${validCount}/${all.length} 项有效`);
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
      lastAlertSignature = "";
      return;
    }
    banner.hidden = false;
    banner.textContent = alerts.map((alert) => `${alert.detail} 系统动作：${alert.actions}`).join("；");
    if (telemetry.safety?.buzzerMuted) banner.textContent += "；用户已静音蜂鸣器，其他安全联动继续。";
    const signature = alerts.map((alert) => alert.code).sort().join("|");
    if (signature !== lastAlertSignature) logEvent(`安全事件：${alerts.map((alert) => alert.title).join("、")}`);
    lastAlertSignature = signature;
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

  function renderSafetyAndCalibration(telemetry) {
    const health = telemetry.health || {};
    const safetyOverride = telemetry.safety?.overrideActive === true;
    const applyState = health.actuatorApplyState;
    let applyLabel = "板端未声明应用状态";
    if (telemetry.mock === true || applyState === "simulated") applyLabel = "Mock模拟执行";
    else if (applyState === "boot-guard") {
      const remaining = Number(health.actuatorBootGuardRemainingMs);
      applyLabel = Number.isFinite(remaining) ? `启动保护 · 剩余 ${Math.ceil(remaining / 1000)} 秒` : "启动保护";
    } else if (applyState === "fully-armed") applyLabel = "五类执行器已武装";
    else if (applyState === "unarmed") applyLabel = "执行器未武装";
    else if (applyState === "partial-buzzer-test") applyLabel = "仅蜂鸣器测试已武装";
    else if (applyState === "partial-buzzer-rgb-test") applyLabel = "蜂鸣器与RGB测试已武装";
    setText("safety-state", safetyOverride ? `安全覆盖中 · ${applyLabel}` : applyLabel);
    setText("calibration-status", telemetry.mock === true
      ? "Mock 数据只验证协议，不代表实物标定。"
      : health.calibrationRequired === true || health.hardwareVerified === false
        ? hardwareVerificationSummary(health)
        : "板端上报硬件标定已完成。");
  }

  function hardwareVerificationSummary(health) {
    const waiting = [];
    for (const [key, label] of [["fanHardwareVerified", "风扇"], ["servoHardwareVerified", "舵机"], ["relayHardwareVerified", "继电器"], ["buzzerHardwareVerified", "蜂鸣器"], ["rgbHardwareVerified", "RGB"]]) {
      if (health[key] !== true) waiting.push(label);
    }
    return waiting.length ? `程序状态已回传；${waiting.join("、")}仍待单项实物验收。` : "执行器已单项验收；传感阈值仍以实物复核为准。";
  }

  function renderKeypadSource(telemetry) {
    const keypad = telemetry.sensors?.keypad;
    const age = telemetry.sensorAgeMs?.keypad;
    const value = keypad === undefined || keypad === null ? "未知" : `${keypad} ADC`;
    setText("source-keypad", `${value}${Number.isFinite(age) ? ` · ${age}ms` : ""} · 当前仅采样`);
  }

  function renderList(id, items, emptyCopy) {
    const list = $(id);
    if (!list) return;
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

  function sourceElement(source) {
    return source === "voice" ? "source-voice" : source === "keypad" ? "source-keypad" : "source-web";
  }

  function updateSourceCard(entry) {
    if (!entry) return;
    const status = {
      pending: "等待ACK",
      "ack-ok": "ACK成功",
      "ack-error": `被拒绝 ${entry.error || "unknown"}`,
      timeout: "ACK超时",
      cancelled: "链路取消",
      observed: "ACK成功 · 已见新遥测",
    }[entry.status] || entry.status;
    setText(sourceElement(entry.source), `${entry.description} · ${entry.id} · ${status}`);
  }

  async function sendCommand(payload, description, suppliedId = null, source = "web") {
    const id = suppliedId || commandId(source);
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
      logEvent(`${description} 发送失败`);
      return null;
    }
    if (!route) {
      showAck("Web Serial 和 WebSocket 均不可用，命令未发送", "danger");
      return null;
    }
    const entry = commandLedger.start(command, {source, route, description, sentAt: Date.now()});
    updatePendingCount();
    updateSourceCard(entry);
    showAck(`${description} 已经由 ${route} 发送，等待同ID ACK`, "waiting");
    logEvent(`命令已发送 ${id} · ${description}`);
    return entry;
  }

  function receiveAck(frame) {
    const result = commandLedger.receiveAck(frame, Date.now());
    if (!result.matched) {
      showAck(`收到未匹配 ACK：${frame.id || "空ID"}；未关闭其它命令`, "danger");
      logEvent(`收到未匹配 ACK：${frame.id || "空ID"}`);
      return;
    }
    updatePendingCount();
    updateSourceCard(result.entry);
    if (voiceSession.state === "command-pending" && voiceSession.commandId === frame.id) {
      voiceSession = VoiceSessionCore.applyAck(voiceSession, frame);
      renderVoiceSession(frame.ok === true ? "已收到同ID ACK，等待新遥测观察。" : `板端拒绝：${frame.error || "unknown"}`, frame.ok === true ? "ok" : "danger");
    }
    if (result.entry.ok) {
      showAck(`${result.entry.description} 已收到同ID ACK；实物状态仍以新遥测和单项验收为准`, "ok");
      logEvent(`ACK成功 ${frame.id}`);
    } else {
      showAck(`${result.entry.description} 被拒绝：${result.entry.error}`, "danger");
      logEvent(`ACK失败 ${frame.id} · ${result.entry.error}`);
    }
  }

  function rejectPending(reason) {
    const cancelled = commandLedger.cancelPending(reason, Date.now());
    cancelled.forEach(updateSourceCard);
    if (voiceSession.state === "command-pending" && cancelled.some((entry) => entry.id === voiceSession.commandId)) {
      voiceSession = VoiceSessionCore.fail(voiceSession, reason);
      renderVoiceSession(reason, "danger");
    }
    if (cancelled.length) showAck(`${reason}，${cancelled.length}条待处理命令已取消`, "danger");
    updatePendingCount();
  }

  function updatePendingCount() { setText("pending-count", String(commandLedger.pendingCount())); }

  function showAck(copy, state) {
    const summary = $("ack-summary");
    if (!summary) return;
    summary.textContent = copy;
    summary.dataset.state = state;
  }

  function updateAge() {
    const now = Date.now();
    const expired = commandLedger.expire(now);
    expired.forEach((entry) => {
      updateSourceCard(entry);
      showAck(`${entry.description} 超时，未收到同ID ACK`, "danger");
      logEvent(`命令超时 ${entry.id}`);
      if (voiceSession.state === "command-pending" && voiceSession.commandId === entry.id) {
        voiceSession = VoiceSessionCore.fail(voiceSession, "同ID ACK超时，未确认执行");
        renderVoiceSession("同ID ACK超时，不能写成已执行。", "danger");
      }
    });
    if (expired.length) updatePendingCount();

    if (!ContextCore.isFresh(lastTelemetryAt, now, TELEMETRY_STALE_MS)) {
      if (currentTelemetry) {
        const staleState = DashboardStateCore.resolveState({
          hello: latestHelloSource === currentSource ? latestHello : null,
          telemetry: currentTelemetry,
          lastTelemetryAt,
          now,
          serialConnected: Boolean(serialPort),
          websocketOpen,
          telemetryRoute: currentSource,
          staleMs: TELEMETRY_STALE_MS,
        });
        clearTelemetry(staleState);
      }
      return;
    }
    const age = Math.max(0, Math.round((now - lastTelemetryAt) / 100) / 10);
    setText("telemetry-age", `${age} 秒前`);
  }

  function clearTelemetry(staleState = null) {
    currentTelemetry = null;
    lastTelemetryAt = null;
    currentSource = null;
    setText("source-label", staleState?.sourceLabel || "等待数据来源");
    setStatus("board-status", staleState?.boardLabel || "等待实时数据", staleState?.dataState || "waiting");
    setStatus("source-status", staleState?.sourceLabel || "无实时数据", staleState?.dataState || "waiting");
    setText("context-title", "等待实时数据");
    setText("current-mode-pill", "等待数据");
    setText("house-verdict", "等待证据");
    setText("context-description", "telemetry 已过期，页面已清除旧情境判断与执行器状态。");
    [
      "coverage-value", "match-value", "context-status", "telemetry-age", "sensor-light", "sensor-sound", "sensor-temperature", "sensor-humidity", "sensor-pir", "sensor-keypad", "sensor-mq2", "sensor-water", "sensor-flame",
      "actuator-buzzer", "actuator-fan", "actuator-servo", "actuator-relay", "actuator-rgb", "safety-state", "calibration-status",
      "actuator-plan-buzzer", "actuator-plan-fan", "actuator-plan-servo", "actuator-plan-relay", "actuator-plan-rgb",
      "actuator-actual-buzzer", "actuator-actual-fan", "actuator-actual-servo", "actuator-actual-relay", "actuator-actual-rgb",
      "actuator-verify-buzzer", "actuator-verify-fan", "actuator-verify-servo", "actuator-verify-relay", "actuator-verify-rgb",
    ].forEach((id) => setText(id, "—"));
    setText("sensor-summary", "等待数据");
    setText("source-keypad", "尚无新鲜按键输入");
    lastAlertSignature = "";
    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.disabled = true;
      button.title = "只有新鲜且明确标记mock=true的遥测才能启用";
    });
    ["light", "sound", "temperature", "humidity", "pir", "keypad", "mq2", "water", "flame"].forEach((key) => setText(`valid-${key}`, "等待"));
    renderList("supporting-list", [], "等待实时数据");
    renderList("opposing-list", [], "—");
    renderList("missing-list", [], "—");
    $("alert-banner").hidden = true;
    document.querySelectorAll(".is-active, .is-alert, .is-invalid, .is-verified, button.active").forEach((element) => element.classList.remove("is-active", "is-alert", "is-invalid", "is-verified", "active"));
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
      select.setAttribute("aria-label", `${module.name}房间`);
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

  const VOICE_STATE_COPY = {
    idle: "待命",
    "permission-requested": "请求麦克风权限",
    recording: "录音中",
    uploading: "上传 / 解析中",
    transcribed: "已识别文字",
    "intent-resolved": "意图已解析",
    "command-pending": "等待同ID ACK",
    acked: "ACK成功",
    observed: "已见后续遥测",
    failed: "流程失败",
  };
  const VOICE_INTENT_COPY = {
    queryContext: "查询当前情境",
    explainContext: "解释判断依据",
    setMode: "切换情境",
    confirmContext: "确认情境判断",
    correctContext: "纠正情境判断",
    setThreshold: "调整单项阈值",
    querySafety: "查询安全状态",
    muteBuzzer: "蜂鸣器静音",
    unknown: "未进入白名单",
  };

  function renderVoiceSession(note = "", forcedState = "") {
    const session = voiceSession;
    const stateCopy = VOICE_STATE_COPY[session.state] || session.state;
    const stateKind = forcedState || (session.state === "failed" ? "danger" : ["acked", "observed"].includes(session.state) ? "ok" : ["recording", "uploading", "command-pending"].includes(session.state) ? "waiting" : "muted");
    setStatus("home-voice-state", stateCopy, stateKind);
    setText("home-voice-text", session.text || "尚未识别");
    const confidence = Number.isFinite(Number(session.intent?.confidence)) ? ` · ${Math.round(Number(session.intent.confidence) * 100)}%` : "";
    setText("home-voice-intent", session.intent ? `${VOICE_INTENT_COPY[session.intent.intent] || session.intent.intent}${confidence}` : "尚未解析");
    let commandCopy = "尚未发送";
    if (session.commandId) commandCopy = `${session.commandId} · ${session.state === "command-pending" ? "等待ACK" : session.state === "acked" ? "ACK成功，等待遥测" : session.state === "observed" ? "ACK成功，已见新遥测" : session.error || session.state}`;
    else if (session.note) commandCopy = session.note;
    setText("home-voice-command", commandCopy);
    setText("voice-result", note || session.note || (session.error ? session.error : `当前阶段：${stateCopy}`));
    const busy = ["permission-requested", "recording", "uploading", "command-pending"].includes(session.state);
    for (const id of ["home-voice-start", "voice-mic-start"]) if ($(id)) $(id).disabled = busy;
    for (const id of ["home-voice-stop", "voice-mic-stop"]) if ($(id)) $(id).disabled = session.state !== "recording";
  }

  function currentVoiceContext() {
    const fresh = Boolean(currentTelemetry && ContextCore.isFresh(lastTelemetryAt, Date.now(), TELEMETRY_STALE_MS));
    if (!fresh) return {fresh: false};
    const context = currentTelemetry.context || {};
    return {
      fresh: true,
      mode: currentTelemetry.mode,
      candidate: context.candidate,
      coverage: context.coverage,
      match: context.match,
      alerts: AlertCore.describeAlerts(currentTelemetry).map((item) => item.code || item.title),
      thresholds: currentTelemetry.thresholds || currentTelemetry.health?.thresholds || {},
      sensors: currentTelemetry.sensors || {},
    };
  }

  function queryVoiceReply(intent) {
    if (!currentTelemetry || !ContextCore.isFresh(lastTelemetryAt, Date.now(), TELEMETRY_STALE_MS)) return "当前没有3500ms内的新鲜遥测，无法可靠回答。";
    const context = currentTelemetry.context || {};
    if (intent.intent === "queryContext") {
      const candidate = context.candidate || currentTelemetry.mode;
      return `当前板端模式为${ContextCore.modeLabel(currentTelemetry.mode)}，候选情境为${ContextCore.modeLabel(candidate)}，判断状态是${ContextCore.statusLabel(context.status)}。`;
    }
    if (intent.intent === "explainContext") {
      const supporting = Array.isArray(context.supporting) ? context.supporting.map(ContextCore.evidenceLabel) : [];
      const opposing = Array.isArray(context.opposing) ? context.opposing.map(ContextCore.evidenceLabel) : [];
      const missing = Array.isArray(context.missing) ? context.missing.map(ContextCore.evidenceLabel) : [];
      return `支持证据：${supporting.join("、") || "暂无"}；反向证据：${opposing.join("、") || "无明显反向证据"}；缺失证据：${missing.join("、") || "关键证据完整"}。`;
    }
    const alerts = AlertCore.describeAlerts(currentTelemetry);
    return alerts.length ? alerts.map((item) => `${item.title}：${item.actions}`).join("；") : "当前新鲜遥测中没有板端安全告警。";
  }

  function voiceCommandDescription(intent) {
    if (intent.intent === "setMode") return `网页语义切换到${ContextCore.modeLabel(intent.mode)}`;
    if (intent.intent === "muteBuzzer") return "蜂鸣器静音（其他安全联动继续）";
    if (intent.intent === "confirmContext") return `确认候选情境${ContextCore.modeLabel(intent.candidate)}`;
    if (intent.intent === "correctContext") return `纠正情境为${ContextCore.modeLabel(intent.mode)}`;
    if (intent.intent === "setThreshold") {
      const [key, value] = Object.entries(intent.settings || {})[0] || ["未知阈值", "—"];
      return `调整${key}为${value}`;
    }
    return "网页语义命令";
  }

  function boardSupportsVoiceIntent(intent) {
    const capability = VoiceCore.requiredCapability(intent);
    if (!capability || latestHelloSource !== currentSource) return false;
    const commands = latestHello?.capabilities?.commands;
    return Array.isArray(commands) && commands.includes(capability);
  }

  async function requestVoiceIntent(text) {
    const response = await fetch(intentEndpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(VoiceCore.intentRequest(text, currentVoiceContext())),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) throw new Error(payload.message || `意图服务返回 ${response.status}`);
    return VoiceCore.sanitizeServerIntent(payload);
  }

  async function resolveVoiceText(text, serverFirst = true) {
    let intent;
    let fallbackNote = "";
    try {
      if (!serverFirst) throw new Error("skip_server");
      intent = await requestVoiceIntent(text);
    } catch (_error) {
      intent = VoiceCore.parseIntent(text, currentVoiceContext());
      fallbackNote = "服务端意图暂不可用，已使用本项目浏览器安全规则降级。";
    }
    voiceSession = VoiceSessionCore.move(voiceSession, "intent-resolved", {text, intent, note: fallbackNote});
    setText("source-voice", `${VOICE_INTENT_COPY[intent.intent] || intent.intent} · ${intent.provider || "unknown"}`);

    if (intent.intent === "unknown") {
      voiceSession = VoiceSessionCore.markObserved(voiceSession, Date.now());
      voiceSession = Object.freeze({...voiceSession, note: `${fallbackNote}${fallbackNote ? " " : ""}没有匹配到允许意图，未发送主板命令。`});
      renderVoiceSession(voiceSession.note, "danger");
      return;
    }
    if (VoiceCore.READ_ONLY_INTENTS.has(intent.intent)) {
      const reply = queryVoiceReply(intent);
      voiceSession = VoiceSessionCore.markObserved(voiceSession, Date.now());
      voiceSession = Object.freeze({...voiceSession, note: `${fallbackNote}${fallbackNote ? " " : ""}${reply}`});
      renderVoiceSession(voiceSession.note, reply.startsWith("当前没有") ? "waiting" : "ok");
      logEvent(`网页语音只读查询：${VOICE_INTENT_COPY[intent.intent]}`);
      return;
    }
    const requiredCapability = VoiceCore.requiredCapability(intent);
    if (requiredCapability && !boardSupportsVoiceIntent(intent)) {
      const firmware = latestHelloSource === currentSource ? latestHello?.firmware || "未知版本" : "未捕获启动身份";
      voiceSession = Object.freeze({...voiceSession, note: `${voiceCommandDescription(intent)}；当前链路${firmware}未声明${requiredCapability}能力，固件待升级，本次未发送。`});
      renderVoiceSession(voiceSession.note, "waiting");
      logEvent(`网页语音已解析但固件待升级：${requiredCapability}`);
      return;
    }

    const id = commandId("voice");
    const command = VoiceCore.toCommand(intent, id);
    if (!command) {
      voiceSession = VoiceSessionCore.fail(voiceSession, "浏览器第二道白名单拒绝了该命令");
      renderVoiceSession("浏览器第二道白名单拒绝了该命令，未发送。", "danger");
      return;
    }
    voiceSession = VoiceSessionCore.move(voiceSession, "command-pending", {intent, note: ""});
    voiceSession = VoiceSessionCore.attachCommand(voiceSession, id);
    renderVoiceSession(`已生成标准命令 ${id}，正在发送。`, "waiting");
    const entry = await sendCommand(command, voiceCommandDescription(intent), id, "voice");
    if (!entry && voiceSession.state === "command-pending") {
      voiceSession = VoiceSessionCore.fail(voiceSession, "实时链路不可用，命令未发送");
      renderVoiceSession("Web Serial和WebSocket均不可用，命令未发送。", "danger");
    }
  }

  async function runVoice(text) {
    const normalized = String(text || "").trim();
    if (!normalized) {
      voiceSession = VoiceSessionCore.fail(VoiceSessionCore.createSession(), "没有可解析文字");
      renderVoiceSession("请输入文字或点击开始说话。", "danger");
      return;
    }
    voiceSession = VoiceSessionCore.createSession();
    voiceSession = VoiceSessionCore.move(voiceSession, "uploading", {text: normalized, note: "正在请求服务端自然语义解析。"});
    renderVoiceSession("正在请求服务端自然语义解析。", "waiting");
    voiceSession = VoiceSessionCore.move(voiceSession, "transcribed", {text: normalized});
    await resolveVoiceText(normalized, true);
  }

  function microphoneConstraints() {
    const deviceId = $("voice-mic-select")?.value;
    return {audio: deviceId ? {deviceId: {exact: deviceId}} : true};
  }

  function releaseVoiceStream() {
    if (voiceStream) voiceStream.getTracks().forEach((track) => track.stop());
    voiceStream = null;
  }

  async function refreshMicrophones(requestPermission = false) {
    if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) {
      setStatus("voice-mic-status", "浏览器不支持麦克风", "danger");
      return;
    }
    let temporary = null;
    try {
      if (requestPermission) temporary = await navigator.mediaDevices.getUserMedia({audio: true});
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      const select = $("voice-mic-select");
      const previous = select.value;
      select.textContent = "";
      const fallback = document.createElement("option");
      fallback.value = "";
      fallback.textContent = "系统默认麦克风";
      select.appendChild(fallback);
      devices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `麦克风 ${index + 1}`;
        select.appendChild(option);
      });
      if ([...select.options].some((option) => option.value === previous)) select.value = previous;
      setStatus("voice-mic-status", requestPermission ? `已授权 · ${devices.length || 1}个输入` : `发现${devices.length || 1}个输入`, "ok");
    } catch (error) {
      setStatus("voice-mic-status", error.name === "NotAllowedError" ? "麦克风权限被拒绝" : "麦克风枚举失败", "danger");
    } finally {
      temporary?.getTracks().forEach((track) => track.stop());
    }
  }

  function preferredAudioType() {
    if (typeof MediaRecorder === "undefined") return "";
    return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
  }

  async function transcribeVoiceBlob(blob) {
    if (!blob || blob.size === 0) {
      voiceSession = VoiceSessionCore.fail(voiceSession, "录音为空");
      renderVoiceSession("没有采集到音频，未调用语义接口。", "danger");
      return;
    }
    voiceSession = VoiceSessionCore.move(voiceSession, "uploading", {note: `正在上传${Math.ceil(blob.size / 1024)}KB短音频。`});
    renderVoiceSession(voiceSession.note, "waiting");
    const form = new FormData();
    const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    form.append("audio", blob, `speech.${extension}`);
    form.append("language", "zh");
    form.append("prompt", "家庭情境 侦探屋 专注学习 安心休息 通风换气 无人节能 蜂鸣器");
    try {
      const response = await fetch(transcribeEndpoint, {method: "POST", body: form});
      const payload = await response.json().catch(() => ({}));
      const text = String(payload.text || "").trim();
      if (!response.ok || payload.ok !== true) throw new Error(payload.message || `语音识别返回 ${response.status}`);
      if (!text) throw new Error("语音识别没有返回文字");
      voiceSession = VoiceSessionCore.move(voiceSession, "transcribed", {text, note: "语音识别成功，正在解析意图。"});
      if ($("voice-text")) $("voice-text").value = text;
      if ($("home-voice-fallback")) $("home-voice-fallback").value = text;
      renderVoiceSession(voiceSession.note, "ok");
      await resolveVoiceText(text, true);
    } catch (error) {
      voiceSession = VoiceSessionCore.fail(voiceSession, `语音识别不可用：${error.message}`);
      renderVoiceSession(`${voiceSession.error}；可继续使用文本降级输入。`, "danger");
    }
  }

  async function startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      voiceSession = VoiceSessionCore.fail(VoiceSessionCore.createSession(), "当前浏览器不支持MediaRecorder");
      renderVoiceSession("请使用Chrome/Edge，或改用文本输入。", "danger");
      return;
    }
    if (voiceRecorder?.state === "recording") return;
    voiceSession = VoiceSessionCore.createSession();
    voiceSession = VoiceSessionCore.move(voiceSession, "permission-requested", {note: "等待浏览器麦克风授权。"});
    renderVoiceSession(voiceSession.note, "waiting");
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia(microphoneConstraints());
      const mimeType = preferredAudioType();
      voiceRecorder = new MediaRecorder(voiceStream, mimeType ? {mimeType} : undefined);
      voiceChunks = [];
      voiceRecorder.addEventListener("dataavailable", (event) => { if (event.data?.size) voiceChunks.push(event.data); });
      voiceRecorder.addEventListener("stop", async () => {
        clearTimeout(voiceStopTimer);
        const blob = new Blob(voiceChunks, {type: voiceRecorder?.mimeType || mimeType || "audio/webm"});
        voiceRecorder = null;
        voiceChunks = [];
        releaseVoiceStream();
        await transcribeVoiceBlob(blob);
      }, {once: true});
      voiceRecorder.start(200);
      voiceSession = VoiceSessionCore.move(voiceSession, "recording", {note: "请说出情境查询或白名单控制语句；约4秒后自动停止。"});
      renderVoiceSession(voiceSession.note, "waiting");
      voiceStopTimer = setTimeout(stopVoiceRecording, 4200);
    } catch (error) {
      releaseVoiceStream();
      voiceRecorder = null;
      const message = error.name === "NotAllowedError" ? "麦克风权限被拒绝，请在浏览器地址栏重新授权" : `无法开始录音：${error.name || error.message}`;
      voiceSession = VoiceSessionCore.fail(voiceSession, message);
      renderVoiceSession(`${message}；仍可使用文本输入。`, "danger");
    }
  }

  function stopVoiceRecording() {
    clearTimeout(voiceStopTimer);
    if (voiceRecorder?.state === "recording") voiceRecorder.stop();
  }

  async function testMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("voice-mic-status", "浏览器不支持麦克风", "danger");
      return;
    }
    let stream;
    let audioContext;
    try {
      setStatus("voice-mic-status", "自检中 · 请说话", "waiting");
      stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints());
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let peak = 0;
      const started = performance.now();
      await new Promise((resolve) => {
        const sample = () => {
          analyser.getByteTimeDomainData(samples);
          for (const value of samples) peak = Math.max(peak, Math.abs(value - 128));
          if (performance.now() - started < 1000) requestAnimationFrame(sample);
          else resolve();
        };
        sample();
      });
      setStatus("voice-mic-status", peak > 2 ? `自检通过 · 音量峰值${peak}` : "已连接但未检测到明显声音", peak > 2 ? "ok" : "waiting");
    } catch (error) {
      setStatus("voice-mic-status", error.name === "NotAllowedError" ? "麦克风权限被拒绝" : "麦克风自检失败", "danger");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      audioContext?.close().catch(() => {});
    }
  }

  $("serial-connect").addEventListener("click", connectSerial);
  $("serial-disconnect").addEventListener("click", () => disconnectSerial(true));
  $("registry-save").addEventListener("click", saveRegistry);
  $("voice-submit").addEventListener("click", () => runVoice($("voice-text").value));
  $("home-voice-submit").addEventListener("click", () => runVoice($("home-voice-fallback").value));
  $("voice-text").addEventListener("keydown", (event) => { if (event.key === "Enter") runVoice(event.currentTarget.value); });
  $("home-voice-fallback").addEventListener("keydown", (event) => { if (event.key === "Enter") runVoice(event.currentTarget.value); });
  for (const id of ["home-voice-start", "voice-mic-start"]) $(id).addEventListener("click", startVoiceRecording);
  for (const id of ["home-voice-stop", "voice-mic-stop"]) $(id).addEventListener("click", stopVoiceRecording);
  $("voice-mic-refresh").addEventListener("click", () => refreshMicrophones(false));
  $("voice-mic-permission").addEventListener("click", () => refreshMicrophones(true));
  $("voice-mic-test").addEventListener("click", testMicrophone);
  document.querySelectorAll("[data-voice-quick]").forEach((button) => button.addEventListener("click", () => {
    $("voice-text").value = button.dataset.voiceQuick;
    $("home-voice-fallback").value = button.dataset.voiceQuick;
    runVoice(button.dataset.voiceQuick);
  }));
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => sendCommand({mode: button.dataset.mode}, `切换到${button.textContent}`, null, "web")));
  document.querySelectorAll("[data-scenario]").forEach((button) => button.addEventListener("click", () => sendCommand({mockScenario: button.dataset.scenario}, `安全场景：${button.textContent}`, null, "web")));
  document.querySelectorAll("[data-actuator]").forEach((button) => button.addEventListener("click", () => {
    const actuator = button.dataset.actuator;
    const value = parseButtonValue(button.dataset.value);
    sendCommand({actuator: {[actuator]: value}}, `${button.closest("article").querySelector("header span").textContent} · ${button.textContent}`, null, "web");
  }));
  window.addEventListener("hashchange", () => activateWorkbench(window.location.hash.slice(1)));
  window.addEventListener("beforeunload", () => {
    clearTimeout(reconnectTimer);
    clearTimeout(voiceStopTimer);
    releaseVoiceStream();
    if (serialReader) serialReader.cancel().catch(() => {});
  });

  activateWorkbench(window.location.hash.slice(1));
  if (window.matchMedia("(max-width: 720px)").matches) $("secondary-sensor-details")?.removeAttribute("open");
  renderRegistry();
  renderVoiceSession("点击开始说话，或使用文本降级输入。", "muted");
  refreshMicrophones(false);
  updatePendingCount();
  refreshConnectionTruth();
  setInterval(updateAge, 500);
  connectWebSocket();
})();
