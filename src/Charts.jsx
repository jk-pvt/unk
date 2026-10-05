import React, { useEffect, useMemo, useRef } from "react";
import { echoProfile, generateSignal, spectrum, SAMPLE_RATE } from "../shared/signal.js";
import {timeFrequency} from "../shared/time-frequency.js";

/* ------------------------------------------------------------------ */
/* Palette used by every canvas. One restrained accent; ink for text.  */
/* ------------------------------------------------------------------ */
export const C = {
  mono: '"IBM Plex Mono", ui-monospace, monospace',
  ink: "#ececec",
  ink2: "#9a9a9a",
  ink3: "#636363",
  ink4: "#3a3a3a",
  grid: "rgba(255,255,255,.055)",
  grid2: "rgba(255,255,255,.11)",
  accent: "#5fc9c1",
  accentFill: "rgba(95,201,193,.10)",
  amber: "#c9a24a",
  bg: "#000000",
};
const RAMP = [
  [0.0, [0, 0, 0]],
  [0.14, [8, 14, 15]],
  [0.28, [12, 32, 34]],
  [0.42, [18, 62, 63]],
  [0.58, [38, 112, 110]],
  [0.74, [86, 172, 166]],
  [0.89, [176, 226, 220]],
  [1.0, [240, 250, 247]],
];
export function ramp(v) {
  const x = Math.max(0, Math.min(1, v));
  let k = 0;
  while (k < RAMP.length - 2 && x > RAMP[k + 1][0]) k++;
  const [a, ca] = RAMP[k],
    [b, cb] = RAMP[k + 1];
  const f = (x - a) / (b - a || 1);
  return [0, 1, 2].map((i) => Math.round(ca[i] + (cb[i] - ca[i]) * f));
}
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function niceStep(span, target = 5) {
  const raw = span / target,
    p = Math.pow(10, Math.floor(Math.log10(raw || 1))),
    n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}
function fit(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr)),
    h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
function tip(ctx, text, x, y, maxX, maxY) {
  ctx.font = "11px " + C.mono;
  const tw = ctx.measureText(text).width + 14;
  const tx = Math.min(x + 12, maxX - tw),
    ty = Math.min(y + 12, maxY - 24);
  ctx.fillStyle = "rgba(18,18,18,.95)";
  ctx.strokeStyle = C.grid2;
  ctx.beginPath();
  ctx.roundRect(tx, ty, tw, 22, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, tx + 7, ty + 11);
}

/** Static canvas redrawn on resize / when `draw` identity changes. */
export function CanvasPlot({ draw, className = "", label }) {
  const ref = useRef(null);
  const hover = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    const render = () => {
      const { ctx, w, h } = fit(cv);
      ctx.clearRect(0, 0, w, h);
      draw(ctx, w, h, hover.current);
    };
    const ro = new ResizeObserver(render);
    ro.observe(cv);
    render();
    const move = (e) => {
      const r = cv.getBoundingClientRect();
      hover.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      render();
    };
    const leave = () => {
      hover.current = null;
      render();
    };
    cv.addEventListener("mousemove", move);
    cv.addEventListener("mouseleave", leave);
    return () => {
      ro.disconnect();
      cv.removeEventListener("mousemove", move);
      cv.removeEventListener("mouseleave", leave);
    };
  }, [draw]);
  return <canvas ref={ref} className={"plot " + className} role="img" aria-label={label} />;
}

/* ------------------------------------------------------------------ */
/* Echogram: ring buffer, one new column per packet, smooth scroll.    */
/* ------------------------------------------------------------------ */
const COLS = 240,
  ROWS = 320;
export function Echogram({
  echo,
  packetKey,
  sessionKey,
  rangeMax,
  range,
  gain = 1,
  frozen,
  running,
  demo,
  reference=false,
  prefill,
  peaks = [],
  clearLeft = 0,
  interval = 250,
}) {
  const ref = useRef(null);
  const st = useRef({ rows: [], img: null, off: null, last: 0, key: null, session: null, hover: null, peaks, range, rangeMax, gain, frozen, running, demo, clearLeft });
  Object.assign(st.current, { peaks, range, rangeMax, gain, frozen, running, demo, reference, clearLeft, prefill });

  const paintAll = () => {
    const s = st.current;
    if (!s.off) {
      s.off = document.createElement("canvas");
      s.off.width = COLS;
      s.off.height = ROWS;
    }
    const g = s.off.getContext("2d");
    const img = g.createImageData(COLS, ROWS);
    const start = COLS - s.rows.length;
    for (let x = 0; x < COLS; x++) {
      const row = s.rows[x - start];
      for (let y = 0; y < ROWS; y++) {
        const p = (y * COLS + x) * 4;
        let c = [0, 0, 0];
        if (row) {
          const bin = Math.min(row.length - 1, Math.round((y / (ROWS - 1)) * (s.range / s.rangeMax) * (row.length - 1)));
          c = ramp(row[bin] * s.gain);
        }
        img.data[p] = c[0];
        img.data[p + 1] = c[1];
        img.data[p + 2] = c[2];
        img.data[p + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  };
  const pushColumn = (row) => {
    const s = st.current;
    s.rows.push(row);
    if (s.rows.length > COLS) s.rows.shift();
    if (!s.off) return paintAll();
    const g = s.off.getContext("2d");
    g.drawImage(s.off, -1, 0);
    const col = g.createImageData(1, ROWS);
    for (let y = 0; y < ROWS; y++) {
      const bin = Math.min(row.length - 1, Math.round((y / (ROWS - 1)) * (s.range / s.rangeMax) * (row.length - 1)));
      const c = ramp(row[bin] * s.gain);
      col.data[y * 4] = c[0];
      col.data[y * 4 + 1] = c[1];
      col.data[y * 4 + 2] = c[2];
      col.data[y * 4 + 3] = 255;
    }
    g.putImageData(col, COLS - 1, 0);
  };

  // new session / source → reset (and deterministic demo prefill)
  useEffect(() => {
    const s = st.current;
    s.rows = prefill ? prefill() : [];
    s.key = null;
    paintAll();
  }, [sessionKey]);
  // range / gain → repaint history
  useEffect(() => paintAll(), [range, rangeMax, gain]);
  // new packet → one column
  useEffect(() => {
    const s = st.current;
    if (!echo || packetKey === s.key || s.frozen) return;
    s.key = packetKey;
    if (!s.rows.length && s.prefill) {
      s.rows = s.prefill();
      paintAll();
    }
    pushColumn(echo);
    s.last = performance.now();
  }, [packetKey]);

  useEffect(() => {
    const cv = ref.current;
    let raf = 0;
    const frame = () => {
      const s = st.current;
      const { ctx, w, h } = fit(cv);
      const R = 54,
        B = 22;
      const x1 = w - R,
        y1 = h - B;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x1, y1);
      ctx.clip();
      if (s.off) {
        const pw = x1 / (COLS - 1);
        const frac = s.frozen || !s.running || reduced() ? 1 : Math.min(1, (performance.now() - s.last) / interval);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(s.off, 0, 0, COLS, ROWS, -frac * pw + pw, 0, COLS * pw, y1);
      }
      if (s.clearLeft) {
        const gr = ctx.createLinearGradient(0, 0, s.clearLeft + 80, 0);
        gr.addColorStop(0, "rgba(0,0,0,.84)");
        gr.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, s.clearLeft + 80, y1);
      }
      ctx.restore();
      // axes
      ctx.font = "10px " + C.mono;
      ctx.lineWidth = 1;
      const step = niceStep(s.range, 6);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (let r = 0; r <= s.range + 1e-9; r += step) {
        const y = Math.round((y1 * r) / s.range) + 0.5;
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.fillStyle = C.ink3;
        ctx.fillText((step < 1 ? r.toFixed(1) : Math.round(r)) + " m", x1 + 9, Math.min(Math.max(y, 7), y1 - 6));
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i <= 4; i++) {
        const x = Math.round(x1 - (x1 * i) / 4) + 0.5;
        ctx.strokeStyle = C.grid;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.fillStyle = C.ink3;
        const lab = s.reference ? (i ? `−${i * 60} ref` : 'latest') : s.demo ? (i ? `−${i * 15} s` : "now") : i ? `−${i * 60} pkt` : "latest";
        ctx.fillText(lab, Math.min(Math.max(x, 18), x1 - 16), y1 + 6);
      }
      ctx.strokeStyle = "rgba(99,207,198,.5)";
      ctx.beginPath();
      ctx.moveTo(x1 + 0.5, 0);
      ctx.lineTo(x1 + 0.5, y1);
      ctx.stroke();
      // detected returns
      let lastY = -99;
      for (const p of s.peaks) {
        if (p.range > s.range) continue;
        const y = (y1 * p.range) / s.range;
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = "rgba(230,236,234,.22)";
        ctx.beginPath();
        ctx.moveTo(s.clearLeft + 40, Math.round(y) + 0.5);
        ctx.lineTo(x1 - 4, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        const t1 = `${p.range.toFixed(2)} m`;
        ctx.font = "500 11px " + C.mono;
        const tw = Math.max(ctx.measureText(t1).width, 44) + 14;
        const lx = x1 - tw - 8;
        const ly = Math.max(y - 11, lastY + 26);
        lastY = ly;
        ctx.fillStyle = "rgba(18,18,18,.88)";
        ctx.strokeStyle = C.grid2;
        ctx.beginPath();
        ctx.roundRect(lx, ly, tw, 22, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = C.ink;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(t1, lx + 7, ly + 11);
      }
      if (s.hover && s.hover.x <= x1 && s.hover.y <= y1) {
        const { x, y } = s.hover;
        ctx.strokeStyle = "rgba(230,236,234,.3)";
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(x1, Math.round(y) + 0.5);
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, y1);
        ctx.stroke();
        const slot = Math.min(COLS - 1, Math.floor((x / x1) * COLS));
        const row = s.rows[slot - (COLS - s.rows.length)];
        const r = (y / y1) * s.range;
        const v = row ? row[Math.min(row.length - 1, Math.round((r / s.rangeMax) * (row.length - 1)))] : null;
        tip(ctx, `${s.reference?'reference column · ':s.demo ? ((COLS - 1 - slot) * (interval / 1000)).toFixed(1) + " s · " : ""}${r.toFixed(2)} m · ${v == null ? "no data" : Math.round(v * 100) + "%"}`, x, y, x1, y1);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const move = (e) => {
      const r = cv.getBoundingClientRect();
      st.current.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const leave = () => (st.current.hover = null);
    cv.addEventListener("mousemove", move);
    cv.addEventListener("mouseleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener("mousemove", move);
      cv.removeEventListener("mouseleave", leave);
    };
  }, []);
  return (
    <canvas
      ref={ref}
      className="plot echogram"
      role="img"
      aria-label={reference?'Acoustic preview echogram: initial columns seeded from the first reference return, then replaced by generated returns; range in metres vertically.':'Echogram: time history horizontally, range in metres vertically, colour is normalised echo intensity.'}
    />
  );
}
export function demoPrefill(state, current) {
  const calculatedEcho = state.mode === "demo" || current?.acoustic?.source === "model";
  if (!calculatedEcho || !current?.echo) return null;
  return () =>
    Array.from({ length: COLS - 1 }, (_, i) =>
      echoProfile(state.elapsed - (COLS - 1 - i) * 0.25, state.config, current.echo.length, current.rangeMax),
    );
}

/* ------------------------------------------------------------------ */
/* A-scan: latest ping, range vertical.                                */
/* ------------------------------------------------------------------ */
export function AScan({ echo, range, rangeMax, peaks = [] }) {
  const draw = useMemo(
    () => (ctx, w, h) => {
      const y1 = h - 22,
        x0 = 6,
        x1 = w - 8;
      ctx.font = "10px " + C.mono;
      ctx.strokeStyle = C.grid;
      ctx.fillStyle = C.ink3;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const v of [0, 0.5, 1]) {
        const x = Math.round(x0 + (x1 - x0) * v) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.fillText(v.toFixed(1), Math.min(Math.max(x, 10), w - 12), y1 + 6);
      }
      if (!echo?.length) return;
      const n = echo.length;
      ctx.beginPath();
      let ly = 0;
      for (let i = 0; i < n; i++) {
        const r = (i / (n - 1)) * rangeMax;
        if (r > range) break;
        const y = (y1 * r) / range,
          x = x0 + (x1 - x0) * Math.min(1, echo[i]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        ly = y;
      }
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.lineTo(x0, ly);
      ctx.lineTo(x0, 0);
      ctx.closePath();
      ctx.fillStyle = C.accentFill;
      ctx.fill();
      for (const p of peaks) {
        if (p.range > range) continue;
        const y = (y1 * p.range) / range,
          x = x0 + (x1 - x0) * Math.min(1, p.value);
        ctx.fillStyle = C.bg;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, 7);
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 7);
        ctx.stroke();
      }
    },
    [echo, range, rangeMax, peaks],
  );
  return <CanvasPlot draw={draw} className="ascan" label="A-scan: latest echo intensity versus range" />;
}

/* ------------------------------------------------------------------ */
/* Transmit waveform instrument: TIME (with transmit playhead),        */
/* FFT (tweened between configurations), SPECTROGRAM.                  */
/* ------------------------------------------------------------------ */
function band(config) {
  const fc = (config.frequency || 40) * 1000;
  const half = Math.max(5000, (config.mode === "PHASE-CODED PULSE" ? 13 / (config.pulse || 1) : config.bandwidth || 2) * 1000 * 2.5);
  return [Math.max(0, fc - half), fc + half];
}
function instFreq(config, t, T) {
  const fc = config.frequency * 1000,
    bw = config.bandwidth * 1000;
  if (config.mode === "PHASE-CODED PULSE") return fc;
  const f0 = fc - bw / 2,
    f1 = fc + bw / 2;
  if (config.mode === "GEOMETRIC SWEEP") return f0 * Math.pow(f1 / f0, t / T);
  return f0 + ((f1 - f0) * t) / T;
}
export function WaveScope({ config, view = "time", running = true, samples: supplied, sampleRate = SAMPLE_RATE }) {
  const ref = useRef(null);
  const samples = useMemo(
    () => supplied || generateSignal(config),
    [supplied, config.mode, config.frequency, config.bandwidth, config.pulse, config.amplitude, config.window],
  );
  const spec = useMemo(() => spectrum(samples, sampleRate), [samples, sampleRate]);
  const st = useRef({ prevY: null, curY: null, t0: 0, hover: null });
  st.current.view = view;
  st.current.running = running;
  st.current.samples = samples;
  st.current.spec = spec;
  st.current.config = config;
  st.current.sampleRate = sampleRate;
  // mark FFT transition start
  useEffect(() => {
    st.current.prevY = st.current.curY;
    st.current.t0 = performance.now();
  }, [spec]);

  useEffect(() => {
    const cv = ref.current;
    let raf = 0,
      cache = null;
    const frame = (now) => {
      const s = st.current;
      const { ctx, w, h } = fit(cv);
      ctx.clearRect(0, 0, w, h);
      const x0 = 34,
        x1 = w - 10,
        y0 = 8,
        y1 = h - 18;
      ctx.font = "9.5px " + C.mono;
      ctx.lineWidth = 1;
      const grid = (xs, ys) => {
        ctx.strokeStyle = C.grid;
        ctx.fillStyle = C.ink3;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (const [x, lab] of xs) {
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, y0);
          ctx.lineTo(Math.round(x) + 0.5, y1);
          ctx.stroke();
          ctx.fillText(lab, Math.min(Math.max(x, x0 + 14), x1 - 16), y1 + 5);
        }
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const [y, lab] of ys) {
          ctx.beginPath();
          ctx.moveTo(x0, Math.round(y) + 0.5);
          ctx.lineTo(x1, Math.round(y) + 0.5);
          ctx.stroke();
          ctx.fillText(lab, x0 - 6, y);
        }
      };
      const n = s.samples.length,
        ms = (n / s.sampleRate) * 1000;
      if (s.view === "fft") {
        const [fLo, fHi] = band(s.config);
        const Y = (db) => y0 + ((y1 - y0) * Math.min(80, -db)) / 80;
        const stp = niceStep((fHi - fLo) / 1000, 5);
        const xs = [];
        for (let f = Math.ceil(fLo / 1000 / stp) * stp; f <= fHi / 1000 + 1e-9; f += stp)
          xs.push([x0 + ((x1 - x0) * (f * 1000 - fLo)) / (fHi - fLo), +f.toFixed(1) + "k"]);
        grid(xs, [0, -20, -40, -60].map((d) => [Y(d), d]));
        const cols = Math.max(2, Math.floor(x1 - x0));
        const cur = new Float32Array(cols);
        const df = s.sampleRate / ((s.spec.length || 1) * 2);
        for (let c = 0; c < cols; c++) {
          const f = fLo + ((fHi - fLo) * c) / (cols - 1);
          const b = s.spec[Math.min(s.spec.length - 1, Math.round(f / df))];
          cur[c] = Math.min(y1, Y(b ? b.db : -100));
        }
        s.curY = cur;
        const k = s.prevY && s.prevY.length === cols && !reduced() ? Math.min(1, (now - s.t0) / 320) : 1;
        ctx.beginPath();
        for (let c = 0; c < cols; c++) {
          const y = k < 1 ? s.prevY[c] + (cur[c] - s.prevY[c]) * (1 - Math.pow(1 - k, 3)) : cur[c];
          c ? ctx.lineTo(x0 + c, y) : ctx.moveTo(x0, y);
        }
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        if (k >= 1) s.prevY = cur;
        ctx.fillStyle = C.ink4;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText("dBFS · Hann FFT", x1 - 2, y0 + 2);
        if (s.hover && s.hover.x >= x0 && s.hover.x <= x1) {
          const f = fLo + ((s.hover.x - x0) / (x1 - x0)) * (fHi - fLo);
          const b = s.spec[Math.round(f / df)];
          ctx.strokeStyle = "rgba(230,236,234,.35)";
          ctx.beginPath();
          ctx.moveTo(Math.round(s.hover.x) + 0.5, y0);
          ctx.lineTo(Math.round(s.hover.x) + 0.5, y1);
          ctx.stroke();
          tip(ctx, `${(f / 1000).toFixed(2)} kHz · ${b ? b.db.toFixed(1) : "—"} dBFS`, s.hover.x, y0 + 6, x1, y1);
        }
      } else {
        const Y = (v) => y0 + ((y1 - y0) * (1 - v)) / 2;
        const stp = niceStep(ms, 4);
        const xs = [];
        for (let t = 0; t <= ms + 1e-9; t += stp) xs.push([x0 + ((x1 - x0) * t) / ms, +t.toFixed(2) + " ms"]);
        grid(xs, [1, 0, -1].map((v) => [Y(v), v]));
        // cache the min/max envelope per pixel column
        const cols = Math.max(2, Math.floor(x1 - x0));
        if (!cache || cache.samples !== s.samples || cache.cols !== cols) {
          const hi = new Float32Array(cols),
            lo = new Float32Array(cols);
          for (let c = 0; c < cols; c++) {
            const a = Math.floor((c / cols) * n),
              b = Math.max(a + 1, Math.floor(((c + 1) / cols) * n));
            let mn = 1,
              mx = -1;
            for (let i = a; i < b && i < n; i++) {
              if (s.samples[i] < mn) mn = s.samples[i];
              if (s.samples[i] > mx) mx = s.samples[i];
            }
            hi[c] = mx;
            lo[c] = mn;
          }
          cache = { samples: s.samples, cols, hi, lo };
        }
        const period = 1400;
        const play = s.running && !reduced() ? ((now % period) / period) * 1.15 : 1.15;
        const px = x0 + (x1 - x0) * Math.min(1, play);
        const pathEnv = (from, to) => {
          ctx.beginPath();
          for (let c = from; c < to; c++) ctx.lineTo(x0 + c + 0.5, Y(cache.hi[c]));
          for (let c = to - 1; c >= from; c--) ctx.lineTo(x0 + c + 0.5, Y(cache.lo[c]));
          ctx.closePath();
        };
        const split = Math.max(0, Math.min(cols, Math.round(px - x0)));
        if (split > 0) {
          pathEnv(0, split);
          ctx.fillStyle = "rgba(99,207,198,.55)";
          ctx.fill();
        }
        if (split < cols) {
          pathEnv(split, cols);
          ctx.fillStyle = "rgba(99,207,198,.16)";
          ctx.fill();
        }
        // At wide sizes a column may contain only one sample, giving a
        // zero-area envelope. Draw the sample trace so the pulse stays visible.
        if (n / cols < 4) {
          ctx.beginPath();
          for(let i=0;i<n;i++) {
            const x=x0+(x1-x0)*i/Math.max(1,n-1),y=Y(s.samples[i]);
            i?ctx.lineTo(x,y):ctx.moveTo(x,y);
          }
          ctx.strokeStyle=C.accent;ctx.lineWidth=1;ctx.stroke();
        }
        if (play < 1) {
          ctx.strokeStyle = C.ink;
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.moveTo(Math.round(px) + 0.5, y0);
          ctx.lineTo(Math.round(px) + 0.5, y1);
          ctx.stroke();
          ctx.globalAlpha = 1;
          const t = play * ms;
          ctx.fillStyle = C.ink2;
          ctx.textAlign = px > x1 - 90 ? "right" : "left";
          ctx.textBaseline = "top";
          ctx.fillText(`f ${(instFreq(s.config, t, ms) / 1000).toFixed(2)} kHz`, px + (px > x1 - 90 ? -6 : 6), y0 + 2);
        }
        ctx.fillStyle = C.ink4;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(`${Math.round((ms / 1000) * s.config.frequency * 1000)} cycles`, x1 - 2, y1 - 2);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const move = (e) => {
      const r = cv.getBoundingClientRect();
      st.current.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const leave = () => (st.current.hover = null);
    cv.addEventListener("mousemove", move);
    cv.addEventListener("mouseleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener("mousemove", move);
      cv.removeEventListener("mouseleave", leave);
    };
  }, []);
  return (
    <canvas
      ref={ref}
      className="plot"
      role="img"
      aria-label={view === "fft" ? "Transmit pulse spectrum in dBFS" : "Transmit pulse amplitude versus time, with transmit playhead"}
    />
  );
}

/* ------------------------------------------------------------------ */
/* STFT zoomed to the transmit band.                                   */
/* ------------------------------------------------------------------ */
export function Spectrogram({ config, samples: inputSamples, sampleRate: inputRate, signalLabel = "Signal buffer", showRidge = false }) {
  const rate = Number.isFinite(inputRate) ? inputRate : SAMPLE_RATE;
  const bufferCache=useRef(null);
  // The C reference is repeated in preview packets. Reuse identical samples
  // without assuming that matching configuration implies matching data (RX
  // and captured buffers may change while configuration stays constant).
  const stableInput=useMemo(()=>{
    const prior=bufferCache.current;
    if(inputSamples && prior?.length===inputSamples.length && inputSamples.every((value,i)=>value===prior[i])) return prior;
    bufferCache.current=inputSamples;
    return inputSamples;
  },[inputSamples]);
  const samples = useMemo(
    () => stableInput ? Float64Array.from(stableInput) : generateSignal(config, rate),
    [stableInput, config.mode, config.frequency, config.bandwidth, config.pulse, config.amplitude, config.window, rate],
  );
  const data=useMemo(()=>timeFrequency(samples,rate,config),
    [samples,rate,config.mode,config.frequency,config.bandwidth,config.pulse]);
  const draw = useMemo(
    () => (ctx, w, h) => {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);
      if(!data) return;
      const {frames,lowHz,highHz,durationMs,maximumDb,coded}=data;
      const x0=54,x1=w-12,y0=22,y1=h-28;
      const X=t=>x0+t/durationMs*(x1-x0),Y=f=>y1-(f-lowHz)/(highHz-lowHz)*(y1-y0);
      ctx.save();ctx.beginPath();ctx.rect(x0,y0,x1-x0,y1-y0);ctx.clip();
      frames.forEach((frame,x) => {
        const step=frame.bins[1]?.frequency-frame.bins[0]?.frequency || data.resolutionHz/4;
        for (const b of frame.bins) {
          const c = ramp((b.db-maximumDb+36)/36);
          ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
          ctx.fillRect(x0+(x-.5)*(x1-x0)/(frames.length-1),Y(b.frequency+step/2),
            (x1-x0)/(frames.length-1)+1,(y1-y0)*step/(highHz-lowHz)+1);
        }
      });
      if(showRidge && !coded) {
        ctx.beginPath();let started=false;
        for(const frame of frames) {
          if(frame.centroidHz===null) {started=false;continue;}
          const x=X(frame.timeMs),y=Y(frame.centroidHz);
          if(started) ctx.lineTo(x,y);else ctx.moveTo(x,y);
          started=true;
        }
        ctx.strokeStyle='rgba(0,0,0,.65)';ctx.lineWidth=3.5;ctx.stroke();
        ctx.strokeStyle=C.ink;ctx.lineWidth=1.2;ctx.stroke();
      }
      ctx.restore();
      ctx.font = "9.5px " + C.mono;
      ctx.fillStyle = C.ink2;
      ctx.textAlign="right";ctx.textBaseline="middle";
      for(const f of [lowHz,(lowHz+highHz)/2,highHz]) ctx.fillText((f/1000).toFixed(1),x0-6,Y(f));
      ctx.textAlign="left";ctx.textBaseline="top";ctx.fillText("kHz",5,3);
      ctx.fillText(showRidge&&!coded?'STFT · spectral centroid':'STFT · relative power',x0,3);
      ctx.textBaseline="bottom";
      for(const t of [0,durationMs/2,durationMs]) {
        ctx.textAlign=t===0?'left':t===durationMs?'right':'center';
        ctx.fillText(`${+t.toFixed(2)} ms`,X(t),h-3);
      }
    },
    [data,showRidge],
  );
  return <CanvasPlot draw={draw} label={`${signalLabel}: short-time Fourier transform, frequency versus time; colors show relative spectral power${showRidge && !data?.coded ? '; line shows sample-derived spectral centroid' : ''}`} />;
}

/* ------------------------------------------------------------------ */
/* Spectrum comparison: target (computed) vs measured (reported).      */
/* ------------------------------------------------------------------ */
export function SpectrumCompare({ config, measured, measuredRate, targetSamples, targetRate, resultLabel='measured' }) {
  const target = useMemo(() => spectrum(targetSamples || generateSignal(config), targetRate || SAMPLE_RATE), [targetSamples, targetRate, config.mode, config.frequency, config.bandwidth, config.pulse, config.amplitude, config.window]);
  const meas = useMemo(() => (measured ? spectrum(Float64Array.from(measured), measuredRate) : null), [measured, measuredRate]);
  const draw = useMemo(
    () => (ctx, w, h, hover) => {
      const [fLo, fHi] = band(config);
      const x0 = 36,
        x1 = w - 10,
        y0 = 10,
        y1 = h - 20;
      const X = (f) => x0 + ((x1 - x0) * (f - fLo)) / (fHi - fLo),
        Y = (db) => y0 + ((y1 - y0) * Math.min(80, -db)) / 80;
      ctx.font = "9.5px " + C.mono;
      ctx.strokeStyle = C.grid;
      ctx.fillStyle = C.ink3;
      const stp = niceStep((fHi - fLo) / 1000, 6);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let f = Math.ceil(fLo / 1000 / stp) * stp; f <= fHi / 1000 + 1e-9; f += stp) {
        const x = Math.round(X(f * 1000)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.fillText(+f.toFixed(1) + " kHz", x, y1 + 5);
      }
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const d of [0, -20, -40, -60]) {
        const y = Math.round(Y(d)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.fillText(d, x0 - 6, y);
      }
      const line = (bins, color, dash) => {
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        let first = true;
        for (const b of bins) {
          if (b.frequency < fLo || b.frequency > fHi) continue;
          const x = X(b.frequency),
            y = Math.min(y1, Y(b.db));
          first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          first = false;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      };
      line(target, C.ink3, [4, 3]);
      if (meas) line(meas, C.accent);
      if (hover && hover.x >= x0 && hover.x <= x1) {
        const f = fLo + ((hover.x - x0) / (x1 - x0)) * (fHi - fLo);
        const pick = (bins) => bins.reduce((a, b) => (Math.abs(b.frequency - f) < Math.abs(a.frequency - f) ? b : a), bins[0]);
        ctx.strokeStyle = "rgba(230,236,234,.35)";
        ctx.beginPath();
        ctx.moveTo(Math.round(hover.x) + 0.5, y0);
        ctx.lineTo(Math.round(hover.x) + 0.5, y1);
        ctx.stroke();
        tip(ctx, `${(f / 1000).toFixed(2)} kHz · target ${pick(target).db.toFixed(1)} dB${meas ? ` · ${resultLabel} ${pick(meas).db.toFixed(1)} dB` : ""}`, hover.x, y0 + 6, x1, y1);
      }
    },
    [target, meas, config, resultLabel],
  );
  return <CanvasPlot draw={draw} label={`Target spectrum (dashed) and ${resultLabel} spectrum (solid) in dBFS`} />;
}

/* ------------------------------------------------------------------ */
/* Time series with axes (one measure per chart — never dual-axis).    */
/* ------------------------------------------------------------------ */
export function TimeSeries({ values = [], unit = "", digits = 1, limit, color = C.accent, span = "60 s", area = false }) {
  const draw = useMemo(
    () => (ctx, w, h, hover) => {
      const clean = values.map((v) => (Number.isFinite(v) ? v : null));
      const vals = clean.filter((v) => v != null);
      const x0 = 52,
        x1 = w - 8,
        y0 = 8,
        y1 = h - 18;
      ctx.font = "9.5px " + C.mono;
      if (vals.length < 2) {
        ctx.fillStyle = C.ink3;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("no samples", (x0 + x1) / 2, (y0 + y1) / 2);
        return;
      }
      let lo = Math.min(...vals, limit ?? Infinity),
        hi = Math.max(...vals, limit ?? -Infinity);
      const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.002, 1e-3);
      lo -= pad;
      hi += pad;
      const Y = (v) => y1 - ((y1 - y0) * (v - lo)) / (hi - lo);
      ctx.strokeStyle = C.grid;
      ctx.fillStyle = C.ink3;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const dd = Math.min(4, Math.max(digits, Math.ceil(-Math.log10((hi - lo) / 2)) + 1));
      for (const v of y1 - y0 < 56 ? [lo, hi] : [lo, (lo + hi) / 2, hi]) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.fillText(v.toFixed(dd), x0 - 6, Math.min(Math.max(y, y0 + 4), y1 - 4));
      }
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("−" + span, x0, y1 + 5);
      ctx.textAlign = "right";
      ctx.fillText("now", x1, y1 + 5);
      if (limit != null) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(201,162,74,.6)";
        ctx.beginPath();
        ctx.moveTo(x0, Math.round(Y(limit)) + 0.5);
        ctx.lineTo(x1, Math.round(Y(limit)) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const n = clean.length;
      if (area) {
        const fill = ctx.createLinearGradient(0, y0, 0, y1);
        fill.addColorStop(0, "rgba(183,211,203,.15)");
        fill.addColorStop(1, "rgba(183,211,203,0)");
        ctx.fillStyle = fill;
        // Fill each received segment independently so missing samples stay gaps.
        let start = 0;
        while (start < n) {
          if (clean[start] === null) { start++; continue; }
          let end = start;
          while (end + 1 < n && clean[end + 1] !== null) end++;
          ctx.beginPath();
          ctx.moveTo(x0 + (x1 - x0) * start / (n - 1), y1);
          for (let i = start; i <= end; i++) ctx.lineTo(x0 + (x1 - x0) * i / (n - 1), Y(clean[i]));
          ctx.lineTo(x0 + (x1 - x0) * end / (n - 1), y1);
          ctx.closePath(); ctx.fill();
          start = end + 1;
        }
      }
      ctx.beginPath();
      let on = false;
      clean.forEach((v, i) => {
        if (v == null) return (on = false);
        const x = x0 + ((x1 - x0) * i) / (n - 1);
        on ? ctx.lineTo(x, Y(v)) : ctx.moveTo(x, Y(v));
        on = true;
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (hover && hover.x >= x0 && hover.x <= x1) {
        const i = Math.round(((hover.x - x0) / (x1 - x0)) * (n - 1));
        const v = clean[i];
        if (v != null) {
          const x = x0 + ((x1 - x0) * i) / (n - 1);
          ctx.strokeStyle = "rgba(230,236,234,.35)";
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, y0);
          ctx.lineTo(Math.round(x) + 0.5, y1);
          ctx.stroke();
          ctx.fillStyle = C.ink;
          ctx.beginPath();
          ctx.arc(x, Y(v), 3, 0, 7);
          ctx.fill();
          tip(ctx, `${v.toFixed(digits)} ${unit}`, x, Y(v), x1, y1);
        }
      }
    },
    [values, unit, digits, limit, color, span, area],
  );
  return <CanvasPlot draw={draw} className="ts" label={`History of the last ${span}${unit ? " in " + unit : ""}`} />;
}

/* ------------------------------------------------------------------ */
/* Sparkline (inline, no axes).                                        */
/* ------------------------------------------------------------------ */
export function Spark({ values = [], alert = false }) {
  const draw = useMemo(
    () => (ctx, w, h) => {
      const v = values.filter(Number.isFinite);
      if (v.length < 2) return;
      const lo = Math.min(...v),
        hi = Math.max(...v),
        span = Math.max(1e-6, hi - lo) * 1.25,
        mid = (hi + lo) / 2;
      const Y = (x) => h / 2 - ((x - mid) / span) * (h - 4);
      ctx.beginPath();
      v.forEach((x, i) => {
        const px = (i / (v.length - 1)) * (w - 3);
        i ? ctx.lineTo(px, Y(x)) : ctx.moveTo(px, Y(x));
      });
      ctx.strokeStyle = alert ? C.amber : C.ink2;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = alert ? C.amber : C.ink;
      ctx.beginPath();
      ctx.arc(w - 3, Y(v.at(-1)), 1.7, 0, 7);
      ctx.fill();
    },
    [values, alert],
  );
  return <CanvasPlot draw={draw} className="spark" label="Recent trend" />;
}
