// Seed the preview display from an existing RX-derived envelope. These
// columns are a display initialization, not captured historical pings.
export function seedReferenceEcho(echo, columns=239) {
  if(!echo?.length || !Array.from(echo).every(Number.isFinite)) return [];
  const count=Math.max(0,Math.min(239,Math.floor(columns)));
  return Array.from({length:count},()=>Array.from(echo));
}
