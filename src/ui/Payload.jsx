import React from "react";
import { bounds, box, camera, hull, path, ringX, ringZ } from "./geo.js";

/* AQUASDR payload: a plain transparent cylinder with flat end plates,
   rail-mounted electronics, the battery section, end-plate sensor
   penetrators and the external 40 kHz TX/RX piezo pair underneath.
   Geometry is static; state only changes colours (LED, charge bar) and
   the TX ping marks, which appear only while the transmitter is active. */

const EX = [1, 0],
  EY = [-0.3, 0.3];
const R = 46,
  L = 330,
  PT = 9,
  PR = R + 7;
const P0 = camera(EX, EY);
const allPts = [...ringX(P0, -PT, 0, 0, PR), ...ringX(P0, L + PT, 0, 0, PR), P0(L + 40, 0, 0), ...ringZ(P0, 264, 0, -R - 46, 36)];
const [BX, BY, BW, BH] = bounds(allPts, 4);

const TZ = -12;
function geometry(P) {
  const f = (n) => n.toFixed(1);
  const g = {};
  g.shadow = P(L / 2, 0, -R - 26);
  g.plateL = path(hull([...ringX(P, -PT, 0, 0, PR), ...ringX(P, 0, 0, 0, PR)]));
  g.tubeBack = path(hull([...ringX(P, 0, 0, 0, R), ...ringX(P, L, 0, 0, R)]));
  g.innerL = path(ringX(P, 0.5, 0, 0, R - 2));
  const rail = (y) => path([P(6, y, TZ - 4), P(L - 6, y, TZ - 4)], false);
  g.railB = rail(-27);
  g.railF = rail(27);
  const tray = box(P, 14, -32, TZ - 2, L - 14, 32, TZ);
  g.tray = path(tray.top);
  g.trayEdge = path(tray.front);
  const bat = box(P, 22, -24, TZ, 128, 24, TZ + 32);
  g.bat = { top: path(bat.top), front: path(bat.front), right: path(bat.right) };
  g.batBar = (lv) => path([P(30, 24.2, TZ + 12), P(30 + 90 * lv, 24.2, TZ + 12), P(30 + 90 * lv, 24.2, TZ + 19), P(30, 24.2, TZ + 19)]);
  g.batBarBg = path([P(30, 24.2, TZ + 12), P(120, 24.2, TZ + 12), P(120, 24.2, TZ + 19), P(30, 24.2, TZ + 19)]);
  
  const buck = box(P, 136, -16, TZ, 162, 16, TZ + 3);
  const ind = box(P, 142, -8, TZ + 3, 154, 6, TZ + 12);
  g.buck = [buck.top, buck.front, ind.top, ind.front, ind.right].map((q) => path(q));
  const mcu = box(P, 170, -25, TZ, 264, 25, TZ + 3);
  const chip = box(P, 208, -9, TZ + 3, 226, 9, TZ + 6);
  const hdrA = box(P, 176, -23, TZ + 3, 258, -18, TZ + 10);
  const hdrB = box(P, 176, 18, TZ + 3, 258, 23, TZ + 10);
  const usb = box(P, 170, -6, TZ + 3, 180, 6, TZ + 9);
  g.mcu = { board: path(mcu.top), edge: path(mcu.front), chip: [path(chip.top), path(chip.front)], hdr: [hdrA, hdrB].flatMap((h) => [path(h.top), path(h.front)]), usb: [path(usb.top), path(usb.front)] };
  g.led = P(246, 11, TZ + 3.5);
  const amp = box(P, 272, -20, TZ, 316, 20, TZ + 3);
  const c1 = box(P, 280, -12, TZ + 3, 292, 0, TZ + 7);
  const c2 = box(P, 298, 3, TZ + 3, 310, 15, TZ + 7);
  g.amp = [amp.top, amp.front, c1.top, c1.front, c2.top, c2.front].map((q) => path(q));
  const cable = (a, b, lift) => `M${f(a[0])} ${f(a[1])} C${f(a[0] + 14)} ${f(a[1] - lift)} ${f(b[0] - 14)} ${f(b[1] - lift)} ${f(b[0])} ${f(b[1])}`;
  g.wires = [cable(P(128, 8, TZ + 22), P(142, 10, TZ + 3), 14), cable(P(162, 4, TZ + 2), P(176, -2, TZ + 4), 10), cable(P(264, 6, TZ + 3), P(278, 6, TZ + 3), 8), cable(P(316, -6, TZ + 3), P(L - 2, -18, 16), 22)];
  // glass tube highlights
  const line = (a, x0 = 8, x1 = L - 8) => path([P(x0, R * Math.cos(a), R * Math.sin(a)), P(x1, R * Math.cos(a), R * Math.sin(a))], false);
  g.hiTop = line((100 * Math.PI) / 180);
  g.hiTop2 = line((80 * Math.PI) / 180, 40, L - 60);
  g.hiLow = line((-120 * Math.PI) / 180);
  g.tubeFront = g.tubeBack;
  // transducers (under the tube) + straps
  g.xd = [
    [238, "TX"],
    [290, "RX"],
  ].map(([x, id]) => {
    const top = -R - 4,
      bot = -R - 18,
      r = 11;
    return {
      id,
      strap: (() => { const q = ringX(P, x, 0, 0, R + 1.5); return path(q.slice(23, 38), false); })(),
      stem: path([P(x, 0, -R), P(x, 0, top)], false),
      body: path(hull([...ringZ(P, x, 0, top, r), ...ringZ(P, x, 0, bot, r)])),
      cap: path(ringZ(P, x, 0, top, r)),
      face: path(ringZ(P, x, 0, bot, r).slice(0, 21), false),
      pings: [1, 2, 3].map((k) => path(ringZ(P, x, 0, bot - 8 * k, r + 9 * k))),
      c: P(x, 0, bot),
    };
  });
  g.xdCable = cable(P(290, 0, -R - 6), P(L, -10, -R + 4), -10);
  // right end plate (flat), bolts, penetrators
  g.plateR = path(hull([...ringX(P, L, 0, 0, PR), ...ringX(P, L + PT, 0, 0, PR)]));
  g.plateFace = path(ringX(P, L + PT, 0, 0, PR));
  g.plateRim = path(ringX(P, L + PT, 0, 0, PR - 4));
  g.bolts = ringX(P, L + PT, 0, 0, PR - 3.5, 8);
  const probe = (y, z, r, len) => ({
    body: path(hull([...ringX(P, L + PT, y, z, r, 20), ...ringX(P, L + PT + len, y, z, r, 20)])),
    tip: path(ringX(P, L + PT + len, y, z, r, 20)),
  });
  g.probes = [probe(15, 20, 2.4, 28), probe(-20, -16, 5.5, 9), probe(18, -20, 3.4, 20), probe(-18, 18, 4.2, 12), probe(0, 0, 5, 7)];
  g.pts = {
    tube: P(60, 0, R),
    bat: P(74, 0, TZ + 32),
    buck: P(148, 0, TZ + 12),
    mcu: P(217, 0, TZ + 6),
    amp: P(300, 0, TZ + 5),
    probes: P(L + 30, 15, 20),
    xd: P(264, 0, -R - 18),
  };
  return g;
}

const G = geometry(camera(EX, EY, -BX, -BY));
const DX = 110,
  DY = 60;
const GD = geometry(camera(EX, EY, -BX + DX, -BY + DY));

const CALLOUTS = [
  ["tube", "Acrylic housing", "up", 0.1],
  ["bat", "3S2P Li-ion · 11.1 V", "up", 0.34],
  ["mcu", "NUCLEO-F446RE", "up", 0.6],
  ["probes", "Sensor penetrators", "up", 0.88],
  ["buck", "MP1584 · 5 V", "down", 0.2],
  ["amp", "TLV9062 analog · piezo driver TBD", "down", 0.5],
  ["xd", "TX / RX piezo · 40 kHz", "down", 0.82],
];

export function Payload({ tx = false, led = "muted", soc, detail = false, parts = {}, beam = false }) {
  const g = detail ? GD : G;
  const W = detail ? BW + DX * 2 : BW,
    H = detail ? BH + DY * 2 : BH;
  const lv = Number.isFinite(soc) ? Math.max(0, Math.min(1, soc)) : null;
  return (
    <svg className={"payload" + (detail ? " pl-detail" : "")} viewBox={`0 0 ${W.toFixed(0)} ${H.toFixed(0)}`} role="img" aria-label="AQUASDR payload: transparent cylindrical housing, internal electronics, battery, end-plate sensors and external TX/RX transducers">
      <defs>
        <linearGradient id="plTube" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e5e5e5" stopOpacity=".14" />
          <stop offset=".35" stopColor="#c3c3c3" stopOpacity=".04" />
          <stop offset=".8" stopColor="#9f9f9f" stopOpacity=".05" />
          <stop offset="1" stopColor="#e5e5e5" stopOpacity=".12" />
        </linearGradient>
        <linearGradient id="plMetal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#949494" />
          <stop offset=".5" stopColor="#434343" />
          <stop offset="1" stopColor="#1f1f1f" />
        </linearGradient>
        <linearGradient id="plFace" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#777777" />
          <stop offset="1" stopColor="#2b2b2b" />
        </linearGradient>
        <radialGradient id="plShadow">
          <stop offset="0" stopColor="#000" stopOpacity=".65" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <filter id="plBlur" x="-10%" y="-50%" width="120%" height="200%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        <filter id="plGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <ellipse cx={g.shadow[0]} cy={g.shadow[1]} rx={BW * 0.46} ry={16} fill="url(#plShadow)" />
      <path d={g.plateL} fill="url(#plMetal)" className="pl-plate" />
      <path d={g.tubeBack} className="pl-tube-back" />
      <path d={g.innerL} className="pl-inner" />
      <path d={g.railB} className="pl-rail back" />
      <path d={g.tray} className="pl-tray" />
      <path d={g.trayEdge} className="pl-tray-edge" />
      {/* battery section */}
      <path d={g.bat.top} className="pl-bat top" />
      <path d={g.bat.front} className="pl-bat front" />
      <path d={g.bat.right} className="pl-bat side" />
      <path d={g.batBarBg} className="pl-bar-bg" />
      {lv != null && <path d={g.batBar(lv)} className="pl-bar" />}
      {/* power, compute, analog */}
      {g.buck.map((d, i) => (
        <path key={i} d={d} className={"pl-pcb" + (i === 1 || i === 3 ? " edge" : i > 1 ? " part" : "")} />
      ))}
      <path d={g.mcu.board} className="pl-pcb mcu" />
      <path d={g.mcu.edge} className="pl-pcb edge" />
      {g.mcu.hdr.map((d, i) => (
        <path key={i} d={d} className={"pl-hdr" + (i % 2 ? " edge" : "")} />
      ))}
      {g.mcu.usb.map((d, i) => (
        <path key={i} d={d} className={"pl-usb" + (i ? " edge" : "")} />
      ))}
      {g.mcu.chip.map((d, i) => (
        <path key={i} d={d} className={"pl-chip" + (i ? " edge" : "")} />
      ))}
      <circle cx={g.led[0]} cy={g.led[1]} r="3.2" className={"pl-led l-" + led} filter="url(#plGlow)" />
      <circle cx={g.led[0]} cy={g.led[1]} r="1.4" className={"pl-led l-" + led} />
      {g.amp.map((d, i) => (
        <path key={i} d={d} className={"pl-pcb" + (i % 2 ? " edge" : i ? " part" : "")} />
      ))}
      {g.wires.map((d, i) => (
        <path key={i} d={d} className={"pl-wire w" + i} />
      ))}
      <path d={g.railF} className="pl-rail" />
      {/* glass */}
      <path d={g.tubeFront} fill="url(#plTube)" className="pl-tube" />
      <path d={g.hiTop} className="pl-hi" filter="url(#plBlur)" />
      <path d={g.hiTop2} className="pl-hi thin" />
      <path d={g.hiLow} className="pl-hi low" />
      {/* external transducers */}
      <path d={g.xdCable} className="pl-xcable" />
      {g.xd.map((x) => (
        <g key={x.id} className={"pl-xd" + (x.id === "TX" && tx ? " tx" : "")}>
          <path d={x.strap} className="pl-strap" />
          <path d={x.stem} className="pl-stem" />
          <path d={x.body} className="pl-puck" />
          <path d={x.cap} className="pl-puck-cap" />
          <path d={x.face} className="pl-puck-face" />
          {x.id === "TX" && beam && (() => {
            const [cx, cy] = x.c,
              len = 360,
              w = len * 0.3;
            return (
              <g className={"pl-beam" + (tx ? " on" : "")} aria-hidden="true">
                <defs>
                  <linearGradient id="plBeamG" gradientUnits="userSpaceOnUse" x1={cx} y1={cy} x2={cx} y2={cy + len}>
                    <stop offset="0" stopColor="#63cfc6" stopOpacity=".2" />
                    <stop offset="1" stopColor="#63cfc6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`M${cx - 7} ${cy} L${cx - w} ${cy + len} L${cx + w} ${cy + len} L${cx + 7} ${cy} Z`} fill="url(#plBeamG)" />
                <path className="pl-guide" d={`M${cx} ${cy + 4} V${cy + len}`} />
              </g>
            );
          })()}
          {x.id === "TX" && tx && x.pings.map((d, i) => <path key={i} d={d} className="pl-ping" style={{ animationDelay: i * 0.45 + "s" }} />)}
        </g>
      ))}
      {/* right end plate + penetrators */}
      <path d={g.plateR} fill="url(#plMetal)" className="pl-plate" />
      <path d={g.plateFace} fill="url(#plFace)" className="pl-face" />
      <path d={g.plateRim} className="pl-rim" />
      {g.bolts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.5" className="pl-bolt" />
      ))}
      {g.probes.map((p, i) => (
        <g key={i}>
          <path d={p.body} className="pl-probe" />
          <path d={p.tip} className="pl-probe-tip" />
        </g>
      ))}
      {detail &&
        CALLOUTS.map(([k, text, dir, fx]) => {
          const [x, y] = g.pts[k];
          const ty = dir === "up" ? 20 : H - 12;
          const tx2 = W * fx;
          const st = parts[k];
          return (
            <g key={k} className="pl-callout">
              <path d={`M${x.toFixed(1)} ${y.toFixed(1)} L${x.toFixed(1)} ${(dir === "up" ? ty + 16 : ty - 22).toFixed(1)} L${tx2.toFixed(1)} ${(dir === "up" ? ty + 16 : ty - 22).toFixed(1)} L${tx2.toFixed(1)} ${(dir === "up" ? ty + 8 : ty - 14).toFixed(1)}`} />
              <circle cx={x} cy={y} r="2.4" />
              <text x={tx2} y={ty} textAnchor="middle">
                {st && <tspan className={"pl-st s-" + st}>● </tspan>}
                {text}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
