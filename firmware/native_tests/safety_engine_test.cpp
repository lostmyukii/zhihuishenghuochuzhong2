#include <cassert>
#include <cstring>

#include "safety_engine.h"

namespace {

SensorSample sample(float value, uint32_t updatedAtMs = 1000, bool valid = true) {
  return SensorSample{value, valid, updatedAtMs};
}

SensorSnapshot safeSnapshot(uint32_t nowMs, bool warmedUp = true) {
  SensorSnapshot snapshot{};
  snapshot.mq2 = sample(1200, nowMs);
  snapshot.water = sample(0, nowMs);
  snapshot.flame = sample(0, nowMs);
  snapshot.mq2WarmedUp = warmedUp;
  snapshot.capturedAtMs = nowMs;
  return snapshot;
}

bool hasCause(const SafetyResult& result, SafetyCause cause) {
  return result.causes.contains(cause);
}

}  // namespace

int main() {
  constexpr uint32_t now = 5000;

  SafetyEngine warmingEngine;
  SensorSnapshot warmingSnapshot = safeSnapshot(now, false);
  SafetyResult warming = warmingEngine.update(warmingSnapshot, now);
  assert(warming.state == SafetyState::Warming);
  assert(warming.causes.count == 0);
  assert(warming.overrideTarget.rgb);
  assert(warming.overrideTarget.target.rgbState == RgbState::Yellow);

  SafetyEngine mq2Engine;
  SensorSnapshot mq2 = safeSnapshot(now);
  mq2.mq2.value = 2700;
  assert(!hasCause(mq2Engine.update(mq2, now), SafetyCause::Mq2));
  mq2.mq2.updatedAtMs = now + 200;
  assert(!hasCause(mq2Engine.update(mq2, now + 200), SafetyCause::Mq2));
  mq2.mq2.updatedAtMs = now + 400;
  SafetyResult mq2Alarm = mq2Engine.update(mq2, now + 400);
  assert(hasCause(mq2Alarm, SafetyCause::Mq2));
  assert(mq2Alarm.primary == SafetyCause::Mq2);
  assert(mq2Alarm.overrideTarget.target.fanPercent == 100);
  assert(mq2Alarm.overrideTarget.target.servoPosition == ServoPosition::VentilationOpen);

  RuntimeThresholds sensitiveThresholds;
  sensitiveThresholds.mq2Threshold = 2000;
  SafetyEngine runtimeThresholdEngine;
  SensorSnapshot runtimeMq2 = safeSnapshot(now);
  runtimeMq2.mq2.value = 2100;
  assert(!hasCause(runtimeThresholdEngine.update(runtimeMq2, now, sensitiveThresholds), SafetyCause::Mq2));
  runtimeMq2.mq2.updatedAtMs = now + 200;
  assert(!hasCause(runtimeThresholdEngine.update(runtimeMq2, now + 200, sensitiveThresholds), SafetyCause::Mq2));
  runtimeMq2.mq2.updatedAtMs = now + 400;
  assert(hasCause(runtimeThresholdEngine.update(runtimeMq2, now + 400, sensitiveThresholds), SafetyCause::Mq2));

  mq2.mq2.value = 2500;
  mq2.mq2.updatedAtMs = now + 600;
  assert(hasCause(mq2Engine.update(mq2, now + 600), SafetyCause::Mq2));
  mq2.mq2.value = 2300;
  mq2.mq2.updatedAtMs = now + 800;
  assert(hasCause(mq2Engine.update(mq2, now + 800), SafetyCause::Mq2));
  mq2.mq2.updatedAtMs = now + 1000;
  assert(hasCause(mq2Engine.update(mq2, now + 1000), SafetyCause::Mq2));
  mq2.mq2.updatedAtMs = now + 1200;
  assert(!hasCause(mq2Engine.update(mq2, now + 1200), SafetyCause::Mq2));

  SafetyEngine waterEngine;
  SensorSnapshot water = safeSnapshot(now);
  water.water.value = 1;
  SafetyResult waterAlarm = waterEngine.update(water, now);
  assert(hasCause(waterAlarm, SafetyCause::Water));
  assert(!waterAlarm.overrideTarget.fan);
  assert(!waterAlarm.overrideTarget.servo);
  assert(waterAlarm.overrideTarget.relay);
  assert(waterAlarm.overrideTarget.target.rgbState == RgbState::BlueRed);
  assert(waterAlarm.overrideTarget.target.buzzerMode == BuzzerMode::Intermittent);

  SafetyEngine combinedEngine;
  SensorSnapshot combined = safeSnapshot(now);
  combined.mq2.value = 2800;
  combined.flame.value = 1;
  combined.water.value = 1;
  combinedEngine.update(combined, now);
  combined.mq2.updatedAtMs = now + 200;
  combined.water.updatedAtMs = now + 200;
  combined.flame.updatedAtMs = now + 200;
  combinedEngine.update(combined, now + 200);
  combined.mq2.updatedAtMs = now + 400;
  combined.water.updatedAtMs = now + 400;
  combined.flame.updatedAtMs = now + 400;
  SafetyResult combinedAlarm = combinedEngine.update(combined, now + 400);
  assert(combinedAlarm.causes.count == 3);
  assert(combinedAlarm.causes.items[0] == SafetyCause::Flame);
  assert(combinedAlarm.causes.items[1] == SafetyCause::Mq2);
  assert(combinedAlarm.causes.items[2] == SafetyCause::Water);
  assert(combinedAlarm.primary == SafetyCause::Flame);
  assert(combinedAlarm.overrideTarget.target.fanPercent == 0);
  assert(combinedAlarm.overrideTarget.target.servoPosition == ServoPosition::SafetyClosed);
  assert(combinedAlarm.overrideTarget.target.relayOn == false);
  assert(combinedAlarm.overrideTarget.target.rgbState == RgbState::Red);

  SafetyEngine staleEngine;
  SensorSnapshot stale = safeSnapshot(now);
  stale.mq2.updatedAtMs = now - 1600;
  SafetyResult fault = staleEngine.update(stale, now);
  assert(fault.state == SafetyState::SensorFault);
  assert(hasCause(fault, SafetyCause::SafetySensorFault));
  assert(fault.overrideTarget.target.fanPercent == 0);
  assert(fault.overrideTarget.target.rgbState == RgbState::Gray);

  SafetyEngine retainedEngine;
  SensorSnapshot flame = safeSnapshot(now);
  flame.flame.value = 1;
  SafetyResult flameAlarm = retainedEngine.update(flame, now);
  assert(hasCause(flameAlarm, SafetyCause::Flame));
  flame.flame.valid = false;
  flame.flame.updatedAtMs = now + 200;
  SafetyResult flameMissing = retainedEngine.update(flame, now + 200);
  assert(hasCause(flameMissing, SafetyCause::Flame));
  assert(hasCause(flameMissing, SafetyCause::SafetySensorFault));
  flame.flame.valid = true;
  flame.flame.value = 0;
  flame.flame.updatedAtMs = now + 400;
  assert(hasCause(retainedEngine.update(flame, now + 400), SafetyCause::Flame));
  flame.flame.updatedAtMs = now + 600;
  assert(hasCause(retainedEngine.update(flame, now + 600), SafetyCause::Flame));
  flame.flame.updatedAtMs = now + 800;
  assert(!hasCause(retainedEngine.update(flame, now + 800), SafetyCause::Flame));

  assert(std::strcmp(safetyStateName(SafetyState::Risk), "risk") == 0);
  assert(std::strcmp(safetyCauseName(SafetyCause::SafetySensorFault),
                     "safety_sensor_fault") == 0);

  return 0;
}
