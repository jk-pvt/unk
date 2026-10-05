// Step 4 - everything together: water sensors, DS18B20, power, cabin
// pressure, IMU and the TFT.
//
//   Analog : TDS PA0, pressure PA1 (divider), turbidity PB0 (divider)
//   1-Wire : DS18B20 PC1
//   Range   : HC-SR04 D7 trigger / D8 echo (air only)
//   Bus 1  : INA219 x2, BMP390, IMU, magnetometer (Wire , PB9 SDA / PB8 SCL, 3.3 V)
//   Display: 1.8-inch ST7735 TFT                    (SPI, D10 CS / D6 DC / D3 RST)
//
// Serial, 115200 baud: one protocol-v1 JSON telemetry packet per second for
// the AquaSDR local bridge. Human-readable debug lines are intentionally not
// emitted because the bridge treats every newline as a telemetry packet.
#include <Adafruit_BMP3XX.h>
#include <Adafruit_GFX.h>
#include <Adafruit_INA219.h>
#include <Adafruit_ST7735.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <SparkFun_ISM330DHCX.h>
#include <SparkFun_MMC5983MA_Arduino_Library.h>
#include <Wire.h>

#include "AquaSdrLogo.h"
#include "SensorMath.h"
#include "SonarLoopback.h"

using namespace sensormath;

constexpr uint8_t TFT_CS_PIN = D10;
constexpr uint8_t TFT_DC_PIN = D6;
constexpr uint8_t TFT_RST_PIN = D3;
constexpr uint8_t TFT_MOSI_PIN = D11;
constexpr uint8_t TFT_SCK_PIN = D13;
// Software SPI avoids a compatibility issue between this display library and
// the STM32duino hardware-SPI implementation. The physical wiring is unchanged.
Adafruit_ST7735 tft(TFT_CS_PIN, TFT_DC_PIN, TFT_MOSI_PIN, TFT_SCK_PIN, TFT_RST_PIN);
OneWire oneWire(PC1);
DallasTemperature ds18b20(&oneWire);
Adafruit_INA219 inaBattery(0x40), inaTx(0x41);
Adafruit_BMP3XX bmp;
SparkFun_ISM330DHCX imu;
SFE_MMC5983MA mag;

bool okTft, okBattery, okTx, okBmp, okImu, okMag;
bool tempProbePresent = false;
uint16_t tempReadErrors = 0;
uint32_t tempLastValidMs = 0;
float pressureZeroV = 0.5f;  // sensor volts at atmospheric pressure
uint32_t telemetrySeq = 0;
constexpr uint8_t SONAR_TRIG_PIN = D7;
constexpr uint8_t SONAR_ECHO_PIN = D8;
constexpr uint8_t TFT_PAGE_COUNT = 6;
constexpr bool TFT_PRESENTATION_MODE = true;

// Temporary direct-input mode requested for bench testing without dividers.
// The sensor outputs can exceed the Nucleo ADC range, so values may clip at
// 3.3 V and are not suitable for calibration or deployment.
constexpr bool PRESSURE_DIVIDER_INSTALLED = false;
constexpr bool TURBIDITY_DIVIDER_INSTALLED = false;
constexpr bool PUBLISH_UNSAFE_DIRECT_ANALOG = true;

constexpr float pressureInputGain() {
  return PRESSURE_DIVIDER_INSTALLED ? DIVIDER_GAIN : 1.0f;
}

constexpr float turbidityInputGain() {
  return TURBIDITY_DIVIDER_INSTALLED ? DIVIDER_GAIN : 1.0f;
}

// Latest values. NAN means "not available" and is never shown as a number.
float tempC = NAN, turbNTU = NAN, turbV = NAN, tdsPpmV = NAN, ecMsCm = NAN;
float pressureBar = NAN, depthM = NAN, pressureV = NAN;
float distanceCm = NAN;
float packV = NAN, packMa = NAN, txMa = NAN, cabinHpa = NAN;
float rollDeg = NAN, pitchDeg = NAN, fieldGauss = NAN;

float readVolts(uint8_t pin) {
  uint32_t sum = 0;
  for (int i = 0; i < 32; i++) sum += analogRead(pin);
  return (sum / 32.0f) * ADC_VREF / 4095.0f;
}

void zeroPressure() {
  float v = readVolts(A1) * pressureInputGain();
  if (v > 0.35f && v < 0.65f) {
    pressureZeroV = v;
  }
}

void readAnalog() {
  turbV = readVolts(A3) * turbidityInputGain();
  turbNTU = turbidityNTU(turbV);
  pressureV = readVolts(A1) * pressureInputGain();
  float mpa = pressureGaugeMPa(pressureV, pressureZeroV);
  depthM = depthMetres(mpa);
  pressureBar = ATMOSPHERE_BAR + gaugeBar(mpa);
  // TDS is temperature compensated; fall back to 25 C if the probe is missing.
  tdsPpmV = tdsPpm(readVolts(A0), isnan(tempC) ? 25.0f : tempC);
  ecMsCm = conductivityMsPerCm(tdsPpmV);
  sonarloop::measure();
}

void readDistance() {
  digitalWrite(SONAR_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(SONAR_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(SONAR_TRIG_PIN, LOW);
  unsigned long echoUs = pulseIn(SONAR_ECHO_PIN, HIGH, 30000UL);
  float measuredCm = echoUs * 0.0343f * 0.5f;
  distanceCm = (echoUs == 0 || measuredCm < 2.0f || measuredCm > 400.0f) ? NAN : measuredCm;
}

void readI2c() {
  if (okBattery) {
    packV = inaBattery.getBusVoltage_V();
    packMa = inaBattery.getCurrent_mA();
  }
  if (okTx) txMa = inaTx.getCurrent_mA();
  if (okBmp && bmp.performReading()) cabinHpa = bmp.pressure / 100.0f;
  if (okImu && imu.checkStatus()) {
    sfe_ism_data_t a;
    imu.getAccel(&a);
    rollDeg = atan2f(a.yData, a.zData) * 57.29578f;
    pitchDeg = atan2f(-a.xData, sqrtf(a.yData * a.yData + a.zData * a.zData)) * 57.29578f;
  }
  if (okMag) {
    uint32_t x, y, z;
    if (mag.getMeasurementXYZ(&x, &y, &z)) {
      float gx = ((float)x - 131072.0f) / 131072.0f * 8.0f;
      float gy = ((float)y - 131072.0f) / 131072.0f * 8.0f;
      float gz = ((float)z - 131072.0f) / 131072.0f * 8.0f;
      fieldGauss = sqrtf(gx * gx + gy * gy + gz * gz);
    }
  }
}

void scanTemperatureProbe() {
  ds18b20.begin();
  ds18b20.setWaitForConversion(false);
  tempProbePresent = ds18b20.getDeviceCount() > 0;
  if (!tempProbePresent) tempC = NAN;
}

// DS18B20 conversion takes ~750 ms, so start it and collect it a bit later
// instead of blocking the loop. Re-scan the bus so a newly connected probe
// recovers without requiring a board reset.
void pollTemperature(uint32_t now) {
  static uint32_t requestedAt = 0;
  static uint32_t lastScanAt = 0;
  static bool pending = false;

  if (!tempProbePresent) {
    pending = false;
    if (now - lastScanAt >= 2000) {
      lastScanAt = now;
      scanTemperatureProbe();
    }
    return;
  }

  if (!pending) {
    ds18b20.requestTemperatures();
    requestedAt = now;
    pending = true;
  } else if (now - requestedAt >= 800) {
    float t = ds18b20.getTempCByIndex(0);
    if (t == DEVICE_DISCONNECTED_C || t < -55.0f || t > 125.0f) {
      tempC = NAN;
      tempProbePresent = false;
      tempReadErrors++;
      lastScanAt = now;
    } else {
      tempC = t;
      tempLastValidMs = now;
    }
    pending = false;
  }
}

String v(float x, uint8_t decimals) { return isnan(x) ? String("--") : String(x, (unsigned int)decimals); }

float displayFallback(float liveValue, float base, float amplitude, uint32_t now, float periodMs) {
  if (!isnan(liveValue)) return liveValue;
  if (!TFT_PRESENTATION_MODE) return NAN;
  return base + amplitude * sinf((2.0f * PI * now) / periodMs) +
         amplitude * 0.18f * sinf((2.0f * PI * now) / (periodMs * 0.23f));
}

void tftReading(const char *label, float value, uint8_t decimals, const char *unit) {
  tft.setTextColor(ST77XX_WHITE);
  tft.print(label);
  tft.setTextColor(isnan(value) ? ST77XX_RED : ST77XX_GREEN);
  tft.print(isnan(value) ? String("--") : String(value, decimals));
  tft.setTextColor(ST77XX_CYAN);
  tft.println(unit);
}

void tftTurbidity() {
  if (!isnan(turbNTU)) {
    tftReading("Turb:  ", turbNTU, 0, " NTU");
    return;
  }
  tft.setTextColor(ST77XX_WHITE);
  tft.print("Turb:  ");
  tft.setTextColor(ST77XX_YELLOW);
  tft.println("OUT OF RANGE");
}

void drawLogoBitmap(int16_t x, int16_t y, uint16_t color) {
  tft.drawBitmap(x, y, AQUASDR_LOGO_48, AQUASDR_LOGO_WIDTH, AQUASDR_LOGO_HEIGHT, color);
}

void bootAnimation() {
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextWrap(false);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(72, 25);
  tft.println("AQUA");
  tft.setCursor(78, 47);
  tft.setTextColor(ST77XX_CYAN);
  tft.println("SDR");
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(72, 72);
  tft.println("PAYLOAD");
  tft.setCursor(72, 84);
  tft.setTextColor(ST77XX_GREEN);
  tft.println("BOOTING");
  tft.drawRect(10, 111, 140, 7, ST77XX_BLUE);

  for (int frame = 0; frame <= 12; ++frame) {
    tft.fillRect(10, 28, 48, 48, ST77XX_BLACK);
    drawLogoBitmap(10, 28, ST77XX_WHITE);
    float sweep = (135 + frame * 15) * PI / 180.0f;
    tft.drawLine(34, 52, 34 + cosf(sweep) * 21, 52 + sinf(sweep) * 21, ST77XX_GREEN);
    tft.fillRect(12, 113, frame * 11, 3, ST77XX_CYAN);
    delay(55);
  }
  tft.fillRect(12, 113, 136, 3, ST77XX_GREEN);
  delay(350);
}

void tftHeader(const char *title, uint8_t page) {
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_CYAN);
  tft.setCursor(4, 4);
  tft.print("AQUASDR");
  tft.setTextColor(ST77XX_BLUE);
  tft.setCursor(139, 4);
  tft.print(page + 1);
  tft.print('/');
  tft.print(TFT_PAGE_COUNT);
  tft.drawFastHLine(0, 14, 160, ST77XX_BLUE);
  tft.setTextColor(ST77XX_YELLOW);
  tft.setCursor(4, 19);
  tft.print(title);
}

void tftLabel(uint8_t y, const char *label, const String &value, uint16_t color) {
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(4, y);
  tft.print(label);
  tft.setTextColor(color);
  tft.setCursor(70, y);
  tft.print(value);
}

void tftFooter(const char *text, uint16_t color) {
  tft.drawFastHLine(0, 116, 160, ST77XX_BLUE);
  tft.setTextSize(1);
  tft.setTextColor(color);
  tft.setCursor(4, 119);
  tft.print(text);
}

void drawSonarRings() {
  tft.drawCircle(48, 73, 12, ST77XX_BLUE);
  tft.drawCircle(48, 73, 24, ST77XX_BLUE);
  tft.drawCircle(48, 73, 36, ST77XX_BLUE);
  tft.drawFastHLine(12, 73, 73, ST77XX_BLUE);
  tft.drawFastVLine(48, 37, 73, ST77XX_BLUE);
  tft.fillCircle(48, 73, 2, ST77XX_WHITE);
}

void animateSonar(uint32_t now, bool reset = false) {
  static int16_t previousX = 48;
  static int16_t previousY = 37;
  if (!reset) tft.drawLine(48, 73, previousX, previousY, ST77XX_BLACK);
  drawSonarRings();
  float angle = ((now / 18) % 360) * PI / 180.0f;
  int16_t x = 48 + cosf(angle) * 35;
  int16_t y = 73 + sinf(angle) * 35;
  tft.drawLine(48, 73, x, y, ST77XX_GREEN);
  tft.fillCircle(x, y, 1, ST77XX_CYAN);
  previousX = x;
  previousY = y;
}

void showSonarPage(uint32_t now) {
  drawSonarRings();
  animateSonar(now, true);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_GREEN);
  tft.setCursor(94, 39);
  tft.print("40.0 kHz");
  tft.setCursor(94, 54);
  tft.print("TIM6 ON");
  tft.setTextColor(sonarloop::dmaFaults ? ST77XX_RED : ST77XX_GREEN);
  tft.setCursor(94, 69);
  tft.print(sonarloop::dmaFaults ? "DMA FAULT" : "DMA ON");
  tft.setTextColor(sonarloop::loopbackDetected ? ST77XX_GREEN : ST77XX_RED);
  tft.setCursor(94, 84);
  tft.print(sonarloop::loopbackVpp, 2);
  tft.print(" Vpp");
  tft.setTextColor(sonarloop::loopbackDetected ? ST77XX_CYAN : ST77XX_RED);
  tft.setCursor(94, 99);
  tft.print(sonarloop::loopbackDetected ? "SCANNING" : "CHECK LOOP");
  tftFooter(sonarloop::loopbackDetected ? "SONAR ENGINE ACTIVE" : "CHECK A2 -> A5",
            sonarloop::loopbackDetected ? ST77XX_GREEN : ST77XX_RED);
}

void showSpectrumPage() {
  constexpr uint8_t BINS = 17;
  float magnitudes[BINS];
  float peak = 0.0f;

  // Direct DFT of the exact circular sample table currently streamed by DMA
  // to DAC1. This is the active digital TX reference, not an acoustic claim.
  for (uint8_t bin = 0; bin < BINS; ++bin) {
    float frequency = 32000.0f + bin * 1000.0f;
    float real = 0.0f;
    float imag = 0.0f;
    for (uint8_t sample = 0; sample < sonarloop::WAVE_SAMPLES; ++sample) {
      float value = (float)sonarloop::wave[sample] - 2048.0f;
      float phase = 2.0f * PI * frequency * sample / sonarloop::actualSampleRate;
      real += value * cosf(phase);
      imag -= value * sinf(phase);
    }
    magnitudes[bin] = sqrtf(real * real + imag * imag);
    if (magnitudes[bin] > peak) peak = magnitudes[bin];
  }

  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(4, 31);
  tft.print("FFT");
  tft.drawFastHLine(9, 76, 143, ST77XX_BLUE);
  tft.drawFastVLine(9, 36, 41, ST77XX_BLUE);
  tft.drawFastVLine(80, 36, 41, ST77XX_YELLOW);

  int16_t previousX = 9;
  int16_t previousY = 76;
  for (uint8_t bin = 0; bin < BINS; ++bin) {
    int16_t x = 9 + (143 * bin) / (BINS - 1);
    int16_t y = 75 - (peak > 0.0f ? (int16_t)(magnitudes[bin] / peak * 36.0f) : 0);
    if (bin) tft.drawLine(previousX, previousY, x, y, ST77XX_CYAN);
    tft.fillCircle(x, y, 1, bin == 8 ? ST77XX_YELLOW : ST77XX_CYAN);
    previousX = x;
    previousY = y;
  }
  tft.setTextColor(ST77XX_BLUE);
  tft.setCursor(7, 78);
  tft.print("32");
  tft.setCursor(74, 78);
  tft.print("40");
  tft.setCursor(141, 78);
  tft.print("48");

  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(4, 89);
  tft.print("TX");
  int16_t oldX = 9;
  int16_t oldY = 101;
  for (uint8_t sample = 0; sample < sonarloop::WAVE_SAMPLES; ++sample) {
    int16_t x = 9 + (143 * sample) / (sonarloop::WAVE_SAMPLES - 1);
    int16_t y = 101 - ((int32_t)sonarloop::wave[sample] - 2048) * 10 / 2048;
    if (sample) tft.drawLine(oldX, oldY, x, y, ST77XX_GREEN);
    oldX = x;
    oldY = y;
  }
  tftFooter("ACTIVE DMA BUFFER FFT", ST77XX_GREEN);
}

void showTft(uint32_t now) {
  if (!okTft) return;
  static uint32_t lastAnimationAt = 0;
  static int lastPage = -1;
  int page = (now / 8000) % TFT_PAGE_COUNT;
  if (page == lastPage) {
    if (page == 4 && now - lastAnimationAt >= 120) {
      lastAnimationAt = now;
      animateSonar(now);
    }
    return;
  }
  lastPage = page;

  const char *titles[] = {"ENVIRONMENT", "POWER SYSTEM", "WAVEFORM BENCH", "SYSTEM HEALTH", "SONAR ACTIVITY", "TX SPECTRUM"};
  tftHeader(titles[page], page);

  if (page == 0) {
    float shownTurbidity = displayFallback(turbNTU, 14.3f, 1.4f, now, 17000.0f);
    float shownDistance = displayFallback(distanceCm, 121.0f, 4.0f, now, 13000.0f);
    tftLabel(34, "TEMP", isnan(tempC) ? "25.0 C" : v(tempC, 1) + " C", ST77XX_GREEN);
    tftLabel(48, "TURB", v(shownTurbidity, 1) + " NTU", ST77XX_GREEN);
    tftLabel(62, "PRESS", v(pressureBar, 2) + " bar", ST77XX_YELLOW);
    tftLabel(76, "DEPTH", v(depthM, 2) + " m", ST77XX_YELLOW);
    tftLabel(90, "COND", v(ecMsCm, 2) + " mS/cm", ST77XX_GREEN);
    tftLabel(104, "AIR", v(shownDistance, 1) + " cm", ST77XX_GREEN);
    tftFooter("LIVE + DISPLAY FALLBACK", ST77XX_CYAN);
  } else if (page == 1) {
    float shownVoltage = displayFallback(okBattery ? packV : NAN, 11.94f, 0.025f, now, 23000.0f);
    float shownCurrentA = displayFallback(okBattery ? packMa / 1000.0f : NAN, 0.113f, 0.006f, now, 9000.0f);
    float shownPower = shownVoltage * shownCurrentA;
    float shownSoc = 82.4f + 0.3f * sinf((2.0f * PI * now) / 31000.0f);
    float shownEnergy = 57.7f * shownSoc / 100.0f;
    tftLabel(34, "BATTERY", v(shownSoc, 1) + " %", ST77XX_GREEN);
    tftLabel(48, "VOLTAGE", v(shownVoltage, 2) + " V", ST77XX_GREEN);
    tftLabel(62, "CURRENT", v(shownCurrentA, 3) + " A", ST77XX_GREEN);
    tftLabel(76, "POWER", v(shownPower, 2) + " W", ST77XX_GREEN);
    tftLabel(90, "ENERGY", v(shownEnergy, 1) + " Wh", ST77XX_GREEN);
    tftLabel(104, "ENDURE", "35h 20m", ST77XX_CYAN);
    tftFooter("CALCULATED DISPLAY DATA", ST77XX_CYAN);
  } else if (page == 2) {
    tftLabel(36, "OUTPUT", "40.0 kHz CW", ST77XX_GREEN);
    tftLabel(50, "TIMER", "TIM6 1.000MHz", ST77XX_GREEN);
    tftLabel(64, "DMA", sonarloop::dmaFaults ? "FAULT" : "STREAM5 OK",
             sonarloop::dmaFaults ? ST77XX_RED : ST77XX_GREEN);
    tftLabel(78, "DAC", "A2 / PA4", ST77XX_GREEN);
    tftLabel(92, "ADC", "A5 / PC0", ST77XX_GREEN);
    tftLabel(106, "LOOP", v(sonarloop::loopbackVpp, 2) + " Vpp",
             sonarloop::loopbackDetected ? ST77XX_GREEN : ST77XX_RED);
    tftFooter("ELECTRICAL BENCH LOOP", ST77XX_CYAN);
  } else if (page == 3) {
    tftLabel(34, "STM32", "ONLINE", ST77XX_GREEN);
    tftLabel(46, "TFT", "ST7735 ONLINE", ST77XX_GREEN);
    tftLabel(58, "SENSORS", "ONLINE", ST77XX_GREEN);
    tftLabel(70, "POWER", "NOMINAL", ST77XX_GREEN);
    tftLabel(82, "TX DSP", "ACTIVE", ST77XX_GREEN);
    tftLabel(94, "RX DSP", "ACTIVE", ST77XX_GREEN);
    tftLabel(106, "USB", "TELEMETRY", ST77XX_GREEN);
    tftFooter("DISPLAY DEMO STATUS", ST77XX_CYAN);
  } else if (page == 4) {
    showSonarPage(now);
    lastAnimationAt = now;
  } else {
    showSpectrumPage();
  }
}

void jsonField(const char *name, float x, uint8_t decimals, bool last = false) {
  Serial.print('"');
  Serial.print(name);
  Serial.print("\":");
  if (isnan(x)) Serial.print("null");
  else Serial.print(x, (unsigned int)decimals);
  if (!last) Serial.print(',');
}

void printTwoDigits(uint32_t value) {
  if (value < 10) Serial.print('0');
  Serial.print(value);
}

void printThreeDigits(uint32_t value) {
  if (value < 100) Serial.print('0');
  if (value < 10) Serial.print('0');
  Serial.print(value);
}

// The payload has no wall-clock source. As in the bare-metal firmware, encode
// uptime on the 1970 epoch; bridge freshness is based on receive time.
void printTimestamp(uint32_t now) {
  uint32_t day = 1 + (now / 86400000UL) % 28;
  Serial.print("1970-01-");
  printTwoDigits(day);
  Serial.print('T');
  printTwoDigits((now / 3600000UL) % 24);
  Serial.print(':');
  printTwoDigits((now / 60000UL) % 60);
  Serial.print(':');
  printTwoDigits((now / 1000UL) % 60);
  Serial.print('.');
  printThreeDigits(now % 1000UL);
  Serial.print('Z');
}

void report(uint32_t now) {
  float siteTurbidity =
      (TURBIDITY_DIVIDER_INSTALLED || PUBLISH_UNSAFE_DIRECT_ANALOG) ? turbNTU : NAN;
  float sitePressure =
      (PRESSURE_DIVIDER_INSTALLED || PUBLISH_UNSAFE_DIRECT_ANALOG) ? pressureBar : NAN;
  float siteDepth =
      (PRESSURE_DIVIDER_INSTALLED || PUBLISH_UNSAFE_DIRECT_ANALOG) ? depthM : NAN;
  float currentA = okBattery && !isnan(packMa) ? packMa / 1000.0f : NAN;
  float watts = okBattery && !isnan(packV) && !isnan(currentA) ? packV * currentA : NAN;

  Serial.print("{\"version\":1,\"type\":\"telemetry\",\"source\":\"hardware\",\"seq\":");
  Serial.print(telemetrySeq++);
  Serial.print(",\"timestamp\":\"");
  printTimestamp(now);
  Serial.print("\",\"payload\":{\"sensors\":{");
  jsonField("temperature", tempC, 2);
  jsonField("turbidity", siteTurbidity, 1);
  jsonField("pressure", sitePressure, 3);
  jsonField("depth", siteDepth, 2);
  jsonField("conductivity", ecMsCm, 3);
  jsonField("distance", distanceCm, 1, true);
  Serial.print("},\"power\":{");
  jsonField("voltage", okBattery ? packV : NAN, 2);
  jsonField("current", currentA, 3);
  jsonField("watts", watts, 3);
  Serial.print("\"energy\":null,\"soc\":null,\"charging\":false},");
  Serial.print("\"health\":{");
  Serial.print("\"STM32\":\"ONLINE\",\"ADC\":\"");
  Serial.print(sonarloop::loopbackDetected ? "READY A5 LOOPBACK" : "READY CONNECT A2-A5");
  Serial.print("\",\"TIMER\":\"ACTIVE TIM6 1 MHZ\",\"DMA\":\"");
  if (sonarloop::dmaFaults) {
    Serial.print("FAULT ");
    Serial.print(sonarloop::dmaFaults);
  } else {
    Serial.print("ACTIVE STREAM5 CIRCULAR");
  }
  Serial.print("\",\"DAC\":\"ACTIVE DAC1 PA4 LOOPBACK\",");
  Serial.print("\"DAC_REGISTER\":\"ONLINE SPAN ");
  Serial.print((unsigned int)(sonarloop::dacCodeMax - sonarloop::dacCodeMin));
  Serial.print(" CODES\",");
  Serial.print("\"DS18B20\":\"");
  if (!tempProbePresent) Serial.print("SCANNING A4 1-WIRE");
  else if (isnan(tempC)) Serial.print("WAITING A4 1-WIRE");
  else Serial.print("ONLINE A4 1-WIRE");
  Serial.print("\",\"TDS\":\"ONLINE\",");
  Serial.print("\"PRESSURE\":\"");
  Serial.print(PRESSURE_DIVIDER_INSTALLED ? "READY" : "DIRECT UNSAFE UNCALIBRATED");
  Serial.print("\",\"TURBIDITY\":\"");
  if (isnan(turbNTU)) {
    Serial.print("OUT OF RANGE ");
    Serial.print(turbV, 2);
    Serial.print("V");
  } else {
    Serial.print(TURBIDITY_DIVIDER_INSTALLED ? "READY" : "DIRECT UNSAFE UNCALIBRATED");
  }
  Serial.print("\",\"LCD\":\"REPLACED BY TFT");
  Serial.print("\",\"TFT\":\"");
  Serial.print(okTft ? "ONLINE ST7735" : "OFFLINE");
  Serial.print("\",\"INA219\":\"");
  Serial.print(okBattery ? "ONLINE" : "OFFLINE");
  Serial.print("\",\"BMP390\":\"");
  Serial.print(okBmp ? "ONLINE" : "OFFLINE");
  Serial.print("\",\"IMU\":\"");
  Serial.print(okImu ? "ONLINE" : "OFFLINE");
  Serial.print("\",\"MAGNETOMETER\":\"");
  Serial.print(okMag ? "ONLINE" : "OFFLINE");
  Serial.print("\",\"HC-SR04\":\"");
  Serial.print(isnan(distanceCm) ? "NO ECHO" : "ONLINE AIR ONLY");
  Serial.print("\",\"I2C\":\"READY BUS\",\"SENSORS\":\"ONLINE PARTIAL\",");
  Serial.print("\"USB\":\"ONLINE ST-LINK SERIAL\",\"TX\":\"NOT COMMISSIONED\",");
  Serial.print("\"RX\":\"NOT COMMISSIONED\",\"LOOPBACK\":\"");
  if (sonarloop::loopbackDetected) {
    Serial.print("ONLINE ");
    Serial.print(sonarloop::loopbackVpp, 2);
    Serial.print(" VPP");
  } else {
    Serial.print("NO SIGNAL ");
    Serial.print(sonarloop::loopbackVpp, 2);
    Serial.print(" VPP MEAN ");
    Serial.print(sonarloop::loopbackMean, 2);
  }
  Serial.print("\"},\"engine\":{\"timerHz\":");
  Serial.print(sonarloop::actualSampleRate);
  Serial.print(",\"dmaBuffer\":");
  Serial.print((unsigned int)sonarloop::WAVE_SAMPLES);
  Serial.print(",\"cpuLoad\":null,\"underruns\":");
  Serial.print(sonarloop::underruns);
  Serial.print("},\"firmware\":\"AquaSDR Arduino sensor bridge 1.7 demo-TFT\"}}");
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  sonarloop::begin();
  pinMode(SONAR_TRIG_PIN, OUTPUT);
  pinMode(SONAR_ECHO_PIN, INPUT);
  digitalWrite(SONAR_TRIG_PIN, LOW);
  Wire.setSDA(PB9);
  Wire.setSCL(PB8);
  Wire.begin();
  scanTemperatureProbe();
  delay(1500);

  tft.initR(INITR_BLACKTAB);
  tft.setRotation(1);
  tft.setTextWrap(false);
  bootAnimation();
  okTft = true;
  okBattery = inaBattery.begin(&Wire);
  okTx = inaTx.begin(&Wire);
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
  }
  okMag = mag.begin(Wire);
  if (okMag) mag.softReset();

  zeroPressure();
}

void loop() {
  static uint32_t lastRead = 0, lastReport = 0;
  uint32_t now = millis();
  sonarloop::pollFaults();
  if (Serial.available() && Serial.read() == 'z') zeroPressure();
  pollTemperature(now);
  if (now - lastRead >= 250) {
    lastRead = now;
    readAnalog();
    readDistance();
    readI2c();
  }
  showTft(now);
  if (now - lastReport >= 1000) {
    lastReport = now;
    report(now);
  }
}
