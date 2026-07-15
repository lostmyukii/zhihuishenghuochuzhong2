(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SerialCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROJECT_ID = "smartlife-junior-context";
  const BOARD_TYPES = new Set(["hello", "telemetry", "health", "ack"]);

  function acceptFrame(frame) {
    return Boolean(frame && frame.project === PROJECT_ID && BOARD_TYPES.has(frame.type));
  }

  class LineParser {
    constructor() { this.buffer = ""; }
    push(chunk) {
      this.buffer += String(chunk || "");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";
      const frames = [];
      lines.forEach((line) => {
        const value = line.trim();
        if (!value) return;
        const start = value.indexOf("{");
        const end = value.lastIndexOf("}");
        if (start < 0 || end < start) return;
        try {
          const frame = JSON.parse(value.slice(start, end + 1));
          if (acceptFrame(frame)) frames.push(frame);
        } catch (_error) {}
      });
      return frames;
    }
  }

  function encodeCommand(command) {
    if (!command || command.type !== "command" || command.project !== PROJECT_ID || !command.id) {
      throw new Error("command requires project, type and id");
    }
    return `${JSON.stringify(command)}\n`;
  }

  return {PROJECT_ID, LineParser, acceptFrame, encodeCommand};
});
