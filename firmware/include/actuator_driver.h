#pragma once

#include <stdint.h>

#include "buzzer_pulse_controller.h"
#include "project_types.h"

class ActuatorDriver {
 public:
  ActuatorApplyResult begin();
  ActuatorApplyResult begin(uint32_t nowMs);
  ActuatorApplyResult apply(const ActuatorTarget& target);
  ActuatorApplyResult apply(const ActuatorTarget& target, uint32_t nowMs);
  ActuatorApplyResult requestBuzzerPulse(uint32_t nowMs);
  ActuatorApplyResult stopBuzzer();
  bool tick(uint32_t nowMs);
  ActuatorApplyResult result() const;

 private:
  BuzzerPulseController buzzerPulse_;
  bool buzzerAvailable_ = false;
};

const char* actuatorApplyStateName(ActuatorApplyState state);
