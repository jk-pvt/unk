// Step 1 - analog water sensors and the DS18B20, raw readings only.
//
//   TDS         PA0 (A0)  direct, output 0-2.3 V
//   Pressure    PA1 (A1)  through the 10k / 20k divider (sensor 0.5-4.5 V)
//   Turbidity   PB0 (A3)  through the 10k / 20k divider (switch on A)
//   DS18B20     PC1 (A4)  1-Wire, adapter powered from 3.3 V
//
// Divider: sensor output -> 10k -> ADC pin -> 20k -> GND, so the ADC sees
// 2/3 of the sensor voltage. The "sensor V" column undoes that.
// Serial monitor: 115200 baud.
#include <DallasTemperature.h>
#include <OneWire.h>

constexpr float ADC_VREF = 3.3f;
constexpr float DIVIDER_GAIN = 1.5f;  // (10k + 20k) / 20k

OneWire oneWire(PC1);
DallasTemperature ds18b20(&oneWire);

float readVolts(uint8_t pin) {
  uint32_t sum = 0;
  for (int i = 0; i < 32; i++) sum += analogRead(pin);
  return (sum / 32.0f) * ADC_VREF / 4095.0f;
}

void row(const char *name, uint8_t pin, float gain) {
  float v = readVolts(pin);
  Serial.print(name);
  Serial.print(" pin ");
  Serial.print(v, 3);
  Serial.print(" V   sensor ");
  Serial.print(v * gain, 3);
  Serial.println(" V");
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);  // the default is 10 bit
  ds18b20.begin();
  delay(1500);
  Serial.print("DS18B20 devices found: ");
  Serial.println(ds18b20.getDeviceCount());
}

void loop() {
  Serial.println("\n---- analog sensors ----");
  row("TDS       ", A0, 1.0f);
  row("Pressure  ", A1, DIVIDER_GAIN);
  row("Turbidity ", A3, DIVIDER_GAIN);
  ds18b20.requestTemperatures();
  float t = ds18b20.getTempCByIndex(0);
  Serial.print("Temperature ");
  if (t == DEVICE_DISCONNECTED_C) Serial.println("not found - check 3.3 V, GND, data on PC1 and the PULL jumper");
  else {
    Serial.print(t, 2);
    Serial.println(" C");
  }
  Serial.println("Expect: pressure ~0.5 V in air, turbidity ~4.0-4.2 V in clear water,");
  Serial.println("        TDS ~0 V in air and rising in water, temperature near room temp.");
  delay(1000);
}
