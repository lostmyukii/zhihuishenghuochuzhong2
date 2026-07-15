#pragma once

#include <Adafruit_NeoPixel.h>
#include <stdint.h>

#include "buzzer_pulse_controller.h"
#include "project_config.h"
#include "project_types.h"
#include "rgb_pulse_controller.h"

class ActuatorDriver {
 public:
  ActuatorApplyResult begin();
  ActuatorApplyResult begin(uint32_t nowMs);
  ActuatorApplyResult apply(const ActuatorTarget& target);
  ActuatorApplyResult apply(const ActuatorTarget& target, uint32_t nowMs);
  ActuatorApplyResult requestBuzzerPulse(uint32_t nowMs);
  ActuatorApplyResult stopBuzzer();
  ActuatorApplyResult requestRgbTestPulse(uint32_t nowMs);
  ActuatorApplyResult stopRgb();
  bool tick(uint32_t nowMs);
  ActuatorApplyResult result() const;

 private:
  BuzzerPulseController buzzerPulse_;
  RgbPulseController rgbPulse_;
  Adafruit_NeoPixel rgbPixels_{RGB_LED_COUNT, RGB_TEST_OUTPUT_PIN,
                              NEO_GRB + NEO_KHZ800};
  bool buzzerAvailable_ = false;
  bool rgbAvailable_ = false;
};

const char* actuatorApplyStateName(ActuatorApplyState state);
