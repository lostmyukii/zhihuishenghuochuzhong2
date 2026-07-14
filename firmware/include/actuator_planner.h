#pragma once

#include "project_types.h"

class ActuatorPlanner {
 public:
  ActuatorTarget normalTarget(ContextMode mode, const SensorSnapshot& sensors,
                              const ContextResult& context) const;
  ActuatorPlan plan(ContextMode mode, const SensorSnapshot& sensors,
                    const ContextResult& context, const SafetyResult& safety,
                    bool buzzerEnabled) const;
};

const char* servoPositionName(ServoPosition position);
const char* buzzerModeName(BuzzerMode mode);
const char* rgbStateName(RgbState state);
