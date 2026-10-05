import React, { useMemo } from "react";
import { bounds, box, camera, hull, path, ringX } from "./geo.js";
import { useTween } from "./kit.jsx";

/* Technical render of the team's 3S2P Li-ion pack (6 × 18650 cells, three
   series groups of two in parallel, 11.1 V / 5.2 Ah). Charge is drawn as a glowing fill running the
   length of every cell; the strap/lead dashes move only while current flows.
   With no data the cells are hatched and nothing moves. */

const EX = [0.93, 0.26],
  EY = [-0.62, 0.34];
const R = 11,
  X0 = 8,
  X1 = 88,
  CW = 98,
  H = 38,
  YC = [12, 36, 60, 84, 108, 132],
  W = 144,
  ZC = 19;
const P0 = camera(EX, EY);
const [BX, BY, BW, BH] = bounds([...Object.values(box(P0, 0, 0, 0, CW, W, H)).flat(), P0(CW + 56, 96, 0), P0(CW + 56, 60, 14), P0(CW / 2, W, -10)], 6);
const P = camera(EX, EY, -BX, -BY);

// static geometry
const CASE = box(P, 0, 0, 0, CW, W, H);
const CELLS = YC.map((yc) => {
  const far = ringX(P, X0, yc, ZC, R),
    near = ringX(P, X1, yc, ZC, R);
  return {
    body: path(hull([...far, ...near])),
    cap: path(near),
    capIn: path(ringX(P, X1 + 0.5, yc, ZC, R * 0.62)),
    term: path(ringX(P, X1 + 1, yc, ZC, R * 0.28)),
    shine: path([P(X0 + 6, yc - R * 0.35, ZC + R * 0.93), P(X1 - 4, yc - R * 0.35, ZC + R * 0.93)], false),
  };
});
const CAPC = YC.map((yc) => P(X1 + 1, yc, ZC));
const f = (n) => n.toFixed(1);
const lead = (a, b, bend) => `M${f(a[0])} ${f(a[1])} C${f(a[0] + bend)} ${f(a[1])} ${f(b[0] - 10)} ${f(b[1] - 18)} ${f(b[0])} ${f(b[1])}`;
const CONN = box(P, CW + 32, 62, 0, CW + 54, 94, 14);
const LEAD_P = lead(CAPC[0], P(CW + 34, 70, 9), 30);
const LEAD_N = lead(CAPC[5], P(CW + 34, 86, 9), 20);
// nickel strips joining each parallel pair
const STRIPS = [path([CAPC[0], CAPC[1]], false), path([CAPC[2], CAPC[3]], false), path([CAPC[4], CAPC[5]], false)];
const TOP = P(0, 0, H);
const GRAD_A = P(X0, 70, ZC),
  GRAD_B = P(X1, 70, ZC);
const SHADOW = P(CW / 2 + 10, W / 2, 0);
const EDGE_NEAR =
  path([P(0, W, H), P(CW, W, H), P(CW, 0, H)], false) +
  path([P(CW, W, H), P(CW, W, 0)], false) +
  path([P(0, W, 0), P(CW, W, 0), P(CW, 0, 0)], false);
const EDGE_FAR = path([P(0, W, 0), P(0, W, H), P(0, 0, H), P(CW, 0, H)], false) + path([P(CW, 0, H), P(CW, 0, 0)], false);

export function Battery({ soc, current, low = false, size = "md", label = false }) {
  const known = Number.isFinite(soc);
  const lv = useTween(known ? Math.max(0, Math.min(1, soc)) : NaN, 900);
  const flowing = known && Number.isFinite(current) && current > 0.005;
  const tone = !known ? "none" : low ? "low" : "ok";
  const dur = flowing ? Math.min(3.2, Math.max(0.6, 0.22 / current)) : 0;
  const fills = useMemo(() => {
    if (!Number.isFinite(lv)) return null;
    const xs = X0 + 2 + (X1 - X0 - 4) * lv;
    return YC.map((yc) => ({
      body: path(hull([...ringX(P, X0 + 2, yc, ZC, R * 0.78, 28), ...ringX(P, xs, yc, ZC, R * 0.78, 28)])),
      edge: path(ringX(P, xs, yc, ZC, R * 0.78, 28)),
    }));
  }, [lv]);
  return (
    <svg
      className={"battery bt-" + tone + " bt-" + size}
      viewBox={`0 0 ${BW.toFixed(0)} ${BH.toFixed(0)}`}
      role="img"
      aria-label={known ? `3S2P Li-ion pack, ${(soc * 100).toFixed(1)} percent state of charge` : "3S2P Li-ion pack, state of charge unavailable"}
    >
      <defs>
        <linearGradient id="btLevel" gradientUnits="userSpaceOnUse" x1={GRAD_A[0]} y1={GRAD_A[1]} x2={GRAD_B[0]} y2={GRAD_B[1]}>
          <stop offset="0" stopColor="currentColor" stopOpacity=".3" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".95" />
        </linearGradient>
        <linearGradient id="btCell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#323232" />
          <stop offset=".45" stopColor="#151515" />
          <stop offset="1" stopColor="#0b0b0b" />
        </linearGradient>
        <linearGradient id="btGlass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#dddddd" stopOpacity=".11" />
          <stop offset=".5" stopColor="#dddddd" stopOpacity=".025" />
          <stop offset="1" stopColor="#dddddd" stopOpacity=".07" />
        </linearGradient>
        <radialGradient id="btShadow">
          <stop offset="0" stopColor="#000" stopOpacity=".75" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <pattern id="btHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(202, 202, 202,.14)" strokeWidth="1.6" />
        </pattern>
        <filter id="btGlow" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
      </defs>
      <ellipse cx={SHADOW[0]} cy={SHADOW[1]} rx={BW * 0.44} ry={BH * 0.16} fill="url(#btShadow)" />
      <path className="bt-back" d={path(CASE.bottom)} />
      <path className="bt-back" d={path(CASE.back)} />
      <path className="bt-back" d={path(CASE.left)} />
      {CELLS.map((c, i) => (
        <g key={i}>
          <path d={c.body} fill="url(#btCell)" className="bt-cellbody" />
          {fills ? (
            <>
              <path d={fills[i].body} className="bt-lvl-glow" filter="url(#btGlow)" />
              <path d={fills[i].body} fill="url(#btLevel)" />
              <path d={fills[i].edge} className="bt-lvl-edge" />
            </>
          ) : (
            <path d={c.body} fill="url(#btHatch)" />
          )}
          <path d={c.shine} className="bt-shine" />
          <path d={c.cap} className="bt-cap" />
          <path d={c.capIn} className="bt-capin" />
          <path d={c.term} className="bt-term" />
        </g>
      ))}
      {STRIPS.map((d, i) => (
        <path key={i} d={d} className="bt-strap" />
      ))}
      <path d={LEAD_P} className="bt-wire pos" />
      <path d={LEAD_N} className="bt-wire neg" />
      {flowing && (
        <g className="bt-flow" style={{ animationDuration: dur + "s" }}>
          <path d={LEAD_P} />
          <path d={LEAD_N} />
          {STRIPS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      )}
      <path className="bt-conn" d={path(CONN.top)} />
      <path className="bt-conn s" d={path(CONN.front)} />
      <path className="bt-conn s2" d={path(CONN.right)} />
      <path className="bt-glass" d={path(CASE.front)} fill="url(#btGlass)" />
      <path className="bt-glass" d={path(CASE.right)} fill="url(#btGlass)" />
      <path className="bt-glass" d={path(CASE.top)} fill="url(#btGlass)" />
      <path className="bt-edge" d={EDGE_NEAR} />
      <path className="bt-edge soft" d={EDGE_FAR} />
      {label && (
        <text className="bt-label" transform={`matrix(${EX[0]} ${EX[1]} ${EY[0]} ${EY[1]} ${f(TOP[0])} ${f(TOP[1])})`} x="12" y={W - 10}>
          3S2P Li-ion · 11.1 V · 5.2 Ah
        </text>
      )}
    </svg>
  );
}
