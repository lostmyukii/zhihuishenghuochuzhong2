#include <Arduino.h>
#include <ArduinoJson.h>

#include "project_config.h"

namespace {

String selectedMode = "detect";
String serialLine;
uint32_t lastTelemetryAt = 0;

void writeJsonLine(JsonDocument& document) {
  serializeJson(document, Serial);
  Serial.println();
}

bool isAllowedMode(const char* mode) {
  return mode != nullptr &&
         (strcmp(mode, "detect") == 0 || strcmp(mode, "study") == 0 ||
          strcmp(mode, "rest") == 0 || strcmp(mode, "ventilation") == 0 ||
          strcmp(mode, "energy") == 0 || strcmp(mode, "custom") == 0);
}

void emitHello() {
  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "hello";
  root["project"] = PROJECT_ID;
  root["profileId"] = PROFILE_ID;
  root["board"] = BOARD_ID;
  root["deviceName"] = DEVICE_NAME;
  root["firmware"] = FIRMWARE_VERSION;
  root["baud"] = SERIAL_BAUD;
  root["rfid"] = false;

  JsonObject features = root["features"].to<JsonObject>();
  features["contextReasoning"] = true;
  features["webVoiceIntent"] = true;
  features["localVoiceNlu"] = false;
  features["mcp"] = false;

  JsonObject pins = root["pins"].to<JsonObject>();
  pins["light"] = PIN_LIGHT;
  pins["sound"] = PIN_SOUND;
  pins["dht"] = PIN_DHT;
  pins["pir"] = PIN_PIR;
  pins["keypad"] = PIN_KEYPAD_ADC;
  pins["mq2"] = PIN_MQ2;
  pins["water"] = PIN_WATER;
  pins["flame"] = PIN_FLAME;
  pins["buzzer"] = PIN_BUZZER;
  pins["fan"] = PIN_FAN;
  pins["servo"] = PIN_SERVO;
  pins["relay"] = PIN_RELAY;
  pins["rgb"] = PIN_RGB;

  JsonObject capabilities = root["capabilities"].to<JsonObject>();
  JsonArray commands = capabilities["commands"].to<JsonArray>();
  commands.add("setMode");
  JsonArray modes = capabilities["modes"].to<JsonArray>();
  modes.add("detect");
  modes.add("study");
  modes.add("rest");
  modes.add("ventilation");
  modes.add("energy");
  modes.add("custom");

  JsonObject health = root["health"].to<JsonObject>();
  health["stage"] = "protocol-skeleton";
  health["sensorsReady"] = false;
  health["actuatorsReady"] = false;
  health["contextReady"] = false;
  health["safetyReady"] = false;

  writeJsonLine(document);
}

void emitTelemetry() {
  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "telemetry";
  root["project"] = PROJECT_ID;
  root["profileId"] = PROFILE_ID;
  root["firmware"] = FIRMWARE_VERSION;
  root["uptimeMs"] = millis();
  root["mode"] = selectedMode;

  root["sensors"].to<JsonObject>();
  root["actuators"].to<JsonObject>();
  root["alerts"].to<JsonArray>();

  JsonObject context = root["context"].to<JsonObject>();
  context["status"] = "unknown";
  context["reason"] = "protocol-skeleton-no-sensor-sampling";

  JsonObject health = root["health"].to<JsonObject>();
  health["stage"] = "protocol-skeleton";
  health["sensorsReady"] = false;
  health["actuatorsReady"] = false;
  health["contextReady"] = false;
  health["safetyReady"] = false;

  writeJsonLine(document);
}

void emitAck(const char* commandId, bool ok, const char* error = nullptr) {
  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "ack";
  root["id"] = commandId;
  root["ok"] = ok;
  if (ok) {
    JsonObject applied = root["applied"].to<JsonObject>();
    applied["mode"] = selectedMode;
  } else {
    root["error"] = error == nullptr ? "unsupported_command" : error;
  }
  writeJsonLine(document);
}

void handleCommandLine(const String& line) {
  JsonDocument command;
  DeserializationError parseError = deserializeJson(command, line);
  if (parseError) {
    emitAck("", false, "invalid_json");
    return;
  }

  const char* commandId = command["id"] | "";
  if (commandId[0] == '\0') {
    emitAck("", false, "missing_id");
    return;
  }

  const char* type = command["type"] | "";
  if (strcmp(type, "command") != 0) {
    emitAck(commandId, false, "unsupported_type");
    return;
  }

  const char* requestedMode = command["mode"] | nullptr;
  if (requestedMode != nullptr) {
    if (!isAllowedMode(requestedMode)) {
      emitAck(commandId, false, "unsupported_mode");
      return;
    }
    selectedMode = requestedMode;
    emitAck(commandId, true);
    return;
  }

  emitAck(commandId, false, "unsupported_command");
}

void pollSerial() {
  while (Serial.available() > 0) {
    const char value = static_cast<char>(Serial.read());
    if (value == '\r') {
      continue;
    }
    if (value == '\n') {
      if (!serialLine.isEmpty()) {
        handleCommandLine(serialLine);
        serialLine = "";
      }
      continue;
    }
    if (serialLine.length() >= SERIAL_LINE_MAX_BYTES) {
      serialLine = "";
      emitAck("", false, "line_too_long");
      continue;
    }
    serialLine += value;
  }
}

}  // namespace

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(50);
  serialLine.reserve(SERIAL_LINE_MAX_BYTES);
  emitHello();
  emitTelemetry();
  lastTelemetryAt = millis();
}

void loop() {
  pollSerial();
  const uint32_t now = millis();
  if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = now;
    emitTelemetry();
  }
}
