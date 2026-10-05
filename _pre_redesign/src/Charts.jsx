import React, { useEffect, useRef, useMemo, useState } from "react";
import {
  echoProfile,
  generateSignal,
  spectrum,
  SAMPLE_RATE,
} from "../shared/signal.js";
export function CanvasPlot({ draw, className = "", label }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      draw(ctx, rect.width, rect.height);
    };
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    render();
    return () => observer.disconnect();
  }, [draw]);
  return (
    <canvas ref={ref} className={className} role="img" aria-label={label} />
  );
}
const colors = [
  [5, 20, 24],
  [8, 38, 44],
  [12, 65, 69],
  [23, 94, 94],
  [44, 132, 116],
  [97, 166, 125],
  [181, 187, 111],
  [228, 205, 140],
];
function color(v) {
  const q = Math.max(0, Math.min(0.999, v)) * (colors.length - 1),
    a = Math.floor(q),
    f = q - a;
  return colors[a].map((x, i) =>
    Math.round(x + (colors[Math.min(a + 1, colors.length - 1)][i] - x) * f),
  );
}
export function SonarCanvas({ state, frozen, gain, range }) {
  const rows = useRef([]);
  const last = useRef(-1);
  const session = useRef("");
  if (
    session.current !==
    state.sessionId + state.mode + (state.current?.rangeMax || 80)
  ) {
    rows.current = [];
    last.current = -1;
    session.current =
      state.sessionId + state.mode + (state.current?.rangeMax || 80);
  }
  if (
    !frozen &&
    state.current?.echo &&
    (state.mode === "demo" ? state.seq : state.current.timestamp) !==
      last.current
  ) {
    // Prefill only in explicitly labelled DEMO mode with a deterministic test fixture.
    if (!rows.current.length && state.mode === "demo")
      rows.current = Array.from({ length: 239 }, (_, i) =>
        echoProfile(state.elapsed - (239 - i) * 0.25, state.config),
      );
    rows.current.push(state.current.echo);
    rows.current = rows.current.slice(-240);
    last.current = state.mode === "demo" ? state.seq : state.current.timestamp;
  }
  const data = rows.current;
  return (
    <CanvasPlot
      className="sonar-canvas"
      label="Sonar echogram. Horizontal axis: time history. Vertical axis: range in meters. Color: normalized echo intensity."
      draw={(ctx, w, h) => {
        ctx.fillStyle = "#07161b";
        ctx.fillRect(0, 0, w, h);
        if (!data.length) return;
        const off = document.createElement("canvas");
        off.width = data.length;
        off.height = 320;
        const oc = off.getContext("2d"),
          pixels = oc.createImageData(data.length, 320);
        for (let x = 0; x < data.length; x++)
          for (let y = 0; y < 320; y++) {
            const bin = Math.min(
              data[x].length - 1,
              Math.round(
                (y / 319) *
                  (range / (state.current?.rangeMax || 80)) *
                  (data[x].length - 1),
              ),
            );
            const v = data[x][bin] * gain;
            const c = color(v);
            const p = (y * data.length + x) * 4;
            pixels.data[p] = c[0];
            pixels.data[p + 1] = c[1];
            pixels.data[p + 2] = c[2];
            pixels.data[p + 3] = 255;
          }
        oc.putImageData(pixels, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, w, h);
        ctx.strokeStyle = "rgba(132,178,173,.10)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 8; i++) {
          ctx.beginPath();
          ctx.moveTo(0, (h * i) / 8);
          ctx.lineTo(w, (h * i) / 8);
          ctx.stroke();
        }
        for (let i = 1; i < 8; i++) {
          ctx.beginPath();
          ctx.moveTo((w * i) / 8, 0);
          ctx.lineTo((w * i) / 8, h);
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(164,231,210,.5)";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(w - 2, 0);
        ctx.lineTo(w - 2, h);
        ctx.stroke();
      }}
    />
  );
}
export function SignalChart({
  config,
  type = "time",
  samples: supplied,
  sampleRate = SAMPLE_RATE,
  large = false,
}) {
  const samples = useMemo(
    () => supplied || generateSignal(config),
    [
      supplied,
      config.mode,
      config.frequency,
      config.bandwidth,
      config.pulse,
      config.amplitude,
    ],
  );
  const bins = useMemo(
    () => (type === "frequency" ? spectrum(samples, sampleRate) : []),
    [samples, type, sampleRate],
  );
  return (
    <CanvasPlot
      className={"signal-chart " + (large ? "large" : "")}
      label={
        type === "frequency"
          ? "FFT spectrum in dBFS versus frequency"
          : "Generated signal amplitude versus time"
      }
      draw={(ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = "#203034";
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
          ctx.beginPath();
          ctx.moveTo(0, 10 + ((h - 20) * i) / 4);
          ctx.lineTo(w, 10 + ((h - 20) * i) / 4);
          ctx.stroke();
        }
        for (let i = 0; i < 9; i++) {
          ctx.beginPath();
          ctx.moveTo((w * i) / 8, 0);
          ctx.lineTo((w * i) / 8, h);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.strokeStyle = "#9ee3cb";
        ctx.lineWidth = 1.25;
        if (type === "frequency") {
          const visible = bins.filter((b) => b.frequency <= 400000);
          visible.forEach((b, i) => {
            const x = (i / (visible.length - 1)) * w,
              y = 8 - (b.db / 100) * (h - 16);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          });
        } else {
          const count = Math.min(samples.length, large ? 600 : 230);
          for (let i = 0; i < count; i++) {
            const x = (i / (count - 1)) * w,
              y = h / 2 - samples[i] * (h / 2 - 12);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
        }
        ctx.stroke();
      }}
    />
  );
}
export function Spectrogram({ config }) {
  const samples = useMemo(
    () => generateSignal(config),
    [
      config.mode,
      config.frequency,
      config.bandwidth,
      config.pulse,
      config.amplitude,
    ],
  );
  const columns = useMemo(
    () =>
      Array.from({ length: 100 }, (_, i) =>
        spectrum(
          samples.slice(
            Math.floor((i * (samples.length - 256)) / 99),
            Math.floor((i * (samples.length - 256)) / 99) + 256,
          ),
          SAMPLE_RATE,
          256,
        ),
      ),
    [samples],
  );
  return (
    <CanvasPlot
      className="stft-chart"
      label="Short-time Fourier transform of generated pulse. Time versus frequency."
      draw={(ctx, w, h) => {
        ctx.fillStyle = "#08191d";
        ctx.fillRect(0, 0, w, h);
        columns.forEach((bins, x) =>
          bins.forEach((b, y) => {
            const c = color((b.db + 75) / 75);
            ctx.fillStyle = `rgb(${c.join(",")})`;
            ctx.fillRect(
              (x * w) / 100,
              h - ((y + 1) * h) / 128,
              w / 100 + 1,
              h / 128 + 1,
            );
          }),
        );
      }}
    />
  );
}
export function Trend({ values = [], color = "#86cab7", height = 46 }) {
  return (
    <CanvasPlot
      className="trend"
      label="Telemetry history"
      draw={(ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        const clean = values.filter(Number.isFinite);
        if (clean.length < 2) return;
        const min = Math.min(...clean),
          max = Math.max(...clean),
          span = Math.max(0.02, max - min);
        ctx.beginPath();
        clean.forEach((v, i) => {
          const x = (i / (clean.length - 1)) * w,
            y = h - 5 - ((v - min) / span) * (h - 12);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, color + "35");
        gradient.addColorStop(1, color + "00");
        ctx.fillStyle = gradient;
        ctx.fill();
      }}
    />
  );
}
