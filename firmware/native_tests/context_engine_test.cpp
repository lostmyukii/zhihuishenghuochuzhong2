#include <cassert>

#include "context_engine.h"
#include "input_filter.h"

namespace {

SensorSample sample(float value, bool valid = true) {
  return SensorSample{value, valid, 1000};
}

SensorSnapshot comfortableRoom() {
  SensorSnapshot snapshot{};
  snapshot.light = sample(2500);
  snapshot.sound = sample(1000);
  snapshot.temperature = sample(24);
  snapshot.humidity = sample(50);
  snapshot.pir = sample(1);
  return snapshot;
}

}  // namespace

int main() {
  ContextEngine engine;

  SensorSnapshot empty{};
  ContextResult unknown = engine.evaluate(empty, ContextMode::Detect);
  assert(unknown.status == ContextStatus::Unknown);

  SensorSnapshot study = comfortableRoom();
  ContextResult studyResult = engine.evaluate(study, ContextMode::Detect);
  assert(studyResult.candidate == ContextMode::Study);
  assert(studyResult.status == ContextStatus::Possible);
  assert(studyResult.coverage == 100);
  assert(studyResult.match == 100);

  RuntimeThresholds stricterContext;
  stricterContext.lightThreshold = 3000;
  ContextResult thresholdStudy =
      engine.evaluate(study, ContextMode::Detect, stricterContext);
  assert(thresholdStudy.candidate == ContextMode::Study);
  assert(thresholdStudy.match == 78);

  SensorSnapshot tied = comfortableRoom();
  tied.light = sample(1300);
  ContextResult ambiguous = engine.evaluate(tied, ContextMode::Detect);
  assert(ambiguous.status == ContextStatus::Ambiguous);
  assert(ambiguous.match == 78);

  SensorSnapshot missing{};
  missing.sound = sample(900);
  ContextResult insufficient = engine.evaluate(missing, ContextMode::Detect);
  assert(insufficient.status == ContextStatus::EvidenceMissing);
  assert(insufficient.missing.count > 0);

  SensorSnapshot ventilation{};
  ventilation.temperature = sample(30);
  ventilation.humidity = sample(75);
  ventilation.pir = sample(1);
  ContextResult ventilationResult = engine.evaluate(ventilation, ContextMode::Ventilation);
  assert(ventilationResult.candidate == ContextMode::Ventilation);
  assert(ventilationResult.status == ContextStatus::Possible);
  assert(ventilationResult.match == 100);

  stricterContext.temperatureThreshold = 31;
  stricterContext.humidityThreshold = 80;
  ContextResult thresholdVentilation =
      engine.evaluate(ventilation, ContextMode::Ventilation, stricterContext);
  assert(thresholdVentilation.status == ContextStatus::Unknown);

  SensorSnapshot staleDht = ventilation;
  staleDht.temperature.valid = false;
  staleDht.humidity.valid = false;
  ContextResult staleResult = engine.evaluate(staleDht, ContextMode::Ventilation);
  assert(staleResult.status == ContextStatus::EvidenceMissing);

  SensorSnapshot energy{};
  energy.pir = sample(0);
  energy.light = sample(3000);
  energy.sound = sample(800);
  ContextResult energyResult = engine.evaluate(energy, ContextMode::Energy);
  assert(energyResult.candidate == ContextMode::Energy);
  assert(energyResult.match == 100);

  StableDigitalFilter filter(true, 3, 3);
  assert(!filter.update(false));
  assert(!filter.update(true));
  assert(!filter.update(true));
  assert(filter.update(true));
  assert(filter.update(false));
  assert(filter.update(false));
  assert(!filter.update(false));

  return 0;
}
