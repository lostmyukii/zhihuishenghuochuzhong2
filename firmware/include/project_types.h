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
