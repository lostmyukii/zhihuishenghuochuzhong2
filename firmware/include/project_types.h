#pragma once

#include <stddef.h>
#include <stdint.h>


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
  BlueRed,
  Gray,
};

enum class ActuatorApplyState : uint8_t {
  Unarmed,
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
};
