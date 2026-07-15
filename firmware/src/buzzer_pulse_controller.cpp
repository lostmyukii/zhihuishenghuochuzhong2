#include "buzzer_pulse_controller.h"

#include "project_config.h"

void BuzzerPulseController::requestPulse(uint32_t nowMs) {
  startedAtMs_ = nowMs;
  on_ = true;
}

void BuzzerPulseController::stop() {
  on_ = false;
}

bool BuzzerPulseController::tick(uint32_t nowMs) {
  if (!on_ || nowMs - startedAtMs_ < BUZZER_TEST_PULSE_MS) {
    return false;
  }
  on_ = false;
  return true;
}

bool BuzzerPulseController::isOn() const {
  return on_;
}
