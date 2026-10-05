// Step 2 - I2C sensors on bus 1 (3.3 V): two INA219, BMP390 and the IMU.
// SDA PB9 (D14), SCL PB8 (D15). Missing devices are reported, not fatal.
// Serial monitor: 115200 baud.
#include <Adafruit_BMP3XX.h>
#include <Adafruit_INA219.h>
#include <SparkFun_ISM330DHCX.h>
#include <SparkFun_MMC5983MA_Arduino_Library.h>
#include <Wire.h>

Adafruit_INA219 inaBattery(0x40);  // in series with the pack, before the buck
Adafruit_INA219 inaTx(0x41);       // TX rail (A0 pad bridged)
Adafruit_BMP3XX bmp;
SparkFun_ISM330DHCX imu;
SFE_MMC5983MA mag;

bool okBattery, okTx, okBmp, okImu, okMag;

void setup() {
  Serial.begin(115200);
  Wire.setSDA(PB9);
  Wire.setSCL(PB8);
  Wire.begin();
  delay(1500);

  okBattery = inaBattery.begin(&Wire);
  okTx = inaTx.begin(&Wire);
  // 32 V / 2 A range assumes the 0.1 ohm shunt on the R100 boards.
  if (okBattery) inaBattery.setCalibration_32V_2A();
  if (okTx) inaTx.setCalibration_32V_2A();

  okBmp = bmp.begin_I2C(0x77, &Wire) || bmp.begin_I2C(0x76, &Wire);
  if (okBmp) {
    bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_8X);
    bmp.setPressureOversampling(BMP3_OVERSAMPLING_4X);
    bmp.setIIRFilterCoeff(BMP3_IIR_FILTER_COEFF_3);
    bmp.setOutputDataRate(BMP3_ODR_50_HZ);
  }

  okImu = imu.begin(Wire, 0x6B) || imu.begin(Wire, 0x6A);
  if (okImu) {
    imu.deviceReset();
    while (!imu.getDeviceReset()) delay(1);
    delay(100);
    imu.setDeviceConfig();
    imu.setBlockDataUpdate();
    imu.setAccelDataRate(ISM_XL_ODR_104Hz);
    imu.setAccelFullScale(ISM_4g);
    imu.setGyroDataRate(ISM_GY_ODR_104Hz);
    imu.setGyroFullScale(ISM_500dps);
  }

  okMag = mag.begin(Wire);
  if (okMag) mag.softReset();

  Serial.println("\nDevices: ");
  Serial.print("  INA219 #1 0x40 "); Serial.println(okBattery ? "ok" : "MISSING");
  Serial.print("  INA219 #2 0x41 "); Serial.println(okTx ? "ok" : "MISSING");
  Serial.print("  BMP390         "); Serial.println(okBmp ? "ok" : "MISSING");
  Serial.print("  ISM330DHCX     "); Serial.println(okImu ? "ok" : "MISSING");
  Serial.print("  MMC5983MA 0x30 "); Serial.println(okMag ? "ok" : "MISSING");
}

void printIna(const char *name, Adafruit_INA219 &ina) {
  float busV = ina.getBusVoltage_V();
  float mA = ina.getCurrent_mA();
  Serial.print(name);
  Serial.print(busV, 2);
  Serial.print(" V  ");
  Serial.print(mA, 1);
  Serial.print(" mA  ");
  Serial.print(busV * mA, 0);
  Serial.println(" mW");
}

void loop() {
  Serial.println("\n---- I2C sensors ----");
  if (okBattery) printIna("Battery  ", inaBattery);
  if (okTx) printIna("TX rail  ", inaTx);
  if (okBmp && bmp.performReading()) {
    Serial.print("BMP390   ");
    Serial.print(bmp.temperature, 1);
    Serial.print(" C  ");
    Serial.print(bmp.pressure / 100.0f, 1);
    Serial.println(" hPa   (cabin, expect ~1000-1020 hPa)");
  }
  if (okImu && imu.checkStatus()) {
    sfe_ism_data_t accel, gyro;
    imu.getAccel(&accel);
    imu.getGyro(&gyro);
    Serial.print("Accel mg ");
    Serial.print(accel.xData, 0); Serial.print(' ');
    Serial.print(accel.yData, 0); Serial.print(' ');
    Serial.print(accel.zData, 0);
    Serial.println("   (flat on the desk: one axis near +/-1000)");
    Serial.print("Gyro mdps ");
    Serial.print(gyro.xData, 0); Serial.print(' ');
    Serial.print(gyro.yData, 0); Serial.print(' ');
    Serial.println(gyro.zData, 0);
  }
  if (okMag) {
    uint32_t x = 0, y = 0, z = 0;
    if (mag.getMeasurementXYZ(&x, &y, &z)) {
      // 18-bit, offset binary, +/-8 gauss full scale.
      auto gauss = [](uint32_t raw) { return ((float)raw - 131072.0f) / 131072.0f * 8.0f; };
      Serial.print("Mag gauss ");
      Serial.print(gauss(x), 3); Serial.print(' ');
      Serial.print(gauss(y), 3); Serial.print(' ');
      Serial.print(gauss(z), 3);
      Serial.println("   (Earth field is about 0.25-0.65 in total)");
    }
  }
  delay(1000);
}
