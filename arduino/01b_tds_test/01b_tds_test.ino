// Step 1b - TDS meter test with a median filter and a plain-language verdict.
//
//   TDS signal -> PA0 (A0)     TDS + -> 3V3     TDS - -> GND
//
// Each second: 50 samples 20 ms apart, then median, lowest and highest.
// The probe drives the water with an alternating signal, so single readings
// wander; the median is steady. Serial monitor: 115200 baud.
constexpr float ADC_VREF = 3.3f;
constexpr int SAMPLES = 50;

// Same formula as tdsPpm() in 04_all_sensors/SensorMath.h (DFRobot Gravity
// analog TDS, temperature-compensated, 25 C assumed here).
float tdsPpm(float v, float tempC) {
  float c = v / (1.0f + 0.02f * (tempC - 25.0f));
  return (133.42f * c * c * c - 255.86f * c * c + 857.39f * c) * 0.5f;
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  delay(1500);
  Serial.println("TDS test: dry the probe first, then dip it in water, then add salt.");
}

void loop() {
  uint16_t raw[SAMPLES];
  for (int i = 0; i < SAMPLES; i++) {
    raw[i] = analogRead(A0);
    delay(20);
  }
  // insertion sort, then median / min / max
  for (int i = 1; i < SAMPLES; i++) {
    uint16_t key = raw[i];
    int j = i - 1;
    while (j >= 0 && raw[j] > key) { raw[j + 1] = raw[j]; j--; }
    raw[j + 1] = key;
  }
  float median = raw[SAMPLES / 2] * ADC_VREF / 4095.0f;
  float lo = raw[0] * ADC_VREF / 4095.0f;
  float hi = raw[SAMPLES - 1] * ADC_VREF / 4095.0f;
  float spread = hi - lo;

  const char *verdict;
  if (median > 0.9f && spread < 0.15f) verdict = "READS ~1 V AND FLAT: pin looks unconnected (floating) - check the A0 wire";
  else if (median < 0.06f && spread < 0.05f) verdict = "DRY / in air (correct for a dry probe)";
  else if (spread > 0.25f * (median > 0.05f ? median : 0.05f) + 0.08f) verdict = "UNSTABLE - still wet, being handled, or a loose wire";
  else verdict = "IN WATER, stable";

  Serial.print("median ");
  Serial.print(median, 3);
  Serial.print(" V   min ");
  Serial.print(lo, 3);
  Serial.print("   max ");
  Serial.print(hi, 3);
  Serial.print("   = ");
  Serial.print(tdsPpm(median, 25.0f), 0);
  Serial.print(" ppm   -> ");
  Serial.println(verdict);
}
