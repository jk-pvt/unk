// Slow software-I2C BMP3xx diagnostic using the STM32's internal pull-ups.
// Intended for bench diagnosis only; use proper external/on-board pull-ups
// for the final multi-device bus.
#include <Arduino.h>

constexpr unsigned HALF_US = 30;
uint32_t sdaPin = PB9;  // D14 normally
uint32_t sclPin = PB8;  // D15 normally

void low(uint32_t pin) {
  digitalWrite(pin, LOW);
  pinMode(pin, OUTPUT);
}

void release(uint32_t pin) { pinMode(pin, INPUT_PULLUP); }

bool high(uint32_t pin) {
  release(pin);
  for (int i = 0; i < 200; ++i) {
    if (digitalRead(pin) == HIGH) return true;
    delayMicroseconds(5);
  }
  return false;
}

bool startCondition() {
  release(sdaPin);
  if (!high(sclPin) || digitalRead(sdaPin) == LOW) return false;
  delayMicroseconds(HALF_US);
  low(sdaPin);
  delayMicroseconds(HALF_US);
  low(sclPin);
  return true;
}

void stopCondition() {
  low(sdaPin);
  delayMicroseconds(HALF_US);
  high(sclPin);
  delayMicroseconds(HALF_US);
  release(sdaPin);
  delayMicroseconds(HALF_US);
}

bool writeByte(uint8_t value) {
  for (uint8_t mask = 0x80; mask; mask >>= 1) {
    if (value & mask) release(sdaPin);
    else low(sdaPin);
    delayMicroseconds(HALF_US);
    high(sclPin);
    delayMicroseconds(HALF_US);
    low(sclPin);
  }
  release(sdaPin);
  delayMicroseconds(HALF_US);
  high(sclPin);
  bool ack = digitalRead(sdaPin) == LOW;
  delayMicroseconds(HALF_US);
  low(sclPin);
  return ack;
}

uint8_t readByte(bool sendAck) {
  uint8_t value = 0;
  release(sdaPin);
  for (uint8_t i = 0; i < 8; ++i) {
    value <<= 1;
    delayMicroseconds(HALF_US);
    high(sclPin);
    if (digitalRead(sdaPin) == HIGH) value |= 1;
    delayMicroseconds(HALF_US);
    low(sclPin);
  }
  if (sendAck) low(sdaPin);
  else release(sdaPin);
  delayMicroseconds(HALF_US);
  high(sclPin);
  delayMicroseconds(HALF_US);
  low(sclPin);
  release(sdaPin);
  return value;
}

bool probe(uint8_t address) {
  if (!startCondition()) return false;
  bool ack = writeByte(address << 1);
  stopCondition();
  return ack;
}

bool readRegister(uint8_t address, uint8_t reg, uint8_t &value) {
  if (!startCondition()) return false;
  if (!writeByte(address << 1) || !writeByte(reg)) {
    stopCondition();
    return false;
  }
  if (!startCondition() || !writeByte((address << 1) | 1)) {
    stopCondition();
    return false;
  }
  value = readByte(false);
  stopCondition();
  return true;
}

void setup() {
  Serial.begin(115200);
  release(sdaPin);
  release(sclPin);
  delay(1500);
  Serial.println("Soft-I2C BMP390 diagnostic: SDA D14/PB9, SCL D15/PB8");
}

bool scan(const char *label) {
  Serial.println(label);
  release(sdaPin);
  release(sclPin);
  Serial.print("Idle SDA=");
  Serial.print(digitalRead(sdaPin) ? "HIGH" : "LOW");
  Serial.print(" SCL=");
  Serial.println(digitalRead(sclPin) ? "HIGH" : "LOW");

  bool found = false;
  for (uint8_t address = 0x08; address < 0x78; ++address) {
    if (!probe(address)) continue;
    found = true;
    Serial.print("ACK at 0x");
    if (address < 0x10) Serial.print('0');
    Serial.print(address, HEX);
    uint8_t chipId = 0;
    if ((address == 0x76 || address == 0x77) && readRegister(address, 0x00, chipId)) {
      Serial.print("; chip ID 0x");
      if (chipId < 0x10) Serial.print('0');
      Serial.print(chipId, HEX);
      if (chipId == 0x60) Serial.print(" (BMP390)");
      else if (chipId == 0x50) Serial.print(" (BMP388)");
    }
    Serial.println();
  }
  if (!found) Serial.println("No I2C device acknowledged");
  return found;
}

void loop() {
  sdaPin = PB9;
  sclPin = PB8;
  scan("Normal: SDA D14/PB9, SCL D15/PB8");
  sdaPin = PB8;
  sclPin = PB9;
  scan("Swapped test: SDA D15/PB8, SCL D14/PB9");
  sdaPin = PB3;
  sclPin = PB10;
  scan("LCD normal: SDA D3/PB3, SCL D6/PB10");
  sdaPin = PB10;
  sclPin = PB3;
  scan("LCD swapped test: SDA D6/PB10, SCL D3/PB3");
  delay(3000);
}
