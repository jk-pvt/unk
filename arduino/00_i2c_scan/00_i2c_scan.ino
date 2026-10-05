// Step 0 - I2C scanner for both buses. Run this first: it proves the wiring
// of every I2C module before any sensor code is involved.
//
//   Bus 1 (Wire , 3.3 V): SDA PB9 (D14), SCL PB8 (D15)
//         INA219 x2, BMP390, IMU
//   Bus 2 (Wire2, 5 V)  : SDA PB3 (D3),  SCL PB10 (D6)
//         1602 LCD backpack only
//
// Serial monitor: 115200 baud.
#include <Wire.h>

TwoWire Wire2(PB3, PB10);  // SDA, SCL

struct Known {
  uint8_t addr;
  const char *name;
};
const Known KNOWN[] = {
    {0x27, "LCD backpack (PCF8574)"}, {0x3F, "LCD backpack (PCF8574A)"},
    {0x40, "INA219 #1 (battery)"},    {0x41, "INA219 #2 (TX rail, A0 bridged)"},
    {0x30, "MMC5983MA magnetometer"}, {0x6A, "ISM330DHCX IMU (SDO low)"},
    {0x6B, "ISM330DHCX IMU (SDO high)"}, {0x76, "BMP390 (ADDR low)"},
    {0x77, "BMP390 (ADDR high)"},
};

const char *nameOf(uint8_t addr) {
  for (const Known &k : KNOWN)
    if (k.addr == addr) return k.name;
  return "unknown device";
}

void scan(TwoWire &bus, const char *label) {
  Serial.print("\n== ");
  Serial.println(label);
  uint8_t found = 0;
  for (uint8_t addr = 0x08; addr < 0x78; addr++) {
    bus.beginTransmission(addr);
    if (bus.endTransmission() == 0) {
      Serial.print("  0x");
      if (addr < 16) Serial.print('0');
      Serial.print(addr, HEX);
      Serial.print("  ");
      Serial.println(nameOf(addr));
      found++;
    }
  }
  if (!found) Serial.println("  nothing answered - check power, GND, SDA/SCL and pull-ups");
}

void setup() {
  Serial.begin(115200);
  Wire.setSDA(PB9);
  Wire.setSCL(PB8);
  Wire.begin();
  Wire2.begin();
  delay(1500);  // let the serial monitor connect
}

void loop() {
  Serial.println("\n---- I2C scan ----");
  scan(Wire, "Bus 1 (3.3 V): expect 0x30 0x40 0x41 0x6A/0x6B 0x77");
  scan(Wire2, "Bus 2 (5 V): expect 0x27 or 0x3F");
  delay(5000);
}
