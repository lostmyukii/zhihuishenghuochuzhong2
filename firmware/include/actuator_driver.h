#pragma once

#include "project_types.h"

class ActuatorDriver {
 public:
  ActuatorApplyResult begin();
  ActuatorApplyResult apply(const ActuatorTarget& target);
};

const char* actuatorApplyStateName(ActuatorApplyState state);
