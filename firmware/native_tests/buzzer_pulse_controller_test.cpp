#include <cassert>
#include <cstdint>

#include "buzzer_pulse_controller.h"
#include "project_config.h"

int main() {
  BuzzerPulseController controller;
  assert(!controller.isOn());

  controller.requestPulse(1000U);
  assert(controller.isOn());
  assert(!controller.tick(1000U + BUZZER_TEST_PULSE_MS - 1U));
  assert(controller.isOn());
  assert(controller.tick(1000U + BUZZER_TEST_PULSE_MS));
  assert(!controller.isOn());

  controller.requestPulse(2000U);
  controller.requestPulse(2100U);
  assert(!controller.tick(2100U + BUZZER_TEST_PULSE_MS - 1U));
  assert(controller.isOn());
  assert(controller.tick(2100U + BUZZER_TEST_PULSE_MS));
  assert(!controller.isOn());

  controller.requestPulse(3000U);
  controller.stop();
  assert(!controller.isOn());
  assert(!controller.tick(4000U));

  constexpr uint32_t nearWrap = UINT32_MAX - 49U;
  controller.requestPulse(nearWrap);
  assert(!controller.tick(nearWrap + BUZZER_TEST_PULSE_MS - 1U));
  assert(controller.isOn());
  assert(controller.tick(nearWrap + BUZZER_TEST_PULSE_MS));
  assert(!controller.isOn());

  return 0;
}
