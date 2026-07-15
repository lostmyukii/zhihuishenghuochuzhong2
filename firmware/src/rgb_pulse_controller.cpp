#include "rgb_pulse_controller.h"

#include "project_config.h"

void RgbPulseController::requestPulse(uint32_t nowMs) {
  startedAtMs_ = nowMs;
  on_ = true;
}

void RgbPulseController::stop() {
  on_ = false;
}

bool RgbPulseController::tick(uint32_t nowMs) {
  if (!on_ || nowMs - startedAtMs_ < RGB_TEST_PULSE_MS) {
    return false;
  }
  on_ = false;
  return true;
}

bool RgbPulseController::isOn() const {
  return on_;
}
