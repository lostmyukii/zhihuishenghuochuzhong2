#include <Arduino.h>
#include <ArduinoJson.h>

#include "context_engine.h"
#include "project_config.h"
#include "project_types.h"
#include "sensors.h"

namespace {

String selectedMode = "detect";
String serialLine;
uint32_t lastTelemetryAt = 0;
SensorSampler sensors;
ContextEngine contextEngine;

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

ContextMode selectedContextMode() {
  if (selectedMode == "study") return ContextMode::Study;
  if (selectedMode == "rest") return ContextMode::Rest;
  if (selectedMode == "ventilation") return ContextMode::Ventilation;
  if (selectedMode == "energy") return ContextMode::Energy;
  if (selectedMode == "custom") return ContextMode::Custom;
  return ContextMode::Detect;
}

void addStageHealth(JsonObject health) {
  health["stage"] = "stage3-sensors-context";
  health["sensorsReady"] = true;
  health["actuatorsReady"] = false;
  health["contextReady"] = true;
  health["safetyReady"] = false;
  health["hardwareVerified"] = false;
  health["calibrationRequired"] = true;
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
  addStageHealth(health);
  health["sensorSampling"] = "real-gpio-unverified";
  health["thresholdProfile"] = "provisional-unverified";
  health["mq2Divider"] = "required-if-powered-at-5v";

  writeJsonLine(document);
}

void setNullableSample(JsonObject target, const char* key,
                       const SensorSample& sample) {
  if (sample.valid) {
    target[key] = sample.value;
  } else {
    target[key] = nullptr;
  }
}

void setAge(JsonObject target, const char* key, const SensorSample& sample,
            uint32_t nowMs) {
  if (sample.updatedAtMs == 0) {
    target[key] = nullptr;
  } else {
    target[key] = nowMs - sample.updatedAtMs;
  }
}

void addEvidence(JsonArray array, const EvidenceList& evidence) {
  for (uint8_t index = 0; index < evidence.count; ++index) {
    array.add(evidence.items[index]);
  }
}

void emitTelemetry() {
  const uint32_t nowMs = millis();
  const SensorSnapshot& snapshot = sensors.snapshot();
  const ContextResult result =
      contextEngine.evaluate(snapshot, selectedContextMode());

  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "telemetry";
  root["project"] = PROJECT_ID;
  root["profileId"] = PROFILE_ID;
  root["firmware"] = FIRMWARE_VERSION;
  root["uptimeMs"] = nowMs;
  root["mode"] = selectedMode;

  JsonObject sensorValues = root["sensors"].to<JsonObject>();
  sensorValues["light"] = static_cast<uint16_t>(snapshot.light.value);
  sensorValues["sound"] = static_cast<uint16_t>(snapshot.sound.value);
  setNullableSample(sensorValues, "temperature", snapshot.temperature);
  setNullableSample(sensorValues, "humidity", snapshot.humidity);
  sensorValues["pir"] = snapshot.pir.value >= 0.5F;
  sensorValues["keypad"] = static_cast<uint16_t>(snapshot.keypad.value);
  sensorValues["mq2"] = static_cast<uint16_t>(snapshot.mq2.value);
  sensorValues["water"] = snapshot.water.value >= 0.5F;
  sensorValues["flame"] = snapshot.flame.value >= 0.5F;

  JsonObject validity = root["sensorValid"].to<JsonObject>();
  validity["light"] = snapshot.light.valid;
  validity["sound"] = snapshot.sound.valid;
  validity["temperature"] = snapshot.temperature.valid;
  validity["humidity"] = snapshot.humidity.valid;
  validity["pir"] = snapshot.pir.valid;
  validity["keypad"] = snapshot.keypad.valid;
  validity["mq2"] = snapshot.mq2.valid;
  validity["water"] = snapshot.water.valid;
  validity["flame"] = snapshot.flame.valid;

  JsonObject ages = root["sensorAgeMs"].to<JsonObject>();
  setAge(ages, "light", snapshot.light, nowMs);
  setAge(ages, "sound", snapshot.sound, nowMs);
  setAge(ages, "temperature", snapshot.temperature, nowMs);
  setAge(ages, "humidity", snapshot.humidity, nowMs);
  setAge(ages, "pir", snapshot.pir, nowMs);
  setAge(ages, "keypad", snapshot.keypad, nowMs);
  setAge(ages, "mq2", snapshot.mq2, nowMs);
  setAge(ages, "water", snapshot.water, nowMs);
  setAge(ages, "flame", snapshot.flame, nowMs);

  JsonObject context = root["context"].to<JsonObject>();
  context["candidate"] = contextModeName(result.candidate);
  context["coverage"] = result.coverage;
  context["match"] = result.match;
  context["status"] = contextStatusName(result.status);
  context["confirmedByUser"] = result.confirmedByUser;
  JsonArray supporting = context["supporting"].to<JsonArray>();
  JsonArray opposing = context["opposing"].to<JsonArray>();
  JsonArray missing = context["missing"].to<JsonArray>();
  addEvidence(supporting, result.supporting);
  addEvidence(opposing, result.opposing);
  addEvidence(missing, result.missing);

  root["actuators"].to<JsonObject>();
  root["alerts"].to<JsonArray>();

  JsonObject health = root["health"].to<JsonObject>();
  addStageHealth(health);
  health["sensorSampling"] = "real-gpio-unverified";
  health["thresholdProfile"] = "provisional-unverified";
  health["dht"] = snapshot.temperature.valid
                      ? "ok"
                      : (sensors.dhtEverValid() ? "stale" : "missing");
  if (sensors.dhtEverValid()) {
    health["dhtAgeMs"] = nowMs - sensors.lastDhtSuccessAt();
  } else {
    health["dhtAgeMs"] = nullptr;
  }
  health["mq2State"] = snapshot.mq2WarmedUp ? "ready-unverified" : "warming";
  health["mq2WarmupRemainingMs"] = snapshot.mq2WarmupRemainingMs;
  health["mq2Divider"] = "required-if-powered-at-5v";
  health["waterInputLevel"] = snapshot.waterInputHigh ? "high" : "low";
  health["waterTriggerLevel"] = "high-unverified";
  health["flameInputLevel"] = snapshot.flameInputHigh ? "high" : "low";
  health["flameTriggerLevel"] = "high-unverified";
  health["keypadMapping"] = "unconfigured-stage5";

  writeJsonLine(document);
}

void emitAck(const char* commandId, bool ok, const char* error = nullptr) {
  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "ack";
  root["project"] = PROJECT_ID;
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

  const char* requestedMode = command["mode"].as<const char*>();
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
  const uint32_t now = millis();
  sensors.begin(now);
  sensors.poll(now);
  emitHello();
  emitTelemetry();
  lastTelemetryAt = now;
}

void loop() {
  pollSerial();
  const uint32_t now = millis();
  sensors.poll(now);
  if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = now;
    emitTelemetry();
  }
}
