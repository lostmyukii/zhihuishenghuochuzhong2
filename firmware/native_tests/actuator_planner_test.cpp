#include <cassert>
#include <cstring>

#include "actuator_planner.h"

namespace {

SensorSample sample(float value, bool valid = true) {
  return SensorSample{value, valid, 1000};
}

SensorSnapshot comfortableRoom() {
  SensorSnapshot snapshot{};
  snapshot.light = sample(2200);
  snapshot.sound = sample(1000);
  snapshot.temperature = sample(24);
  snapshot.humidity = sample(50);
  snapshot.pir = sample(1);
  return snapshot;
}

SafetyResult noRisk() {
  return SafetyResult{};
}

SafetyResult waterRisk() {
  SafetyResult result;
  result.state = SafetyState::Risk;
  result.primary = SafetyCause::Water;
  result.causes.add(SafetyCause::Water);
  result.overrideActive = true;
  result.buzzerRequested = true;
  result.overrideTarget.relay = true;
  result.overrideTarget.buzzer = true;
  result.overrideTarget.rgb = true;
  result.overrideTarget.target.relayOn = false;
  result.overrideTarget.target.buzzerMode = BuzzerMode::Intermittent;
  result.overrideTarget.target.rgbState = RgbState::BlueRed;
  return result;
}

SafetyResult mq2Risk() {
  SafetyResult result;
  result.state = SafetyState::Risk;
  result.primary = SafetyCause::Mq2;
  result.causes.add(SafetyCause::Mq2);
  result.overrideActive = true;
  result.buzzerRequested = true;
  result.overrideTarget.fan = true;
  result.overrideTarget.servo = true;
  result.overrideTarget.relay = true;
  result.overrideTarget.buzzer = true;
  result.overrideTarget.rgb = true;
  result.overrideTarget.target.fanPercent = 100;
  result.overrideTarget.target.servoPosition = ServoPosition::VentilationOpen;
  result.overrideTarget.target.relayOn = false;
  result.overrideTarget.target.buzzerMode = BuzzerMode::Alarm;
  result.overrideTarget.target.rgbState = RgbState::Red;
  return result;
}

SafetyResult flameOverMq2() {
  SafetyResult result = mq2Risk();
  result.primary = SafetyCause::Flame;
  result.causes = SafetyCauseList{};
  result.causes.add(SafetyCause::Flame);
  result.causes.add(SafetyCause::Mq2);
  result.overrideTarget.target.fanPercent = 0;
  result.overrideTarget.target.servoPosition = ServoPosition::SafetyClosed;
  return result;
}

SafetyResult sensorFault() {
  SafetyResult result;
  result.state = SafetyState::SensorFault;
  result.primary = SafetyCause::SafetySensorFault;
  result.causes.add(SafetyCause::SafetySensorFault);
  result.overrideActive = true;
  result.overrideTarget.fan = true;
  result.overrideTarget.servo = true;
  result.overrideTarget.relay = true;
  result.overrideTarget.buzzer = true;
  result.overrideTarget.rgb = true;
  result.overrideTarget.target.rgbState = RgbState::Gray;
  return result;
}

}  // namespace

int main() {
  ActuatorPlanner planner;
  ContextResult context;
  SensorSnapshot room = comfortableRoom();

  ActuatorPlan detect =
      planner.plan(ContextMode::Detect, room, context, noRisk(), true);
  assert(detect.finalTarget.fanPercent == 0);
  assert(detect.finalTarget.servoPosition == ServoPosition::Hold);
  assert(!detect.finalTarget.relayOn);
  assert(detect.finalTarget.buzzerMode == BuzzerMode::Off);
  assert(detect.finalTarget.rgbState == RgbState::Off);

  SensorSnapshot studyRoom = room;
  studyRoom.light = sample(1200);
  studyRoom.sound = sample(2500);
  ActuatorPlan study =
      planner.plan(ContextMode::Study, studyRoom, context, noRisk(), true);
  assert(study.finalTarget.relayOn);
  assert(study.finalTarget.rgbState == RgbState::Orange);
  assert(study.finalTarget.servoPosition == ServoPosition::Study);

  studyRoom.temperature = sample(29);
  ActuatorPlan hotStudy =
      planner.plan(ContextMode::Study, studyRoom, context, noRisk(), true);
  assert(hotStudy.finalTarget.fanPercent == 35);
  assert(hotStudy.finalTarget.servoPosition == ServoPosition::VentilationOpen);

  RuntimeThresholds stricterThresholds;
  stricterThresholds.temperatureThreshold = 31;
  ActuatorPlan thresholdStudy = planner.plan(ContextMode::Study, studyRoom, context,
                                               noRisk(), true, stricterThresholds);
  assert(thresholdStudy.finalTarget.fanPercent == 0);
  assert(thresholdStudy.finalTarget.servoPosition == ServoPosition::Study);

  SensorSnapshot restRoom = room;
  restRoom.humidity = sample(72);
  ActuatorPlan rest =
      planner.plan(ContextMode::Rest, restRoom, context, noRisk(), true);
  assert(rest.finalTarget.fanPercent == 35);
  assert(rest.finalTarget.servoPosition == ServoPosition::Rest);
  assert(rest.finalTarget.rgbState == RgbState::BlueLow);
  assert(!rest.finalTarget.relayOn);

  ActuatorPlan ventilation = planner.plan(ContextMode::Ventilation, room, context,
                                           noRisk(), true);
  assert(ventilation.finalTarget.fanPercent == 35);
  assert(ventilation.finalTarget.servoPosition == ServoPosition::VentilationOpen);
  assert(ventilation.finalTarget.rgbState == RgbState::Cyan);
  room.temperature = sample(30);
  ActuatorPlan hotVentilation = planner.plan(ContextMode::Ventilation, room, context,
                                              noRisk(), true);
  assert(hotVentilation.finalTarget.fanPercent == 70);

  room.temperature.valid = false;
  room.humidity.valid = false;
  ActuatorPlan missingDht = planner.plan(ContextMode::Ventilation, room, context,
                                         noRisk(), true);
  assert(missingDht.finalTarget.fanPercent == 0);
  assert(missingDht.finalTarget.servoPosition == ServoPosition::Hold);
  assert(missingDht.finalTarget.rgbState == RgbState::Gray);

  ActuatorPlan energy =
      planner.plan(ContextMode::Energy, room, context, noRisk(), true);
  assert(energy.finalTarget.fanPercent == 0);
  assert(energy.finalTarget.servoPosition == ServoPosition::Energy);
  assert(energy.finalTarget.rgbState == RgbState::Off);

  ActuatorPlan custom =
      planner.plan(ContextMode::Custom, room, context, noRisk(), true);
  assert(custom.finalTarget.fanPercent == 0);
  assert(custom.finalTarget.servoPosition == ServoPosition::Hold);

  SensorSnapshot hotRoom = comfortableRoom();
  hotRoom.temperature = sample(30);
  ActuatorPlan water = planner.plan(ContextMode::Ventilation, hotRoom, context,
                                     waterRisk(), true);
  assert(water.finalTarget.fanPercent == 70);
  assert(water.finalTarget.servoPosition == ServoPosition::VentilationOpen);
  assert(!water.finalTarget.relayOn);
  assert(water.finalTarget.rgbState == RgbState::BlueRed);
  assert(water.finalTarget.buzzerMode == BuzzerMode::Intermittent);

  ActuatorPlan mq2 =
      planner.plan(ContextMode::Rest, room, context, mq2Risk(), true);
  assert(mq2.finalTarget.fanPercent == 100);
  assert(mq2.finalTarget.servoPosition == ServoPosition::VentilationOpen);
  assert(!mq2.finalTarget.relayOn);
  assert(mq2.finalTarget.rgbState == RgbState::Red);

  ActuatorPlan flame =
      planner.plan(ContextMode::Rest, room, context, flameOverMq2(), true);
  assert(flame.finalTarget.fanPercent == 0);
  assert(flame.finalTarget.servoPosition == ServoPosition::SafetyClosed);
  assert(flame.finalTarget.rgbState == RgbState::Red);

  ActuatorPlan muted =
      planner.plan(ContextMode::Rest, room, context, flameOverMq2(), false);
  assert(muted.finalTarget.buzzerMode == BuzzerMode::Off);
  assert(muted.buzzerMuted);
  assert(muted.finalTarget.servoPosition == ServoPosition::SafetyClosed);
  assert(muted.safety.causes.contains(SafetyCause::Flame));

  ActuatorPlan fault =
      planner.plan(ContextMode::Study, studyRoom, context, sensorFault(), true);
  assert(fault.finalTarget.fanPercent == 0);
  assert(fault.finalTarget.servoPosition == ServoPosition::Hold);
  assert(!fault.finalTarget.relayOn);
  assert(fault.finalTarget.rgbState == RgbState::Gray);

  assert(std::strcmp(servoPositionName(ServoPosition::SafetyClosed),
                     "safety-closed") == 0);
  assert(std::strcmp(buzzerModeName(BuzzerMode::Intermittent),
                     "intermittent") == 0);
  assert(std::strcmp(rgbStateName(RgbState::BlueRed), "blue-red") == 0);

  return 0;
}
