#include <Wire.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>

// Fix the backpack address but let the library determine its LCD pin mapping.
hd44780_I2Cexp lcd(0x27);

int lcdStatus = -1;

int walkOneTest(uint8_t address) {
  int errors = 0;
  for (uint8_t pattern = 1; pattern != 0; pattern <<= 1) {
    lcd.setCursor(address, 0);
    lcd.write(pattern);
    lcd.setCursor(address, 0);
    int value = lcd.read();
    if (value != pattern) {
      errors++;
    }
  }
  return errors;
}

int addressTest(uint8_t first, uint8_t last) {
  int errors = 0;
  for (uint8_t address = first; address <= last; address++) {
    if (address == '\n' || address == '\r') continue;
    lcd.setCursor(address, 0);
    lcd.write(address);
  }
  for (uint8_t address = first; address <= last; address++) {
    if (address == '\n' || address == '\r') continue;
    lcd.setCursor(address, 0);
    if (lcd.read() != address) errors++;
  }
  return errors;
}

void setup() {
  Serial.begin(115200);

  // LCD bus used by this AquaSDR build: SDA D3/PB3, SCL D6/PB10.
  Wire.setSDA(PB3);
  Wire.setSCL(PB10);
  Wire.begin();
  delay(1500);

  Serial.println();
  Serial.println("AquaSDR LCD auto-map test");
  Serial.println("Address 0x27, SDA D3/PB3, SCL D6/PB10");

  // Use deliberately conservative timings to support unusually slow clones.
  lcd.setExecTimes(5000, 200);
  lcdStatus = lcd.begin(16, 2);
  Serial.print("lcd.begin status = ");
  Serial.println(lcdStatus);

  if (lcdStatus == 0) {
    Serial.print("Detected mapping: RS=P");
    Serial.print(lcd.getProp(hd44780_I2Cexp::Prop_rs));
    Serial.print(" RW=P");
    Serial.print(lcd.getProp(hd44780_I2Cexp::Prop_rw));
    Serial.print(" EN=P");
    Serial.print(lcd.getProp(hd44780_I2Cexp::Prop_en));
    Serial.print(" D4=P");
    Serial.print(lcd.getProp(hd44780_I2Cexp::Prop_d4));
    Serial.print(" D5=P");
    Serial.print(lcd.getProp(hd44780_I2Cexp::Prop_d5));
    Serial.print(" D6=P");
    Serial.print(lcd.getProp(hd44780_I2Cexp::Prop_d6));
    Serial.print(" D7=P");
    Serial.print(lcd.getProp(hd44780_I2Cexp::Prop_d7));
    Serial.print(" BL=P");
    Serial.print(lcd.getProp(hd44780_I2Cexp::Prop_bl));
    Serial.print(" BL level=");
    Serial.println(lcd.getProp(hd44780_I2Cexp::Prop_blLevel));

    lcd.backlight();
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("AUTO MAP OK");
    lcd.setCursor(0, 1);
    lcd.print("Starting...");
    Serial.println("Auto-map succeeded; text is being written to the LCD.");
  } else {
    Serial.println("Auto-map failed; backpack ACKs but LCD interface did not initialize.");
  }
}

void loop() {
  static unsigned long lastUpdate = 0;
  unsigned long now = millis();

  if (now - lastUpdate >= 2000) {
    lastUpdate = now;

    if (lcdStatus != 0) {
      lcdStatus = lcd.begin(16, 2);
      Serial.print("LCD retry status = ");
      Serial.println(lcdStatus);
      if (lcdStatus == 0) {
        lcd.backlight();
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("AUTO MAP OK");
      }
    }

    Serial.print("LCD status ");
    Serial.print(lcdStatus);
    Serial.print(", uptime ");
    Serial.print(now / 1000);
    Serial.println(" s");

    if (lcdStatus == 0) {
      // Reassert the visible display state and completely replace both rows.
      // This also recovers from any stale state left by an interrupted test.
      lcd.display();
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("AquaSDR payload");
      lcd.setCursor(0, 1);
      lcd.print("uptime ");
      lcd.print(now / 1000);
      lcd.print(" s     ");
    }
  }
}
