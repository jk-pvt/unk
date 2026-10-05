// Conversions from sensor voltages to physical values. Pure functions, no
// hardware access, so they can be checked on a PC.
#pragma once
#include <math.h>

namespace sensormath {

constexpr float ADC_VREF = 3.3f;
constexpr float DIVIDER_GAIN = 1.5f;  // 10k over 20k divider: sensor V = ADC V x 1.5

// DFRobot analog water pressure sensor: 0.5-4.5 V = 0-1.6 MPa (gauge).
// zeroV is the reading at atmospheric pressure, taken at start-up, because
// every unit's offset differs a little.
inline float pressureGaugeMPa(float sensorV, float zeroV) {
  float mpa = (sensorV - zeroV) * (1.6f / 4.0f);
  return mpa < 0.0f ? 0.0f : mpa;
}
inline float gaugeBar(float mpa) { return mpa * 10.0f; }
// Fresh-water depth from gauge pressure: depth = P / (rho * g).
inline float depthMetres(float mpa) { return mpa * 1e6f / (1000.0f * 9.80665f); }
constexpr float ATMOSPHERE_BAR = 1.01325f;

// DFRobot SEN0189 turbidity, sensor voltage to NTU. This is DFRobot's
// published curve: clear water reads about 4.1-4.2 V and the reading falls as
// the water gets murkier. Below 2.5 V the curve cannot distinguish extremely
// turbid water, an out-of-water probe, or a wiring fault, so report no reading
// instead of presenting the 3000 NTU saturation value as a measurement.
inline float turbidityNTU(float sensorV) {
  if (!isfinite(sensorV) || sensorV < 2.5f || sensorV > 4.5f) return NAN;
  float ntu = -1120.4f * sensorV * sensorV + 5742.3f * sensorV - 4352.9f;
  return ntu < 0.0f ? 0.0f : ntu;
}

// DFRobot Gravity analog TDS: temperature-compensated cubic, result in ppm.
inline float tdsPpm(float sensorV, float tempC) {
  float compensated = sensorV / (1.0f + 0.02f * (tempC - 25.0f));
  return (133.42f * compensated * compensated * compensated - 255.86f * compensated * compensated +
          857.39f * compensated) *
         0.5f;
}
// TDS = 0.5 x conductivity (uS/cm), the usual conversion for this probe.
inline float conductivityMsPerCm(float ppm) { return ppm * 2.0f / 1000.0f; }

}  // namespace sensormath
