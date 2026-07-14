#include "safety_engine.h"

#include "project_config.h"

namespace {

bool isFresh(const SensorSample& sample, uint32_t nowMs) {
  return sample.valid && sample.updatedAtMs != 0 &&
         nowMs - sample.updatedAtMs <= FAST_SAFETY_STALE_MS;
}

void updateHeldDigital(const SensorSample& sample, bool fresh, bool& active,
                       bool& heldByFault, uint8_t& recoverySamples) {
  if (!fresh) {
    if (active) {
      heldByFault = true;
    }
    recoverySamples = 0;
    return;
  }

  const bool triggered = sample.value >= 0.5F;
  if (triggered) {
    active = true;
    heldByFault = false;
    recoverySamples = 0;
    return;
  }

  if (active && heldByFault) {
    if (recoverySamples < DIGITAL_RECOVERY_SAMPLES) {
      ++recoverySamples;
    }
    if (recoverySamples >= DIGITAL_RECOVERY_SAMPLES) {
      active = false;
      heldByFault = false;
      recoverySamples = 0;
    }
    return;
  }

  active = false;
  recoverySamples = 0;
}

void applyFaultOverride(SafetyResult& result) {
  result.overrideTarget.fan = true;
  result.overrideTarget.servo = true;
  result.overrideTarget.relay = true;
  result.overrideTarget.buzzer = true;
  result.overrideTarget.rgb = true;
  result.overrideTarget.target.fanPercent = 0;
  result.overrideTarget.target.servoPosition = ServoPosition::Hold;
  result.overrideTarget.target.relayOn = false;
  result.overrideTarget.target.buzzerMode = BuzzerMode::Off;
  result.overrideTarget.target.rgbState = RgbState::Gray;
}

void applyWaterOverride(SafetyResult& result) {
  result.overrideTarget.relay = true;
  result.overrideTarget.buzzer = true;
  result.overrideTarget.rgb = true;
  result.overrideTarget.target.relayOn = false;
  result.overrideTarget.target.buzzerMode = BuzzerMode::Intermittent;
  result.overrideTarget.target.rgbState = RgbState::BlueRed;
}

void applyMq2Override(SafetyResult& result) {
  result.overrideTarget.fan = true;
  result.overrideTarget.servo = true;
  result.overrideTarget.relay = true;
  result.overrideTarget.buzzer = true;
  result.overrideTarget.rgb = true;
  result.overrideTarget.target.fanPercent = FAN_ALERT_PERCENT;
  result.overrideTarget.target.servoPosition = ServoPosition::VentilationOpen;
  result.overrideTarget.target.relayOn = false;
  result.overrideTarget.target.buzzerMode = BuzzerMode::Alarm;
  result.overrideTarget.target.rgbState = RgbState::Red;
}

void applyFlameOverride(SafetyResult& result) {
  result.overrideTarget.fan = true;
  result.overrideTarget.servo = true;
  result.overrideTarget.relay = true;
  result.overrideTarget.buzzer = true;
  result.overrideTarget.rgb = true;
  result.overrideTarget.target.fanPercent = 0;
  result.overrideTarget.target.servoPosition = ServoPosition::SafetyClosed;
  result.overrideTarget.target.relayOn = false;
  result.overrideTarget.target.buzzerMode = BuzzerMode::Alarm;
  result.overrideTarget.target.rgbState = RgbState::Red;
}

}  // namespace

SafetyResult SafetyEngine::update(const SensorSnapshot& sensors, uint32_t nowMs) {
  const bool mq2Fresh = isFresh(sensors.mq2, nowMs);
  const bool waterFresh = isFresh(sensors.water, nowMs);
  const bool flameFresh = isFresh(sensors.flame, nowMs);
  const bool sensorFault = !mq2Fresh || !waterFresh || !flameFresh;

  if (!sensors.mq2WarmedUp) {
    mq2Active_ = false;
    mq2AlertSamples_ = 0;
    mq2RecoverySamples_ = 0;
  } else if (mq2Fresh) {
    if (mq2Active_) {
      mq2AlertSamples_ = 0;
      if (sensors.mq2.value <= PROVISIONAL_MQ2_RECOVERY_RAW) {
        if (mq2RecoverySamples_ < DIGITAL_RECOVERY_SAMPLES) {
          ++mq2RecoverySamples_;
        }
        if (mq2RecoverySamples_ >= DIGITAL_RECOVERY_SAMPLES) {
          mq2Active_ = false;
          mq2RecoverySamples_ = 0;
        }
      } else {
        mq2RecoverySamples_ = 0;
      }
    } else {
      mq2RecoverySamples_ = 0;
      if (sensors.mq2.value >= PROVISIONAL_MQ2_ALERT_RAW) {
        if (mq2AlertSamples_ < DIGITAL_CONFIRM_SAMPLES) {
          ++mq2AlertSamples_;
        }
        if (mq2AlertSamples_ >= DIGITAL_CONFIRM_SAMPLES) {
          mq2Active_ = true;
          mq2AlertSamples_ = 0;
        }
      } else {
        mq2AlertSamples_ = 0;
      }
    }
  } else {
    mq2AlertSamples_ = 0;
    mq2RecoverySamples_ = 0;
  }

  updateHeldDigital(sensors.water, waterFresh, waterActive_, waterHeldByFault_,
                    waterFaultRecoverySamples_);
  updateHeldDigital(sensors.flame, flameFresh, flameActive_, flameHeldByFault_,
                    flameFaultRecoverySamples_);

  SafetyResult result;
  if (flameActive_) {
    result.causes.add(SafetyCause::Flame);
  }
  if (mq2Active_) {
    result.causes.add(SafetyCause::Mq2);
  }
  if (waterActive_) {
    result.causes.add(SafetyCause::Water);
  }
  if (sensorFault) {
    result.causes.add(SafetyCause::SafetySensorFault);
  }

  if (result.causes.count > 0) {
    result.primary = result.causes.items[0];
  }

  const bool riskActive = flameActive_ || mq2Active_ || waterActive_;
  if (riskActive) {
    result.state = SafetyState::Risk;
  } else if (sensorFault) {
    result.state = SafetyState::SensorFault;
  } else if (!sensors.mq2WarmedUp) {
    result.state = SafetyState::Warming;
  } else {
    result.state = SafetyState::Normal;
  }

  if (result.state == SafetyState::Warming) {
    result.overrideActive = true;
    result.overrideTarget.fan = true;
    result.overrideTarget.relay = true;
    result.overrideTarget.buzzer = true;
    result.overrideTarget.rgb = true;
    result.overrideTarget.target.fanPercent = 0;
    result.overrideTarget.target.relayOn = false;
    result.overrideTarget.target.buzzerMode = BuzzerMode::Off;
    result.overrideTarget.target.rgbState = RgbState::Yellow;
    return result;
  }

  if (sensorFault) {
    applyFaultOverride(result);
  }
  if (waterActive_) {
    applyWaterOverride(result);
  }
  if (mq2Active_) {
    applyMq2Override(result);
  }
  if (flameActive_) {
    applyFlameOverride(result);
  }

  result.overrideActive = sensorFault || riskActive;
  result.buzzerRequested = riskActive;
  return result;
}

const char* safetyStateName(SafetyState state) {
  switch (state) {
    case SafetyState::Warming:
      return "warming";
    case SafetyState::Risk:
      return "risk";
    case SafetyState::SensorFault:
      return "sensor_fault";
    case SafetyState::Normal:
    default:
      return "normal";
  }
}

const char* safetyCauseName(SafetyCause cause) {
  switch (cause) {
    case SafetyCause::Flame:
      return "flame";
    case SafetyCause::Mq2:
      return "mq2";
    case SafetyCause::Water:
      return "water";
    case SafetyCause::SafetySensorFault:
      return "safety_sensor_fault";
    case SafetyCause::None:
    default:
      return "none";
  }
}
