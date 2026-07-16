const test = require("node:test");
const assert = require("node:assert/strict");
const CloudCore = require("../cloud-core.js");

test("public HTTPS defaults to the isolated WSS path", () => {
  assert.equal(
    CloudCore.defaultEndpoint({protocol: "https:", host: "context.example", hostname: "context.example"}),
    "wss://context.example/smartlife-context-ws",
  );
  assert.equal(
    CloudCore.defaultEndpoint({protocol: "http:", host: "127.0.0.1:18767", hostname: "127.0.0.1"}),
    "ws://127.0.0.1:18766",
  );
  assert.equal(
    CloudCore.defaultEndpoint({protocol: "https:", host: "context.example", hostname: "context.example"}, "wss://override/ws"),
    "wss://override/ws",
  );
});

test("isolated relay path enables cloud framing over local or public WebSocket", () => {
  assert.equal(CloudCore.isPublicEndpoint("wss://context.example/smartlife-context-ws"), true);
  assert.equal(CloudCore.isPublicEndpoint("ws://127.0.0.1:19466/smartlife-context-ws"), true);
  assert.equal(CloudCore.isPublicEndpoint("ws://127.0.0.1:19466"), false);
});

test("serial board frames receive identity and one browser origin id", () => {
  const decorated = CloudCore.decorateBoardFrame({
    type: "ack",
    project: CloudCore.PROJECT_ID,
    id: "board-ack-1",
    ok: true,
  }, "usb-client-1");
  assert.equal(decorated.profileId, CloudCore.PROFILE_ID);
  assert.equal(decorated.origin, "web-serial-gateway");
  assert.equal(decorated.source, "browser-usb");
  assert.equal(decorated.originClientId, "usb-client-1");
  assert.equal(CloudCore.decorateBoardFrame({...decorated, project: "foreign"}, "usb-client-1"), null);
});

test("incoming cloud frames reject self loops and foreign identities", () => {
  const frame = {
    type: "telemetry",
    project: CloudCore.PROJECT_ID,
    profileId: CloudCore.PROFILE_ID,
    originClientId: "usb-client-1",
  };
  assert.equal(CloudCore.classifyIncoming(frame, "usb-client-1"), "ignore");
  assert.equal(CloudCore.classifyIncoming({...frame, originClientId: "usb-client-2"}, "usb-client-1"), "board");
  assert.equal(CloudCore.classifyIncoming({...frame, project: "foreign"}, "usb-client-1"), "ignore");
});

test("remote commands preserve id but remove transport metadata before serial", () => {
  const remote = CloudCore.decorateClientCommand({
    type: "command",
    project: CloudCore.PROJECT_ID,
    id: "remote-1",
    mode: "rest",
  }, "remote-browser");
  assert.equal(remote.profileId, CloudCore.PROFILE_ID);
  assert.equal(remote.originClientId, "remote-browser");
  assert.equal(CloudCore.classifyIncoming(remote, "usb-browser"), "command");
  assert.deepEqual(CloudCore.commandForSerial({...remote, relayedAt: 123}), {
    type: "command",
    project: CloudCore.PROJECT_ID,
    id: "remote-1",
    mode: "rest",
  });
});

test("relay status is separate from board truth", () => {
  const status = {
    type: "relayStatus",
    project: CloudCore.PROJECT_ID,
    profileId: CloudCore.PROFILE_ID,
    mqttConnected: true,
  };
  assert.equal(CloudCore.classifyIncoming(status, "client-1"), "relay-status");
});
