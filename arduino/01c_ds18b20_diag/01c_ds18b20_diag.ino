// Focused DS18B20 electrical/ROM diagnostic for NUCLEO-F446RE.
// DATA: PC1 (Arduino A4), adapter powered from 3.3 V with PULL selected.
#include <OneWire.h>

constexpr uint32_t DATA_PIN = PC1;
OneWire oneWire(DATA_PIN);

float idleVoltage() {
  pinMode(DATA_PIN, INPUT);
  delay(5);
  uint32_t sum = 0;
  for (int i = 0; i < 32; ++i) sum += analogRead(A4);
  return (sum / 32.0f) * 3.3f / 4095.0f;
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  delay(1500);
  Serial.println("DS18B20 diagnostic on A4 / PC1");
}

void loop() {
  float idle = idleVoltage();
  pinMode(DATA_PIN, INPUT_PULLUP);
  delay(5);
  bool internalPullHigh = digitalRead(DATA_PIN) == HIGH;
  Serial.print("DATA idle/no-pull: ");
  Serial.print(idle, 3);
  Serial.print(" V; internal-pull logic: ");
  Serial.print(internalPullHigh ? "HIGH" : "LOW");
  Serial.print(" V; ROM search: ");

  uint8_t rom[8];
  oneWire.reset_search();
  if (!oneWire.search(rom)) {
    Serial.println("NO DEVICE");
  } else {
    Serial.print("FOUND ");
    for (uint8_t i = 0; i < 8; ++i) {
      if (rom[i] < 16) Serial.print('0');
      Serial.print(rom[i], HEX);
      if (i != 7) Serial.print(':');
    }
    Serial.print("; family ");
    Serial.print(rom[0] == 0x28 ? "DS18B20" : "unexpected");
    Serial.print("; CRC ");
    Serial.println(OneWire::crc8(rom, 7) == rom[7] ? "OK" : "BAD");
  }
  delay(2000);
}
