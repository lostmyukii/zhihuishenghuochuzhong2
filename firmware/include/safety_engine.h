#pragma once

#include <stdint.h>

#include "project_types.h"

class SafetyEngine {
 public:
  SafetyResult update(const SensorSnapshot& sensors, uint32_t nowMs);
  SafetyResult update(const SensorSnapshot& sensors, uint32_t nowMs,
                      const RuntimeThresholds& thresholds);

 private:
  bool mq2Active_ = false;
  uint8_t mq2AlertSamples_ = 0;
  uint8_t mq2RecoverySamples_ = 0;
  bool waterActive_ = false;
  bool waterHeldByFault_ = false;
  uint8_t waterFaultRecoverySamples_ = 0;
  bool flameActive_ = false;
  bool flameHeldByFault_ = false;
  uint8_t flameFaultRecoverySamples_ = 0;
};

const char* safetyStateName(SafetyState state);
const char* safetyCauseName(SafetyCause cause);
