const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dashboard = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(dashboard, name), "utf8");

test("dashboard ships the integrated realtime artifact set", () => {
  for (const name of ["index.html", "style.css", "context-core.js", "serial-core.js", "registry-core.js", "voice-core.js", "voice-session-core.js", "alert-core.js", "dashboard-state-core.js", "presentation-core.js", "command-ledger-core.js", "cloud-core.js", "app.js"]) {
    assert.equal(fs.existsSync(path.join(dashboard, name)), true, `${name} is missing`);
  }
});

test("dashboard exposes all six modes and all four mock scenarios", () => {
  const html = read("index.html");
  for (const mode of ["detect", "study", "rest", "ventilation", "energy", "custom"]) {
    assert.match(html, new RegExp(`data-mode=["']${mode}["']`));
  }
  for (const scenario of ["normal", "mq2", "water", "flame"]) {
    assert.match(html, new RegExp(`data-scenario=["']${scenario}["']`));
  }
});

test("dashboard distinguishes mock, websocket, usb and mqtt truth", () => {
  const html = read("index.html");
  for (const copy of ["等待数据来源", "WebSocket", "USB", "MQTT", "等待实时数据"]) {
    assert.match(html, new RegExp(copy));
  }
  assert.doesNotMatch(html, /真板在线/);
});

test("dashboard exposes Web Serial, room map, registry, voice, actuator console and logs", () => {
  const html = read("index.html");
  const source = read("app.js");
  for (const id of ["serial-connect", "serial-disconnect", "house-map", "device-registry", "voice-console", "actuator-console", "event-log"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(source, /navigator\.serial\.requestPort/);
  assert.match(source, /SerialCore\.LineParser/);
  assert.match(source, /RegistryCore\.MODULES/);
  assert.match(source, /VoiceCore\.parseIntent/);
  assert.match(source, /AlertCore\.describeAlerts/);
});

test("dashboard uses the fixed project identity and six workbench routes", () => {
  const html = read("index.html");
  const source = read("app.js");
  assert.match(html, /N16R8 无摄像头家庭情境侦探屋/);
  for (const route of ["overview", "registry", "linkage", "voice", "debug", "logs"]) {
    assert.match(html, new RegExp(`data-workbench=["']${route}["']`));
    assert.match(html, new RegExp(`href=["']#${route}["']`));
  }
  for (const label of ["侦探总览", "设备注册", "情境联动", "网页语音", "调试台", "数据日志"]) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(html, /评分|得分|高分|功能[1-5]/);
  assert.match(source, /hashchange/);
  assert.match(source, /activateWorkbench/);
});

test("overview follows the five-step evidence chain and truthful presentation cores", () => {
  const html = read("index.html");
  const source = read("app.js");
  for (const id of ["evidence-rail", "primary-sensors", "secondary-sensors", "control-sources", "actuator-truth-table", "recent-events"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const step of ["collect", "reason", "control", "act", "record"]) {
    assert.match(html, new RegExp(`data-evidence-step=["']${step}["']`));
  }
  assert.match(source, /DashboardStateCore\.resolveState/);
  assert.match(source, /PresentationCore\.sensorSections/);
  assert.match(source, /PresentationCore\.actuatorRows/);
});

test("new pure modules load before the browser application", () => {
  const html = read("index.html");
  const stateAt = html.indexOf("dashboard-state-core.js");
  const presentationAt = html.indexOf("presentation-core.js");
  const voiceSessionAt = html.indexOf("voice-session-core.js");
  const cloudAt = html.indexOf("cloud-core.js");
  const appAt = html.indexOf("app.js");
  assert.ok(stateAt >= 0 && presentationAt >= 0 && voiceSessionAt >= 0 && cloudAt >= 0 && appAt >= 0);
  assert.ok(stateAt < appAt);
  assert.ok(presentationAt < appAt);
  assert.ok(voiceSessionAt < appAt);
  assert.ok(cloudAt < appAt);
});

test("public cloud bridge keeps WSS MQTT and board truth separate", () => {
  const html = read("index.html");
  const source = read("app.js");
  const cloud = read("cloud-core.js");
  assert.match(html, /独立 WSS \/ MQTT Relay/);
  assert.match(source, /CloudCore\.decorateBoardFrame/);
  assert.match(source, /CloudCore\.commandForSerial/);
  assert.match(source, /mqttConnected/);
  assert.match(cloud, /smartlife-context-ws/);
  assert.match(cloud, /originClientId/);
});

test("overview exposes a complete server voice loop and honest fallback", () => {
  const html = read("index.html");
  const source = read("app.js");
  for (const id of [
    "home-voice-card", "home-voice-start", "home-voice-stop", "home-voice-state",
    "home-voice-text", "home-voice-intent", "home-voice-command", "home-voice-fallback",
    "home-voice-submit",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /麦克风音频只在点击识别时发送到服务器，默认不保存/);
  assert.match(html, /GPIO4声音模块只测强度/);
  assert.match(html, /识别成功不等于设备执行成功/);
  assert.match(source, /MediaRecorder/);
  assert.match(source, /api\/voice\/transcribe/);
  assert.match(source, /api\/voice\/intent/);
  assert.match(source, /VoiceCore\.sanitizeServerIntent/);
  assert.match(source, /VoiceSessionCore/);
});

test("voice workbench keeps microphone selection, self-test and diagnostics", () => {
  const html = read("index.html");
  for (const id of [
    "voice-mic-select", "voice-mic-refresh", "voice-mic-permission", "voice-mic-test",
    "voice-mic-start", "voice-mic-stop", "voice-mic-status", "voice-text", "voice-submit", "voice-result",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("new voice controls require matching hello capabilities before sending", () => {
  const source = read("app.js");
  assert.match(source, /latestHello\?\.capabilities\?\.commands/);
  assert.match(source, /VoiceCore\.requiredCapability/);
  assert.match(source, /固件待升级/);
  assert.doesNotMatch(source, /\["confirmContext",\s*"correctContext",\s*"setThreshold"\]\.includes\(intent\.intent\)/);
});

test("browser bundle contains no provider or broker secrets", () => {
  const source = fs.readdirSync(dashboard)
    .filter((name) => name.endsWith(".js") || name.endsWith(".html"))
    .map(read)
    .join("\n");
  for (const marker of ["XFYUN_APPID", "XFYUN_API_KEY", "XFYUN_API_SECRET", "MQTT_PASSWORD", "APISecret"]) {
    assert.doesNotMatch(source, new RegExp(marker));
  }
});

test("client implements query endpoint, command ledger and stale clearing", () => {
  const source = read("app.js");
  const stateCore = read("dashboard-state-core.js");
  assert.match(source, /searchParams\.get\(["']ws["']\)/);
  assert.match(source, /COMMAND_TIMEOUT_MS\s*=\s*2500/);
  assert.match(source, /TELEMETRY_STALE_MS\s*=\s*3500/);
  assert.match(source, /CommandLedgerCore\.CommandLedger/);
  assert.match(source, /clearTelemetry/);
  assert.match(source, /等待实时数据/);
  assert.match(source, /telemetry\.mock\s*===\s*true/);
  assert.doesNotMatch(source, /telemetry\.mock\s*!==\s*true\)\s*return/);
  assert.match(source, /ContextCore\.evidenceLabel/);
  assert.match(stateCore, /真板遥测在线/);
  assert.match(stateCore, /未捕获启动身份/);
});

test("dashboard separates targets, applied values and hardware verification", () => {
  const html = read("index.html");
  const source = read("app.js");

  assert.match(html, /计划动作/);
  assert.match(html, /真实状态/);
  assert.match(html, /id=["']calibration-status["']/);
  assert.match(source, /telemetry\.actuatorTargets/);
  assert.match(source, /telemetry\.actuators/);
  assert.match(source, /PresentationCore\.actuatorRows/);
  assert.match(source, /启动保护/);
  assert.match(source, /Mock模拟执行/);
  assert.match(source, /calibration-status/);
  assert.doesNotMatch(html, /真板在线/);
});

test("stale clearing includes stage five actuation and calibration state", () => {
  const source = read("app.js");
  const clearBlock = source.split("function clearTelemetry", 2)[1];

  assert.match(clearBlock, /actuator-buzzer/);
  assert.match(clearBlock, /actuator-fan/);
  assert.match(clearBlock, /actuator-servo/);
  assert.match(clearBlock, /actuator-relay/);
  assert.match(clearBlock, /actuator-rgb/);
  assert.match(clearBlock, /safety-state/);
  assert.match(clearBlock, /calibration-status/);
  assert.match(clearBlock, /alert-banner/);
});
