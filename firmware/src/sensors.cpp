#include "sensors.h"

#include <math.h>

#include "project_config.h"


SensorSampler::SensorSampler()
    : dht_(PIN_DHT, DHT11),
      waterFilter_(WATER_TRIGGER_HIGH, DIGITAL_CONFIRM_SAMPLES,
                   DIGITAL_RECOVERY_SAMPLES),
      flameFilter_(FLAME_TRIGGER_HIGH, DIGITAL_CONFIRM_SAMPLES,
                   DIGITAL_RECOVERY_SAMPLES) {}

void SensorSampler::begin(uint32_t nowMs) {
  startedAt_ = nowMs;
  lastDhtAttemptAt_ = nowMs;
  analogReadResolution(12);
  pinMode(PIN_LIGHT, INPUT);
  pinMode(PIN_SOUND, INPUT);
  pinMode(PIN_KEYPAD_ADC, INPUT);
  pinMode(PIN_MQ2, INPUT);
  pinMode(PIN_PIR, INPUT_PULLDOWN);
  pinMode(PIN_WATER, INPUT_PULLDOWN);
  pinMode(PIN_FLAME, INPUT_PULLDOWN);
  analogSetPinAttenuation(PIN_LIGHT, ADC_11db);
  analogSetPinAttenuation(PIN_SOUND, ADC_11db);
  analogSetPinAttenuation(PIN_KEYPAD_ADC, ADC_11db);
  analogSetPinAttenuation(PIN_MQ2, ADC_11db);
  dht_.begin();
}

void SensorSampler::poll(uint32_t nowMs) {
  if (!fastSampled_ || nowMs - lastFastPollAt_ >= FAST_SENSOR_INTERVAL_MS) {
    pollFast(nowMs);
  }
  if (nowMs - lastDhtAttemptAt_ >= DHT_INTERVAL_MS) {
    pollDht(nowMs);
  }
  refreshDhtValidity(nowMs);
  snapshot_.mq2WarmedUp = nowMs - startedAt_ >= MQ2_WARMUP_MS;
  snapshot_.mq2WarmupRemainingMs = snapshot_.mq2WarmedUp
                                           ? 0
                                           : MQ2_WARMUP_MS - (nowMs - startedAt_);
  snapshot_.capturedAtMs = nowMs;
}

void SensorSampler::pollFast(uint32_t nowMs) {
  lastFastPollAt_ = nowMs;
  fastSampled_ = true;
  setFastSample(snapshot_.light, analogRead(PIN_LIGHT), nowMs);
  setFastSample(snapshot_.sound, analogRead(PIN_SOUND), nowMs);
  setFastSample(snapshot_.keypad, analogRead(PIN_KEYPAD_ADC), nowMs);
  setFastSample(snapshot_.mq2, analogRead(PIN_MQ2), nowMs);
  setFastSample(snapshot_.pir, digitalRead(PIN_PIR) == HIGH ? 1.0F : 0.0F,
                nowMs);

  snapshot_.waterInputHigh = digitalRead(PIN_WATER) == HIGH;
  setFastSample(snapshot_.water,
                waterFilter_.update(snapshot_.waterInputHigh) ? 1.0F : 0.0F,
                nowMs);
  snapshot_.flameInputHigh = digitalRead(PIN_FLAME) == HIGH;
  setFastSample(snapshot_.flame,
                flameFilter_.update(snapshot_.flameInputHigh) ? 1.0F : 0.0F,
                nowMs);
}

void SensorSampler::pollDht(uint32_t nowMs) {
  lastDhtAttemptAt_ = nowMs;
  const float temperature = dht_.readTemperature();
  const float humidity = dht_.readHumidity();
  if (!isnan(temperature) && !isnan(humidity)) {
    snapshot_.temperature.value = temperature;
    snapshot_.temperature.updatedAtMs = nowMs;
    snapshot_.humidity.value = humidity;
    snapshot_.humidity.updatedAtMs = nowMs;
    lastDhtSuccessAt_ = nowMs;
    dhtEverValid_ = true;
  }
}

void SensorSampler::refreshDhtValidity(uint32_t nowMs) {
  const bool dhtFresh = dhtEverValid_ &&
                        nowMs - lastDhtSuccessAt_ <= DHT_STALE_MS;
  snapshot_.temperature.valid = dhtFresh;
  snapshot_.humidity.valid = dhtFresh;
}

void SensorSampler::setFastSample(SensorSample& sample, float value,
                                  uint32_t nowMs) {
  sample.value = value;
  sample.valid = true;
  sample.updatedAtMs = nowMs;
}
