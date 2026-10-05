import React, { useEffect, useRef, useState } from "react";

export const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
export const clock = (s) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), Math.floor(s % 60)]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
export const stamp = (s) =>
  new Date(s).toLocaleTimeString("en-GB", { hour12: false });

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Number that interpolates to its new value (state change, not decoration). */
export function Num({ value, digits = 1, duration = 380, className = "" }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(value) || !Number.isFinite(from.current) || reduced()) {
      from.current = value;
      setShown(value);
      return;
    }
    const a = from.current,
      b = value,
      t0 = performance.now();
    cancelAnimationFrame(raf.current);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (b - a) * e;
      from.current = v;
      setShown(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <span className={"num " + className}>{fmt(shown, digits)}</span>;
}

/** Tweened scalar for drawings (SVG geometry that follows a state change). */
export function useTween(value, duration = 600) {
  const [v, setV] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    if (!Number.isFinite(value) || !Number.isFinite(cur.current) || reduced()) {
      cur.current = value;
      setV(value);
      return;
    }
    const a = cur.current,
      t0 = performance.now();
    let raf = 0;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration),
        e = 1 - Math.pow(1 - k, 3);
      cur.current = a + (value - a) * e;
      setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return v;
}

/** Provenance chip. kind: demo | live | playback | model | target | measured | estimate | computed | unavailable | simulated */
export function Src({ kind, children }) {
  // Reference/model context belongs in the workspace title, rather than
  // repeating badges on every numerical result.
  if(['demo','simulated','model','target','estimate','computed'].includes(kind)) return null;
  const text =
    children ||
    {
      demo: "COMPUTED",
      simulated: "SIMULATED",
      live: "LIVE",
      playback: "PLAYBACK",
      model: "CALCULATED",
      target: "TARGET",
      measured: "MEASURED",
      estimate: "ESTIMATE",
      computed: "COMPUTED",
      unavailable: "UNAVAILABLE",
    }[kind];
  return <span className={"src src-" + kind}>{text}</span>;
}

export function Dot({ tone = "muted", pulse = false }) {
  return <i className={"dot dot-" + tone + (pulse ? " dot-pulse" : "")} />;
}

export const healthTone = (v, demo) =>
  !v
    ? "muted"
    : demo || /simulated|demo/i.test(v)
      ? "amber"
      : /fault|error|offline/i.test(v)
        ? "red"
        : /ready|active|ok|online|live/i.test(v)
          ? "ok"
          : "muted";

export function Label({ children, right }) {
  return (
    <div className="lbl">
      <span>{children}</span>
      {right && <span className="lbl-r">{right}</span>}
    </div>
  );
}

export function Empty({ icon: Icon, title, text, children }) {
  return (
    <div className="empty">
      {Icon && <Icon size={28} strokeWidth={1} />}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
