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
RuntimeThresholds runtimeThresholds;

enum class ContextFeedbackKind : uint8_t { None, Confirmed, Corrected };

struct ContextFeedbackState {
  ContextFeedbackKind kind = ContextFeedbackKind::None;
  ContextMode mode = ContextMode::Detect;
};

ContextFeedbackState contextFeedback;
SensorSampler sensors;
ContextEngine contextEngine;
SafetyEngine safetyEngine;
ActuatorPlanner actuatorPlanner;
ActuatorDriver actuatorDriver;
ContextResult currentContext;
SafetyResult currentSafety;
ActuatorPlan currentPlan;
ActuatorApplyResult currentApply;
ActuatorOverride manualOverride;

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

ContextMode contextModeFromName(const char* mode) {
  if (mode != nullptr && strcmp(mode, "study") == 0) return ContextMode::Study;
  if (mode != nullptr && strcmp(mode, "rest") == 0) return ContextMode::Rest;
  if (mode != nullptr && strcmp(mode, "ventilation") == 0) {
    return ContextMode::Ventilation;
  }
  if (mode != nullptr && strcmp(mode, "energy") == 0) return ContextMode::Energy;
  if (mode != nullptr && strcmp(mode, "custom") == 0) return ContextMode::Custom;
  return ContextMode::Detect;
}

bool isAllowedServoPosition(const char* value) {
  return value != nullptr &&
         (strcmp(value, "hold") == 0 || strcmp(value, "study") == 0 ||
          strcmp(value, "rest") == 0 ||
          strcmp(value, "ventilation-open") == 0 ||
          strcmp(value, "energy") == 0 ||
          strcmp(value, "safety-closed") == 0);
}

bool isAllowedRgbState(const char* value) {
  return value != nullptr &&
         (strcmp(value, "off") == 0 || strcmp(value, "study") == 0 ||
          strcmp(value, "orange") == 0 || strcmp(value, "blue-low") == 0 ||
          strcmp(value, "cyan") == 0 || strcmp(value, "yellow") == 0 ||
          strcmp(value, "red") == 0 || strcmp(value, "green") == 0 ||
          strcmp(value, "blue") == 0 || strcmp(value, "purple") == 0 ||
          strcmp(value, "blue-red") == 0);
}

bool isAutoRequest(JsonVariantConst value) {
  if (!value.is<const char*>()) return false;
  const char* requested = value.as<const char*>();
  return requested != nullptr && strcmp(requested, "auto") == 0;
}

ServoPosition servoPositionFromName(const char* value) {
  if (strcmp(value, "study") == 0) return ServoPosition::Study;
  if (strcmp(value, "rest") == 0) return ServoPosition::Rest;
  if (strcmp(value, "ventilation-open") == 0) {
    return ServoPosition::VentilationOpen;
  }
  if (strcmp(value, "energy") == 0) return ServoPosition::Energy;
  if (strcmp(value, "safety-closed") == 0) {
    return ServoPosition::SafetyClosed;
  }
  return ServoPosition::Hold;
}

RgbState rgbStateFromName(const char* value) {
  if (strcmp(value, "study") == 0) return RgbState::Study;
  if (strcmp(value, "orange") == 0) return RgbState::Orange;
  if (strcmp(value, "blue-low") == 0) return RgbState::BlueLow;
  if (strcmp(value, "cyan") == 0) return RgbState::Cyan;
  if (strcmp(value, "yellow") == 0) return RgbState::Yellow;
  if (strcmp(value, "red") == 0) return RgbState::Red;
  if (strcmp(value, "green") == 0) return RgbState::Green;
  if (strcmp(value, "blue") == 0) return RgbState::Blue;
  if (strcmp(value, "purple") == 0) return RgbState::Purple;
  if (strcmp(value, "blue-red") == 0) return RgbState::BlueRed;
  return RgbState::Off;
}

ContextMode selectedContextMode() {
  return contextModeFromName(selectedMode.c_str());
}

const char* contextFeedbackName() {
  switch (contextFeedback.kind) {
    case ContextFeedbackKind::Confirmed:
      return "confirmed";
    case ContextFeedbackKind::Corrected:
      return "corrected";
    case ContextFeedbackKind::None:
    default:
      return "none";
  }
}

void clearContextFeedback() {
  contextFeedback = ContextFeedbackState{};
}

void applyContextFeedback() {
  currentContext.confirmedByUser = false;
  currentContext.correctedByUser = false;
  if (contextFeedback.kind == ContextFeedbackKind::Confirmed) {
    if (currentContext.candidate != contextFeedback.mode) {
      clearContextFeedback();
      return;
    }
    currentContext.status = ContextStatus::Confirmed;
    currentContext.confirmedByUser = true;
  } else if (contextFeedback.kind == ContextFeedbackKind::Corrected) {
    currentContext.candidate = contextFeedback.mode;
    currentContext.status = ContextStatus::Corrected;
    currentContext.correctedByUser = true;
  }
}

void addThresholds(JsonObject target) {
  target["lightThreshold"] = runtimeThresholds.lightThreshold;
  target["soundThreshold"] = runtimeThresholds.soundThreshold;
  target["temperatureThreshold"] = runtimeThresholds.temperatureThreshold;
  target["humidityThreshold"] = runtimeThresholds.humidityThreshold;
  target["mq2Threshold"] = runtimeThresholds.mq2Threshold;
}

void addStageHealth(JsonObject health) {
  health["stage"] = "stage5-integrated-realtime";
  health["sensorsReady"] = true;
  health["actuatorsArmed"] = ACTUATORS_ARMED;
  health["actuatorsReady"] = currentApply.ready;
  health["actuatorBootGuardMs"] = ACTUATOR_BOOT_GUARD_MS;
  health["actuatorBootGuardRemainingMs"] =
      actuatorDriver.bootGuardRemainingMs(millis());
  health["buzzerArmed"] = BUZZER_ARMED;
  health["fanArmed"] = FAN_ARMED;
  health["servoArmed"] = SERVO_ARMED;
  health["relayArmed"] = RELAY_ARMED;
  health["rgbArmed"] = RGB_ARMED;
  health["rgbTestOutputPin"] = RGB_TEST_OUTPUT_PIN;
  health["buzzerHardwareVerified"] = BUZZER_HARDWARE_VERIFIED;
  health["fanHardwareVerified"] = FAN_HARDWARE_VERIFIED;
  health["servoHardwareVerified"] = SERVO_HARDWARE_VERIFIED;
  health["relayHardwareVerified"] = RELAY_HARDWARE_VERIFIED;
  health["rgbHardwareVerified"] = RGB_HARDWARE_VERIFIED;
  health["actuatorApplyState"] = actuatorApplyStateName(currentApply.state);
  health["contextReady"] = true;
  health["safetyReady"] = true;
  health["hardwareVerified"] = false;
  health["calibrationRequired"] = true;
}

void applyManualOverrides(ActuatorTarget& target) {
  if (manualOverride.fan && !currentSafety.overrideTarget.fan) {
    target.fanPercent = manualOverride.target.fanPercent;
  }
  if (manualOverride.servo && !currentSafety.overrideTarget.servo) {
    target.servoPosition = manualOverride.target.servoPosition;
  }
  if (manualOverride.relay && !currentSafety.overrideTarget.relay) {
    target.relayOn = manualOverride.target.relayOn;
  }
  if (manualOverride.buzzer && !currentSafety.overrideTarget.buzzer) {
    target.buzzerMode = manualOverride.target.buzzerMode;
  }
  if (manualOverride.rgb && !currentSafety.overrideTarget.rgb) {
    target.rgbState = manualOverride.target.rgbState;
  }
}

void updateDecision(uint32_t nowMs) {
  const SensorSnapshot& snapshot = sensors.snapshot();
  if (snapshot.mq2.updatedAtMs != lastSafetySampleAt) {
    currentSafety = safetyEngine.update(snapshot, nowMs, runtimeThresholds);
    lastSafetySampleAt = snapshot.mq2.updatedAtMs;
  }
  currentContext =
      contextEngine.evaluate(snapshot, selectedContextMode(), runtimeThresholds);
  applyContextFeedback();
  currentPlan = actuatorPlanner.plan(selectedContextMode(), snapshot, currentContext,
                                     currentSafety, buzzerEnabled,
                                     runtimeThresholds);
  applyManualOverrides(currentPlan.finalTarget);
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
  features["physicalActuators"] = ACTUATORS_ARMED;
  features["physicalBuzzer"] = ACTUATORS_ARMED && BUZZER_ARMED;
  features["physicalFan"] = ACTUATORS_ARMED && FAN_ARMED;
  features["physicalServo"] = ACTUATORS_ARMED && SERVO_ARMED;
  features["physicalRelay"] = ACTUATORS_ARMED && RELAY_ARMED;
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
  commands.add("confirmContext");
  commands.add("correctContext");
  commands.add("setThreshold");
  JsonArray modes = capabilities["modes"].to<JsonArray>();
  modes.add("detect");
  modes.add("study");
  modes.add("rest");
  modes.add("ventilation");
  modes.add("energy");
  modes.add("custom");
  JsonArray thresholdFields = capabilities["thresholdFields"].to<JsonArray>();
  thresholdFields.add("lightThreshold");
  thresholdFields.add("soundThreshold");
  thresholdFields.add("temperatureThreshold");
  thresholdFields.add("humidityThreshold");
  thresholdFields.add("mq2Threshold");

  JsonObject health = root["health"].to<JsonObject>();
  addStageHealth(health);
  health["sensorSampling"] = "real-gpio-unverified";
  health["thresholdProfile"] = "runtime-unverified";
  health["thresholdPersistence"] = "ram-only";
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

  JsonObject thresholds = root["thresholds"].to<JsonObject>();
  addThresholds(thresholds);

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
  context["correctedByUser"] = currentContext.correctedByUser;
  context["feedback"] = contextFeedbackName();
  if (contextFeedback.kind == ContextFeedbackKind::None) {
    context["feedbackMode"] = nullptr;
  } else {
    context["feedbackMode"] = contextModeName(contextFeedback.mode);
  }
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
  actuators["fanPercent"] = currentApply.fanPercent;
  actuators["servoAngle"] = currentApply.servoAngle;
  actuators["relayOn"] = currentApply.relayOn;
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
  health["thresholdProfile"] = "runtime-unverified";
  health["thresholdPersistence"] = "ram-only";
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
  health["mq2AlertRaw"] = runtimeThresholds.mq2Threshold;
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
    applied["contextFeedback"] = contextFeedbackName();
    if (contextFeedback.kind == ContextFeedbackKind::None) {
      applied["feedbackMode"] = nullptr;
    } else {
      applied["feedbackMode"] = contextModeName(contextFeedback.mode);
    }
    JsonObject thresholds = applied["thresholds"].to<JsonObject>();
    addThresholds(thresholds);
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

void emitActuatorAck(const char* commandId, const char* actuatorName,
                     bool automatic) {
  JsonDocument document;
  JsonObject root = document.to<JsonObject>();
  root["type"] = "ack";
  root["project"] = PROJECT_ID;
  root["id"] = commandId;
  root["ok"] = true;
  JsonObject applied = root["applied"].to<JsonObject>();
  applied["manualOverride"] = automatic ? "auto" : actuatorName;
  applied["actuator"] = actuatorName;
  applied["fanPercent"] = currentApply.fanPercent;
  applied["servoAngle"] = currentApply.servoAngle;
  applied["relayOn"] = currentApply.relayOn;
  applied["buzzerOn"] = currentApply.buzzerOn;
  applied["rgbState"] = rgbStateName(currentApply.rgbState);
  applied["safetyOverride"] = currentSafety.overrideActive;
  writeJsonLine(document);
}

bool validSteppedThreshold(JsonVariantConst value, int minimum, int maximum,
                           int step) {
  if (!value.is<int>()) return false;
  const int requested = value.as<int>();
  return requested >= minimum && requested <= maximum &&
         (requested - minimum) % step == 0;
}

bool applyThresholdSetting(JsonObjectConst settings) {
  if (settings.size() != 1) return false;
  if (!settings["lightThreshold"].isNull()) {
    if (!validSteppedThreshold(settings["lightThreshold"], 0, 4095, 100)) {
      return false;
    }
    runtimeThresholds.lightThreshold =
        settings["lightThreshold"].as<uint16_t>();
    return true;
  }
  if (!settings["soundThreshold"].isNull()) {
    if (!validSteppedThreshold(settings["soundThreshold"], 0, 4095, 50)) {
      return false;
    }
    runtimeThresholds.soundThreshold =
        settings["soundThreshold"].as<uint16_t>();
    return true;
  }
  if (!settings["temperatureThreshold"].isNull()) {
    if (!validSteppedThreshold(settings["temperatureThreshold"], 10, 45, 1)) {
      return false;
    }
    runtimeThresholds.temperatureThreshold =
        settings["temperatureThreshold"].as<float>();
    return true;
  }
  if (!settings["humidityThreshold"].isNull()) {
    if (!validSteppedThreshold(settings["humidityThreshold"], 20, 95, 5)) {
      return false;
    }
    runtimeThresholds.humidityThreshold =
        settings["humidityThreshold"].as<float>();
    return true;
  }
  if (!settings["mq2Threshold"].isNull()) {
    if (!validSteppedThreshold(settings["mq2Threshold"], 0, 2600, 50)) {
      return false;
    }
    runtimeThresholds.mq2Threshold =
        settings["mq2Threshold"].as<uint16_t>();
    lastSafetySampleAt = UINT32_MAX;
    return true;
  }
  return false;
}

bool validActuatorCommand(JsonObjectConst actuator) {
  if (actuator.size() != 1) {
    return false;
  }
  if (!actuator["fan"].isNull()) {
    if (isAutoRequest(actuator["fan"])) return true;
    if (!actuator["fan"].is<int>()) return false;
    const int value = actuator["fan"].as<int>();
    return value >= 0 && value <= 100;
  }
  if (!actuator["servo"].isNull()) {
    if (isAutoRequest(actuator["servo"])) return true;
    return isAllowedServoPosition(actuator["servo"].as<const char*>());
  }
  if (!actuator["relay"].isNull()) {
    return actuator["relay"].is<bool>() || isAutoRequest(actuator["relay"]);
  }
  if (!actuator["buzzer"].isNull()) {
    return actuator["buzzer"].is<bool>() || isAutoRequest(actuator["buzzer"]);
  }
  if (!actuator["rgb"].isNull()) {
    if (isAutoRequest(actuator["rgb"])) return true;
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
  const bool hasContextConfirm = !command["contextConfirm"].isNull();
  const bool hasContextCorrect = !command["contextCorrect"].isNull();
  const uint8_t operationCount = static_cast<uint8_t>(hasMode) +
                                 static_cast<uint8_t>(hasSet) +
                                 static_cast<uint8_t>(hasActuator) +
                                 static_cast<uint8_t>(hasContextConfirm) +
                                 static_cast<uint8_t>(hasContextCorrect);
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
    clearContextFeedback();
    decisionDirty = true;
    emitAck(commandId, true);
    return;
  }

  if (hasSet) {
    JsonObjectConst settings = command["set"].as<JsonObjectConst>();
    if (settings.size() != 1) {
      emitAck(commandId, false, "invalid_threshold");
      return;
    }
    if (!command["set"]["buzzerEnabled"].isNull()) {
      if (!command["set"]["buzzerEnabled"].is<bool>()) {
        emitAck(commandId, false, "unsupported_command");
        return;
      }
      const bool requested = command["set"]["buzzerEnabled"].as<bool>();
      buzzerEnabled = requested;
      decisionDirty = true;
      emitAck(commandId, true);
      return;
    }
    if (!applyThresholdSetting(settings)) {
      emitAck(commandId, false, "invalid_threshold");
      return;
    }
    decisionDirty = true;
    const uint32_t nowMs = millis();
    updateDecision(nowMs);
    emitAck(commandId, true);
    emitTelemetry();
    lastTelemetryAt = nowMs;
    return;
  }

  if (hasContextConfirm) {
    if (!command["contextConfirm"].is<JsonObjectConst>()) {
      emitAck(commandId, false, "invalid_context_confirmation");
      return;
    }
    JsonObjectConst confirmation = command["contextConfirm"].as<JsonObjectConst>();
    const char* candidate = confirmation["candidate"].as<const char*>();
    if (confirmation.size() != 2 || !isAllowedMode(candidate) ||
        !confirmation["correct"].is<bool>() ||
        !confirmation["correct"].as<bool>()) {
      emitAck(commandId, false, "invalid_context_confirmation");
      return;
    }
    const uint32_t nowMs = millis();
    if (decisionDirty) updateDecision(nowMs);
    const ContextMode requestedCandidate = contextModeFromName(candidate);
    if (currentContext.candidate != requestedCandidate) {
      emitAck(commandId, false, "candidate_mismatch");
      return;
    }
    contextFeedback.kind = ContextFeedbackKind::Confirmed;
    contextFeedback.mode = requestedCandidate;
    decisionDirty = true;
    updateDecision(nowMs);
    emitAck(commandId, true);
    emitTelemetry();
    lastTelemetryAt = nowMs;
    return;
  }

  if (hasContextCorrect) {
    if (!command["contextCorrect"].is<JsonObjectConst>()) {
      emitAck(commandId, false, "invalid_context_correction");
      return;
    }
    JsonObjectConst correction = command["contextCorrect"].as<JsonObjectConst>();
    const char* correctedMode = correction["mode"].as<const char*>();
    if (correction.size() != 1 || !isAllowedMode(correctedMode)) {
      emitAck(commandId, false, "invalid_context_correction");
      return;
    }
    contextFeedback.kind = ContextFeedbackKind::Corrected;
    contextFeedback.mode = contextModeFromName(correctedMode);
    decisionDirty = true;
    const uint32_t nowMs = millis();
    updateDecision(nowMs);
    emitAck(commandId, true);
    emitTelemetry();
    lastTelemetryAt = nowMs;
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
  if (!currentApply.ready) {
    emitAck(commandId, false, "actuators_boot_guard");
    return;
  }
  const uint32_t nowMs = millis();
  if (!actuator["fan"].isNull()) {
    const bool automatic = isAutoRequest(actuator["fan"]);
    manualOverride.fan = !automatic;
    if (!automatic) {
      manualOverride.target.fanPercent = actuator["fan"].as<uint8_t>();
    }
    decisionDirty = true;
    updateDecision(nowMs);
    emitActuatorAck(commandId, "fan", automatic);
    emitTelemetry();
    lastTelemetryAt = nowMs;
    return;
  }
  if (!actuator["servo"].isNull()) {
    const bool automatic = isAutoRequest(actuator["servo"]);
    manualOverride.servo = !automatic;
    if (!automatic) {
      manualOverride.target.servoPosition =
          servoPositionFromName(actuator["servo"].as<const char*>());
    }
    decisionDirty = true;
    updateDecision(nowMs);
    emitActuatorAck(commandId, "servo", automatic);
    emitTelemetry();
    lastTelemetryAt = nowMs;
    return;
  }
  if (!actuator["relay"].isNull()) {
    const bool automatic = isAutoRequest(actuator["relay"]);
    manualOverride.relay = !automatic;
    if (!automatic) {
      manualOverride.target.relayOn = actuator["relay"].as<bool>();
    }
    decisionDirty = true;
    updateDecision(nowMs);
    emitActuatorAck(commandId, "relay", automatic);
    emitTelemetry();
    lastTelemetryAt = nowMs;
    return;
  }
  if (!actuator["buzzer"].isNull()) {
    if (!BUZZER_ARMED) {
      emitAck(commandId, false, "actuators_unarmed");
      return;
    }
    const bool automatic = isAutoRequest(actuator["buzzer"]);
    if (automatic) {
      manualOverride.buzzer = false;
      decisionDirty = true;
      updateDecision(nowMs);
      emitActuatorAck(commandId, "buzzer", true);
      emitTelemetry();
      lastTelemetryAt = nowMs;
      return;
    }
    const bool pulseRequested = actuator["buzzer"].as<bool>();
    if (pulseRequested) {
      currentApply = actuatorDriver.requestBuzzerPulse(nowMs);
    } else {
      currentApply = actuatorDriver.stopBuzzer();
      manualOverride.buzzer = true;
      manualOverride.target.buzzerMode = BuzzerMode::Off;
      decisionDirty = true;
      updateDecision(nowMs);
    }
    emitBuzzerAck(commandId, pulseRequested);
    emitTelemetry();
    lastTelemetryAt = nowMs;
    return;
  }
  if (!actuator["rgb"].isNull()) {
    if (!RGB_ARMED) {
      emitAck(commandId, false, "actuators_unarmed");
      return;
    }
    const bool automatic = isAutoRequest(actuator["rgb"]);
    manualOverride.rgb = !automatic;
    if (!automatic) {
      manualOverride.target.rgbState =
          rgbStateFromName(actuator["rgb"].as<const char*>());
    }
    decisionDirty = true;
    updateDecision(nowMs);
    emitActuatorAck(commandId, "rgb", automatic);
    emitTelemetry();
    lastTelemetryAt = nowMs;
    return;
  }
  emitAck(commandId, false, "invalid_actuator_command");
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
    decisionDirty = true;
    updateDecision(now);
    emitTelemetry();
    lastTelemetryAt = now;
  }
  if (now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = now;
    emitTelemetry();
  }
}
