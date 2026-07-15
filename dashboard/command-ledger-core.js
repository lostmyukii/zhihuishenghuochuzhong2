(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CommandLedgerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  class CommandLedger {
    constructor(options = {}) {
      this.timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 2500;
      this.maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 40;
      this.items = [];
    }

    start(command, metadata = {}) {
      if (!command || typeof command.id !== "string" || !command.id.trim()) throw new Error("command id is required");
      if (this.findMutable(command.id)) throw new Error(`duplicate command id: ${command.id}`);
      const sentAt = Number.isFinite(metadata.sentAt) ? metadata.sentAt : Date.now();
      const entry = {
        id: command.id,
        source: metadata.source || "web",
        description: metadata.description || "标准命令",
        route: metadata.route || "unknown",
        sentAt,
        deadlineAt: sentAt + this.timeoutMs,
        status: "pending",
        ackAt: null,
        ok: null,
        error: null,
        applied: null,
        observedActualAt: null,
        hardwareVerified: false,
      };
      this.items.unshift(entry);
      if (this.items.length > this.maxEntries) this.items.length = this.maxEntries;
      return clone(entry);
    }

    receiveAck(ack, at = Date.now()) {
      const entry = ack && typeof ack.id === "string" ? this.findMutable(ack.id) : null;
      if (!entry || entry.status !== "pending") return {matched: false, entry: null};
      entry.ackAt = at;
      entry.ok = ack.ok === true;
      entry.error = entry.ok ? null : ack.error || "unknown_error";
      entry.applied = clone(ack.applied || null);
      entry.status = entry.ok ? "ack-ok" : "ack-error";
      return {matched: true, entry: clone(entry)};
    }

    expire(now = Date.now()) {
      const expired = [];
      for (const entry of this.items) {
        if (entry.status === "pending" && now >= entry.deadlineAt) {
          entry.status = "timeout";
          entry.error = "ack_timeout";
          expired.push(clone(entry));
        }
      }
      return expired;
    }

    cancelPending(reason, at = Date.now()) {
      const cancelled = [];
      for (const entry of this.items) {
        if (entry.status === "pending") {
          entry.status = "cancelled";
          entry.ackAt = at;
          entry.error = reason || "transport_disconnected";
          cancelled.push(clone(entry));
        }
      }
      return cancelled.reverse();
    }

    markObservedActual(id, at = Date.now()) {
      const entry = this.findMutable(id);
      if (!entry || (entry.status !== "ack-ok" && entry.status !== "observed")) return null;
      entry.status = "observed";
      entry.observedActualAt = at;
      return clone(entry);
    }

    pendingCount() {
      return this.items.filter((entry) => entry.status === "pending").length;
    }

    find(id) {
      return clone(this.findMutable(id) || null);
    }

    entries() {
      return clone(this.items);
    }

    findMutable(id) {
      return this.items.find((entry) => entry.id === id);
    }
  }

  return {CommandLedger};
});
