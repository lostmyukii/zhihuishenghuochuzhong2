#include <cassert>
#include <cstdint>

#include "project_config.h"
#include "rgb_pulse_controller.h"

int main() {
  RgbPulseController controller;
  assert(!controller.isOn());

  controller.requestPulse(1000U);
  assert(controller.isOn());
  assert(!controller.tick(1000U + RGB_TEST_PULSE_MS - 1U));
  assert(controller.isOn());
  assert(controller.tick(1000U + RGB_TEST_PULSE_MS));
  assert(!controller.isOn());

  controller.requestPulse(2000U);
  controller.requestPulse(2100U);
  assert(!controller.tick(2100U + RGB_TEST_PULSE_MS - 1U));
  assert(controller.isOn());
  assert(controller.tick(2100U + RGB_TEST_PULSE_MS));
  assert(!controller.isOn());

  controller.requestPulse(3000U);
  controller.stop();
  assert(!controller.isOn());
  assert(!controller.tick(4000U));

  constexpr uint32_t nearWrap = UINT32_MAX - 49U;
  controller.requestPulse(nearWrap);
  assert(!controller.tick(nearWrap + RGB_TEST_PULSE_MS - 1U));
  assert(controller.isOn());
  assert(controller.tick(nearWrap + RGB_TEST_PULSE_MS));
  assert(!controller.isOn());

  return 0;
}
