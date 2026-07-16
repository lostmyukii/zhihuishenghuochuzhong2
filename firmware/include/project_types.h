#pragma once

#include <stddef.h>
#include <stdint.h>

#include "project_config.h"


struct RuntimeThresholds {
  uint16_t lightThreshold = PROVISIONAL_LIGHT_BRIGHT_RAW;
  uint16_t soundThreshold = PROVISIONAL_SOUND_STUDY_MAX_RAW;
  float temperatureThreshold = PROVISIONAL_TEMPERATURE_HIGH_C;
  float humidityThreshold = PROVISIONAL_HUMIDITY_HIGH_PERCENT;
  uint16_t mq2Threshold = PROVISIONAL_MQ2_ALERT_RAW;
};

enum class ContextMode : uint8_t {
  Detect,
  Study,
  Rest,
  Ventilation,
  Energy,
  Custom,
};

enum class ContextStatus : uint8_t {
  Possible,
  Ambiguous,
  EvidenceMissing,
  Confirmed,
  Corrected,
  Unknown,
};

enum class SafetyState : uint8_t {
  Normal,
  Warming,
  Risk,
  SensorFault,
};

enum class SafetyCause : uint8_t {
  None,
  Flame,
  Mq2,
  Water,
  SafetySensorFault,
};

enum class ServoPosition : uint8_t {
  Hold,
  Study,
  Rest,
  VentilationOpen,
  Energy,
  SafetyClosed,
};

enum class BuzzerMode : uint8_t {
  Off,
  Alarm,
  Intermittent,
};

enum class RgbState : uint8_t {
  Off,
  Study,
  Orange,
  BlueLow,
  Cyan,
  Yellow,
  Red,
  Green,
  Blue,
  Purple,
  BlueRed,
  Gray,
};

enum class ActuatorApplyState : uint8_t {
  Unarmed,
  BootGuard,
  FullyArmed,
};

struct SensorSample {
  float value = 0.0F;
  bool valid = false;
  uint32_t updatedAtMs = 0;
};

struct SensorSnapshot {
  SensorSample light;
  SensorSample sound;
  SensorSample temperature;
  SensorSample humidity;
  SensorSample pir;
  SensorSample keypad;
  SensorSample mq2;
  SensorSample water;
  SensorSample flame;
  bool mq2WarmedUp = false;
  uint32_t mq2WarmupRemainingMs = 0;
  bool waterInputHigh = false;
  bool flameInputHigh = false;
  uint32_t capturedAtMs = 0;
};

constexpr size_t MAX_CONTEXT_EVIDENCE = 8;

struct EvidenceList {
  const char* items[MAX_CONTEXT_EVIDENCE] = {};
  uint8_t count = 0;

  void add(const char* code) {
    if (count < MAX_CONTEXT_EVIDENCE) {
      items[count++] = code;
    }
  }
};

struct ContextResult {
  ContextMode candidate = ContextMode::Detect;
  ContextStatus status = ContextStatus::Unknown;
  uint8_t coverage = 0;
  uint8_t match = 0;
  EvidenceList supporting;
  EvidenceList opposing;
  EvidenceList missing;
  bool confirmedByUser = false;
  bool correctedByUser = false;
};

constexpr size_t MAX_SAFETY_CAUSES = 4;

struct SafetyCauseList {
  SafetyCause items[MAX_SAFETY_CAUSES] = {};
  uint8_t count = 0;

  bool contains(SafetyCause cause) const {
    for (uint8_t index = 0; index < count; ++index) {
      if (items[index] == cause) {
        return true;
      }
    }
    return false;
  }

  void add(SafetyCause cause) {
    if (cause != SafetyCause::None && count < MAX_SAFETY_CAUSES && !contains(cause)) {
      items[count++] = cause;
    }
  }
};

struct ActuatorTarget {
  uint8_t fanPercent = 0;
  ServoPosition servoPosition = ServoPosition::Hold;
  bool relayOn = false;
  BuzzerMode buzzerMode = BuzzerMode::Off;
  RgbState rgbState = RgbState::Off;
};

struct ActuatorOverride {
  ActuatorTarget target;
  bool fan = false;
  bool servo = false;
  bool relay = false;
  bool buzzer = false;
  bool rgb = false;
};

struct SafetyResult {
  SafetyState state = SafetyState::Normal;
  SafetyCause primary = SafetyCause::None;
  SafetyCauseList causes;
  bool overrideActive = false;
  bool buzzerRequested = false;
  ActuatorOverride overrideTarget;
};

struct ActuatorPlan {
  ActuatorTarget normalTarget;
  ActuatorTarget finalTarget;
  SafetyResult safety;
  bool buzzerMuted = false;
};

struct ActuatorApplyResult {
  ActuatorApplyState state = ActuatorApplyState::Unarmed;
  bool ready = false;
  bool fanAvailable = false;
  uint8_t fanPercent = 0;
  bool servoAvailable = false;
  uint8_t servoAngle = 0;
  bool relayAvailable = false;
  bool relayOn = false;
  bool buzzerAvailable = false;
  bool buzzerOn = false;
  bool rgbAvailable = false;
  RgbState rgbState = RgbState::Off;
};
