import { PACK } from './signal.js';
export function derivePower(power = {}) {
  const soc = Number.isFinite(power.soc) ? Math.max(0, Math.min(1, power.soc)) : null;
  const charging = power.charging === true || (Number.isFinite(power.current) && power.current < -0.002);
  const remaining = soc === null ? null : soc * PACK.capacityWh;
  const endurance = remaining !== null && Number.isFinite(power.watts) && power.watts > 0 && !charging ? remaining / power.watts : null;
  const critical = soc !== null && soc <= .08;
  const low = soc !== null && soc < .2;
  // 3S Li-ion limits: above 4.27 V/cell is over-charge; below 3.2 V/cell the
  // pack is nearly empty, below 3.5 V/cell it is low.
  const status = power.source==='estimate' ? 'ESTIMATE' : !Number.isFinite(power.voltage) ? 'UNAVAILABLE' : power.voltage > 12.8 ? 'OVERVOLTAGE' : critical || power.voltage < 9.6 ? 'CRITICAL' : low || power.voltage < 10.5 ? 'LOW POWER' : charging ? 'CHARGING' : 'NOMINAL';
  return { soc, remaining, endurance, charging, critical, low, status };
}
// Typical resting Li-ion cell voltage vs state of charge (piecewise linear).
const CELL_CURVE = [[0, 3.0], [0.1, 3.45], [0.2, 3.6], [0.5, 3.75], [0.8, 3.95], [1, 4.2]];
export function packVoltage(soc) {
  const s = Math.max(0, Math.min(1, soc));
  let i = 1;
  while (i < CELL_CURVE.length - 1 && s > CELL_CURVE[i][0]) i++;
  const [s0, v0] = CELL_CURVE[i - 1], [s1, v1] = CELL_CURVE[i];
  return 3 * (v0 + ((v1 - v0) * (s - s0)) / (s1 - s0));
}
export function batteryPreview(level, charging = false) {
  const soc = Math.max(0, Math.min(1, level));
  const voltage = packVoltage(soc);
  const current = charging ? -.45 : .114;
  return { soc, voltage, current, watts: voltage * current, charging };
}

// Operational power estimate used only when no INA219 measurement is present.
// It is kept separate from `power` so callers cannot mistake it for telemetry.
export function modelOperatingPower(config = {}, elapsed = 0) {
  const pulse = Number.isFinite(config.pulse) ? config.pulse : 2;
  const amplitude = Number.isFinite(config.amplitude) ? config.amplitude : 62;
  const bandwidth = Number.isFinite(config.bandwidth) ? config.bandwidth : 2;
  const duty = Math.min(0.5, (pulse / 1000) * 10);
  const current = 0.105 + (amplitude / 100) ** 2 * duty * 0.9 + bandwidth * 0.0004;
  const soc = Math.max(0.15, 0.824 - elapsed * current / (PACK.capacityAh * 3600));
  const voltage = packVoltage(soc);
  return {
    voltage,
    current,
    watts: voltage * current,
    soc,
    energy: (voltage * current * elapsed) / 3600,
    source: "model",
  };
}

// Planning estimate only; no invented SOC, battery depletion or measured load.
// Assumptions: 105 mA electronics, 10 pings/s, nominal pack voltage; a
// hypothetical driver adds amplitude² × duty load while reference pulses run.
export function estimateOperatingPower(config = {}, active = false) {
  const duty=active ? Math.min(.5, (config?.pulse || 2)/1000*10) : 0;
  const current=.105 + .9*((config?.amplitude || 0)/100)**2*duty;
  return {source:'estimate',voltage:PACK.nominal,current,watts:PACK.nominal*current,
    soc:null,energy:null,assumptions:'105 mA electronics · 10 pings/s · hypothetical driver load'};
}

// A battery planning scenario, never an INA219 reading or a measured SOC.
// Integrate the deterministic load ripple in Ah; energy uses nominal voltage.
export function batteryScenario(config={},elapsed=0,active=false) {
  const t=Number.isFinite(elapsed)?Math.max(0,elapsed):0;
  const base=estimateOperatingPower(config,active).current;
  const current=base+.006*Math.sin(.9*t)+.002*Math.sin(.23*t);
  const consumedAh=(base*t+.006/.9*(1-Math.cos(.9*t))+.002/.23*(1-Math.cos(.23*t)))/3600;
  const soc=Math.max(0,.824-consumedAh/PACK.capacityAh);
  const voltage=Math.max(PACK.empty,packVoltage(soc)-current*.18+.006*Math.sin(.31*t));
  return {source:'scenario',soc,voltage,current,watts:voltage*current,
    energy:consumedAh*PACK.nominal,charging:false,
    assumptions:'82.4% starting charge · selected load held over session time · deterministic load ripple'};
}
