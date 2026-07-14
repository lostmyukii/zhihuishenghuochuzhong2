#include "actuator_driver.h"

#include "project_config.h"

ActuatorApplyResult ActuatorDriver::begin() {
  ActuatorApplyResult result;
  if (!ACTUATORS_ARMED) {
    result.state = ActuatorApplyState::Unarmed;
    return result;
  }

  result.state = ActuatorApplyState::Unarmed;
  return result;
}

ActuatorApplyResult ActuatorDriver::apply(const ActuatorTarget&) {
  ActuatorApplyResult result;
  if (!ACTUATORS_ARMED) {
    result.state = ActuatorApplyState::Unarmed;
    return result;
  }

  result.state = ActuatorApplyState::Unarmed;
  return result;
}

const char* actuatorApplyStateName(ActuatorApplyState state) {
  switch (state) {
    case ActuatorApplyState::Unarmed:
    default:
      return "unarmed";
  }
}
