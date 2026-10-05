// Step 3 - 1602 LCD on its own 5 V I2C bus (Wire2): SDA PB3 (D3), SCL PB10 (D6).
// LCD backpack VCC to 5 V, GND common. The backpack normally has pull-ups
// to its own VCC; if it does not, add 4.7k from SDA and SCL to 5 V.
//
// If the screen lights but shows only blocks or nothing, turn the blue
// contrast potentiometer on the backpack. Serial monitor: 115200 baud.
#include "Lcd1602.h"

TwoWire Wire2(PB3, PB10);  // SDA, SCL
Lcd1602 lcd(Wire2, 0x27);  // falls back to 0x3F on its own
bool ok = false;

void setup() {
  Serial.begin(115200);
  Wire2.begin();
  delay(1500);
  ok = lcd.begin();
  if (ok) {
    lcd.line(0, "AquaSDR payload");
    lcd.line(1, "LCD test ok");
  }
}

void loop() {
  if (!ok) {
    // Keep looking so the LCD can be plugged in after boot.
    ok = lcd.begin();
    if (ok) lcd.line(0, "AquaSDR payload");
  }
  if (ok) {
    lcd.line(1, "uptime " + String(millis() / 1000) + " s");
    Serial.print("LCD ok at 0x");
    Serial.print(lcd.address(), HEX);
    Serial.print(", uptime ");
    Serial.print(millis() / 1000);
    Serial.println(" s");
  } else {
    Serial.println("LCD not answering at 0x27 or 0x3F - check 5 V, GND, SDA on D3, SCL on D6");
  }
  delay(2000);
}
