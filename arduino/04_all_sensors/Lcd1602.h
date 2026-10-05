// Minimal HD44780 1602 driver for the PCF8574 I2C backpack, written against
// a TwoWire reference so the LCD can live on its own bus (Wire2). The common
// LiquidCrystal_I2C library is hard-wired to the global Wire, so it can't.
//
// Backpack wiring assumed (the usual one): P0 RS, P1 RW, P2 E, P3 backlight,
// P4-P7 D4-D7. Keep this file identical in 03_lcd_test and 04_all_sensors.
#pragma once
#include <Wire.h>

class Lcd1602 {
 public:
  Lcd1602(TwoWire &bus, uint8_t addr) : bus_(bus), addr_(addr) {}

  // Tries the given address, then the other common backpack address.
  bool begin() {
    if (!answers(addr_)) {
      uint8_t other = addr_ == 0x27 ? 0x3F : 0x27;
      if (!answers(other)) return false;
      addr_ = other;
    }
    delay(50);
    // Datasheet reset sequence into 4-bit mode.
    write4(0x30);
    delayMicroseconds(4500);
    write4(0x30);
    delayMicroseconds(4500);
    write4(0x30);
    delayMicroseconds(150);
    write4(0x20);
    command(0x28);  // 4-bit, 2 lines, 5x8 font
    command(0x0C);  // display on, cursor off
    command(0x06);  // increment, no shift
    clear();
    return true;
  }

  uint8_t address() const { return addr_; }

  void clear() {
    command(0x01);
    delay(2);
  }

  // Writes exactly 16 characters to a row, padding or cutting the text.
  void line(uint8_t row, const String &text) {
    command(0x80 | (row ? 0x40 : 0x00));
    for (uint8_t i = 0; i < 16; i++) send(i < text.length() ? text[i] : ' ', RS);
  }

 private:
  static constexpr uint8_t RS = 0x01, EN = 0x04, BACKLIGHT = 0x08;
  TwoWire &bus_;
  uint8_t addr_;

  bool answers(uint8_t addr) {
    bus_.beginTransmission(addr);
    return bus_.endTransmission() == 0;
  }
  void expander(uint8_t value) {
    bus_.beginTransmission(addr_);
    bus_.write(value | BACKLIGHT);
    bus_.endTransmission();
  }
  void write4(uint8_t nibbleInHighBits, uint8_t mode = 0) {
    uint8_t v = (nibbleInHighBits & 0xF0) | mode;
    expander(v);
    expander(v | EN);
    delayMicroseconds(1);
    expander(v);
    delayMicroseconds(50);
  }
  void send(uint8_t value, uint8_t mode) {
    write4(value & 0xF0, mode);
    write4((value << 4) & 0xF0, mode);
  }
  void command(uint8_t value) { send(value, 0); }
};
