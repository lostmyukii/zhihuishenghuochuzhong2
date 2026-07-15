#include <Arduino.h>
#include <ArduinoJson.h>

#include "actuator_driver.h"
#include "actuator_planner.h"
#include "context_engine.h"
#include "project_config.h"
#include "project_types.h"
#include "safety_engine.h"
#include "sensors.h"

namespace {

String selectedMode = "detect";
String serialLine;
bool buzzerEnabled = true;
bool decisionDirty = true;
uint32_t lastTelemetryAt = 0;
uint32_t lastSafetySampleAt = UINT32_MAX;
SensorSampler sensors;
ContextEngine contextEngine;
SafetyEngine safetyEngine;
ActuatorPlanner actuatorPlanner;
ActuatorDriver actuatorDriver;
ContextResult currentContext;
SafetyResult currentSafety;
ActuatorPlan currentPlan;
ActuatorApplyResult currentApply;

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

bool isAllowedServoPosition(const char* value) {
  return value != nullptr &&
         (strcmp(value, "study") == 0 || strcmp(value, "rest") == 0 ||
          strcmp(value, "ventilation-open") == 0 ||
          strcmp(value, "energy") == 0 ||
          strcmp(value, "safety-closed") == 0);
}

bool isAllowedRgbState(const char* value) {
  return value != nullptr &&
         (strcmp(value, "off") == 0 || strcmp(value, "study") == 0 ||
          strcmp(value, "orange") == 0 || strcmp(value, "blue-low") == 0 ||
          strcmp(value, "cyan") == 0 || strcmp(value, "red") == 0 ||
          strcmp(value, "blue-red") == 0);
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
  health["stage"] = "stage4-rgb-hardware-validation";
  health["sensorsReady"] = true;
  health["actuatorsArmed"] = ACTUATORS_ARMED;
  health["actuatorsReady"] = false;
  health["buzzerArmed"] = BUZZER_ARMED;
  health["fanArmed"] = FAN_ARMED;
  health["servoArmed"] = SERVO_ARMED;
  health["relayArmed"] = RELAY_ARMED;
  health["rgbArmed"] = RGB_ARMED;
  health["buzzerHardwareVerified"] = BUZZER_HARDWARE_VERIFIED;
  health["rgbHardwareVerified"] = RGB_HARDWARE_VERIFIED;
  health["actuatorApplyState"] = actuatorApplyStateName(currentApply.state);
  health["contextReady"] = true;
  health["safetyReady"] = true;
  health["hardwareVerified"] = false;
  health["calibrationRequired"] = true;
}

void updateDecision(uint32_t nowMs) {
  const SensorSnapshot& snapshot = sensors.snapshot();
  if (snapshot.mq2.updatedAtMs != lastSafetySampleAt) {
    currentSafety = safetyEngine.update(snapshot, nowMs);
    lastSafetySampleAt = snapshot.mq2.updatedAtMs;
  }
  currentContext = contextEngine.evaluate(snapshot, selectedContextMode());
  currentPlan = actuatorPlanner.plan(selectedContextMode(), snapshot, currentContext,
                                     currentSafety, buzzerEnabled);
  currentApply = actuatorDriver.apply(currentPlan.finalTarget, nowMs);
  decisionDirty = false;
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
  features["safetyReasoning"] = true;
  features["actuatorPlanning"] = true;
  features["physicalActuators"] = false;
  features["physicalBuzzer"] = ACTUATORS_ARMED && BUZZER_ARMED;
  features["physicalRgb"] = ACTUATORS_ARMED && RGB_ARMED;
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
  commands.add("setBuzzerEnabled");
  commands.add("setActuator");
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
  health["buzzerEnabled"] = buzzerEnabled;

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

void addSafetyCauses(JsonArray array, const SafetyCauseList& causes,
                     bool includeFault) {
  for (uint8_t index = 0; index < causes.count; ++index) {
    if (!includeFault && causes.items[index] == SafetyCause::SafetySensorFault) {
      continue;
    }
    array.add(safetyCauseName(causes.items[index]));
  }
}

void emitTelemetry() {
  const uint32_t nowMs = millis();
  if (decisionDirty) {
    updateDecision(nowMs);
  }
  const SensorSnapshot& snapshot = sensors.snapshot();

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
  context["candidate"] = contextModeName(currentContext.candidate);
  context["coverage"] = currentContext.coverage;
  context["match"] = currentContext.match;
  context["status"] = contextStatusName(currentContext.status);
  context["confirmedByUser"] = currentContext.confirmedByUser;
  JsonArray supporting = context["supporting"].to<JsonArray>();
  JsonArray opposing = context["opposing"].to<JsonArray>();
  JsonArray missing = context["missing"].to<JsonArray>();
  addEvidence(supporting, currentContext.supporting);
  addEvidence(opposing, currentContext.opposing);
  addEvidence(missing, currentContext.missing);

  JsonObject targets = root["actuatorTargets"].to<JsonObject>();
  targets["fanPercent"] = currentPlan.finalTarget.fanPercent;
  targets["servoPosition"] =
      servoPositionName(currentPlan.finalTarget.servoPosition);
  targets["relayOn"] = currentPlan.finalTarget.relayOn;
  targets["buzzerMode"] = buzzerModeName(currentPlan.finalTarget.buzzerMode);
  targets["rgbState"] = rgbStateName(currentPlan.finalTarget.rgbState);

  JsonObject actuators = root["actuators"].to<JsonObject>();
  actuators["fanPercent"] = nullptr;
  actuators["servoAngle"] = nullptr;
  actuators["relayOn"] = nullptr;
  if (currentApply.buzzerAvailable) {
    actuators["buzzerOn"] = currentApply.buzzerOn;
  } else {
    actuators["buzzerOn"] = nullptr;
  }
  if (currentApply.rgbAvailable) {
    actuators["rgbState"] = rgbStateName(currentApply.rgbState);
  } else {
    actuators["rgbState"] = nullptr;
  }

  JsonArray alerts = root["alerts"].to<JsonArray>();
  addSafetyCauses(alerts, currentSafety.causes, false);

  JsonObject safety = root["safety"].to<JsonObject>();
  safety["state"] = safetyStateName(currentSafety.state);
  safety["primary"] = safetyCauseName(currentSafety.primary);
  JsonArray causes = safety["causes"].to<JsonArray>();
  addSafetyCauses(causes, currentSafety.causes, true);
  safety["overrideActive"] = currentSafety.overrideActive;
  safety["buzzerRequested"] = currentSafety.buzzerRequested;
  safety["buzzerMuted"] = currentPlan.buzzerMuted;

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
  health["buzzerEnabled"] = buzzerEnabled;
  health["actuatorApplyState"] = actuatorApplyStateName(currentApply.state);

  writeJsonLine(document);
}

void emitAck(const char* commandId, bool ok, const char* error = nullptr) {
  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "ack";
  root["project"] = PROJECT_ID;
  if (commandId == nullptr) {
    root["id"] = nullptr;
  } else {
    root["id"] = commandId;
  }
  root["ok"] = ok;
  if (ok) {
    JsonObject applied = root["applied"].to<JsonObject>();
    applied["mode"] = selectedMode;
    applied["buzzerEnabled"] = buzzerEnabled;
  } else {
    root["error"] = error == nullptr ? "unsupported_command" : error;
  }
  writeJsonLine(document);
}

void emitBuzzerAck(const char* commandId, bool pulseStarted) {
  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "ack";
  root["project"] = PROJECT_ID;
  root["id"] = commandId;
  root["ok"] = true;
  JsonObject applied = root["applied"].to<JsonObject>();
  applied["buzzerOn"] = currentApply.buzzerOn;
  if (pulseStarted) {
    applied["buzzerPulseMs"] = BUZZER_TEST_PULSE_MS;
  }
  writeJsonLine(document);
}

void emitRgbAck(const char* commandId, bool pulseStarted) {
  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "ack";
  root["project"] = PROJECT_ID;
  root["id"] = commandId;
  root["ok"] = true;
  JsonObject applied = root["applied"].to<JsonObject>();
  applied["rgbState"] = rgbStateName(currentApply.rgbState);
  if (pulseStarted) {
    applied["rgbPulseMs"] = RGB_TEST_PULSE_MS;
    applied["rgbBrightness"] = RGB_TEST_BRIGHTNESS;
    applied["rgbPixels"] = RGB_LED_COUNT;
  }
  writeJsonLine(document);
}

bool validActuatorCommand(JsonObjectConst actuator) {
  if (actuator.size() != 1) {
    return false;
  }
  if (!actuator["fan"].isNull()) {
    if (!actuator["fan"].is<int>()) return false;
    const int value = actuator["fan"].as<int>();
    return value >= 0 && value <= 100;
  }
  if (!actuator["servo"].isNull()) {
    return isAllowedServoPosition(actuator["servo"].as<const char*>());
  }
  if (!actuator["relay"].isNull()) {
    return actuator["relay"].is<bool>();
  }
  if (!actuator["buzzer"].isNull()) {
    return actuator["buzzer"].is<bool>();
  }
  if (!actuator["rgb"].isNull()) {
    return isAllowedRgbState(actuator["rgb"].as<const char*>());
  }
  return false;
}

void handleCommandLine(const String& line) {
  JsonDocument command;
  DeserializationError parseError = deserializeJson(command, line);
  if (parseError) {
    emitAck(nullptr, false, "invalid_json");
    return;
  }

  const char* commandId = command["id"].as<const char*>();
  if (commandId == nullptr || commandId[0] == '\0') {
    emitAck(nullptr, false, "missing_id");
    return;
  }

  const char* type = command["type"] | "";
  if (strcmp(type, "command") != 0) {
    emitAck(commandId, false, "unsupported_type");
    return;
  }

  const bool hasMode = !command["mode"].isNull();
  const bool hasSet = command["set"].is<JsonObjectConst>();
  const bool hasActuator = command["actuator"].is<JsonObjectConst>();
  const uint8_t operationCount = static_cast<uint8_t>(hasMode) +
                                 static_cast<uint8_t>(hasSet) +
                                 static_cast<uint8_t>(hasActuator);
  if (operationCount != 1) {
    emitAck(commandId, false, "unsupported_command");
    return;
  }

  if (hasMode) {
    const char* requestedMode = command["mode"].as<const char*>();
    if (!isAllowedMode(requestedMode)) {
      emitAck(commandId, false, "unsupported_mode");
      return;
    }
    selectedMode = requestedMode;
    decisionDirty = true;
    emitAck(commandId, true);
    return;
  }

  if (hasSet) {
    JsonObjectConst settings = command["set"].as<JsonObjectConst>();
    if (settings.size() != 1 ||
        !command["set"]["buzzerEnabled"].is<bool>()) {
      emitAck(commandId, false, "unsupported_command");
      return;
    }
    const bool requested = command["set"]["buzzerEnabled"].as<bool>();
    buzzerEnabled = requested;
    decisionDirty = true;
    emitAck(commandId, true);
    return;
  }

  JsonObjectConst actuator = command["actuator"].as<JsonObjectConst>();
  if (!validActuatorCommand(actuator)) {
    emitAck(commandId, false, "invalid_actuator_command");
    return;
  }
  if (!ACTUATORS_ARMED) {
    emitAck(commandId, false, "actuators_unarmed");
    return;
  }
  if (!actuator["buzzer"].isNull()) {
    if (!BUZZER_ARMED) {
      emitAck(commandId, false, "actuators_unarmed");
      return;
    }
    const bool pulseRequested = actuator["buzzer"].as<bool>();
    if (pulseRequested) {
      currentApply = actuatorDriver.requestBuzzerPulse(millis());
    } else {
      currentApply = actuatorDriver.stopBuzzer();
    }
    emitBuzzerAck(commandId, pulseRequested);
    emitTelemetry();
    lastTelemetryAt = millis();
    return;
  }
  if (!actuator["rgb"].isNull()) {
    if (!RGB_ARMED) {
      emitAck(commandId, false, "actuators_unarmed");
      return;
    }
    const char* requestedState = actuator["rgb"].as<const char*>();
    const bool pulseRequested = strcmp(requestedState, "cyan") == 0;
    if (pulseRequested) {
      currentApply = actuatorDriver.requestRgbTestPulse(millis());
    } else if (strcmp(requestedState, "off") == 0) {
      currentApply = actuatorDriver.stopRgb();
    } else {
      emitAck(commandId, false, "rgb_test_state_only");
      return;
    }
    emitRgbAck(commandId, pulseRequested);
    emitTelemetry();
    lastTelemetryAt = millis();
    return;
  }
  emitAck(commandId, false, "actuators_unarmed");
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
      emitAck(nullptr, false, "line_too_long");
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
  currentApply = actuatorDriver.begin(now);
  sensors.begin(now);
  sensors.poll(now);
  updateDecision(now);
  emitHello();
  emitTelemetry();
  lastTelemetryAt = now;
}

void loop() {
  pollSerial();
  const uint32_t now = millis();
  sensors.poll(now);
  if (sensors.snapshot().mq2.updatedAtMs != lastSafetySampleAt || decisionDirty) {
    updateDecision(now);
  }
  if (actuatorDriver.tick(now)) {
    currentApply = actuatorDriver.result();
    emitTelemetry();
    lastTelemetryAt = now;
  }
  if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = now;
    emitTelemetry();
  }
}
