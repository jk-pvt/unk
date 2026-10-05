import React, { useEffect, useRef, useState } from 'react';
import { Battery } from './Battery.jsx';

/* The team's 3S2P Li-ion pack (six 18650 cells, 11.1 V / 5.2 Ah, shrink-wrapped
   with a protection board), drawn as an X-ray render: translucent blue wrap, the
   six cells inside (three series groups of two in parallel), nickel strips, the
   protection board and the main leads. Everything that glows is driven by telemetry:
   - cell cores fill to the state of charge (same level in every cell)
   - energy pulses run along the series path and the main lead only while current flows,
     speed follows |current|, direction reverses when charging
   - the 4-segment indicator on the board is a display of SOC, not a feature of the real pack
   With no data the cores are empty and nothing moves. */

function glowTexture(T) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,.55)');
  r.addColorStop(0.6, 'rgba(255,255,255,.12)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

export function BatteryModule({ active = false, soc, current, charging, critical, low }) {
  const host = useRef(null);
  const latest = useRef({ active, soc, current, charging, critical, low });
  latest.current = { active, soc, current, charging, critical, low };
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let disposed = false, cleanup = () => {};
    Promise.all([import('three'), import('three/addons/environments/RoomEnvironment.js')]).then(([T, { RoomEnvironment }]) => {
      if (disposed) return;
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      host.current.appendChild(renderer.domElement);

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(28, 1, 0.1, 100);
      const room = new RoomEnvironment();
      const pmrem = new T.PMREMGenerator(renderer);
      const env = pmrem.fromScene(room, 0.04);
      scene.environment = env.texture; room.dispose(); pmrem.dispose();
      scene.add(new T.HemisphereLight(0xdfe8ee, 0x0b0d0e, 0.7));
      const key = new T.DirectionalLight(0xffffff, 1.6); key.position.set(-3, 6, 4); scene.add(key);
      const rim = new T.DirectionalLight(0x9fd0ff, 0.8); rim.position.set(4, 2, -5); scene.add(rim);

      const pivot = new T.Group(); scene.add(pivot);
      const model = new T.Group(); pivot.add(model);
      const disposables = [];
      const keep = (x) => { disposables.push(x); return x; };
      const glowTex = keep(glowTexture(T));

      // ---- materials
      const M = (o) => keep(new T.MeshStandardMaterial(o));
      const shellMat = keep(new T.MeshPhysicalMaterial({ color: 0x1d63c8, metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.1 }));
      const edgeMat = keep(new T.LineBasicMaterial({ color: 0xcfd8dc, transparent: true, opacity: 0.38 }));
      const sleeveMat = keep(new T.MeshPhysicalMaterial({ color: 0x5d6b73, metalness: 0.2, roughness: 0.3, transparent: true, opacity: 0.16, depthWrite: false }));
      const coreMat = M({ color: 0x0a4d25, emissive: 0x22d36b, emissiveIntensity: 0.8, metalness: 0, roughness: 0.9, envMapIntensity: 0.05, transparent: true, opacity: 0.92 });
      const haloMat = keep(new T.MeshBasicMaterial({ color: 0x3fcf7f, transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false }));
      const capMat = M({ color: 0xb9c0c4, metalness: 0.9, roughness: 0.25 });
      const nickelMat = M({ color: 0xd6dadc, metalness: 0.95, roughness: 0.2 });
      const pcbMat = M({ color: 0x103a2c, metalness: 0.1, roughness: 0.5 });
      const chipMat = M({ color: 0x0d0e0f, roughness: 0.4 });
      const ledOn = M({ color: 0x6ab8ff, emissive: 0x4aa3ff, emissiveIntensity: 2.2 });
      const ledOff = M({ color: 0x1c2a36, emissive: 0x000000 });
      const redMat = M({ color: 0xb3261e, roughness: 0.45 });
      const blackMat = M({ color: 0x151515, roughness: 0.5 });
      const pulseMat = keep(new T.SpriteMaterial({ map: glowTex, color: 0x7dffb2, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
      const bmsGlowMat = keep(new T.SpriteMaterial({ map: glowTex, color: 0x3d8bff, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
      const cellGlowMat = keep(new T.SpriteMaterial({ map: glowTex, color: 0x3fcf7f, transparent: true, opacity: 0.35, blending: T.AdditiveBlending, depthWrite: false }));

      const add = (geo, mat, x = 0, y = 0, z = 0, parent = model) => { keep(geo); const m = new T.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
      const box = (w, h, d, mat, x, y, z, parent) => add(new T.BoxGeometry(w, h, d), mat, x, y, z, parent);
      const cylX = (r, len, mat, x, y, z, seg = 40) => { const m = add(new T.CylinderGeometry(r, r, len, seg), mat, x, y, z); m.rotation.z = Math.PI / 2; return m; };
      const tube = (pts, r, mat) => { const c = new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...p))); add(new T.TubeGeometry(c, 48, r, 8, false), mat); return c; };

      // ---- shrink-wrapped pack: about 76 x 37 x 56 mm -> 1.9 x 0.925 x 1.4 (1 unit = 40 mm)
      const W = 1.9, H = 0.925, D = 1.4;
      const shellGeo = keep(new T.BoxGeometry(W, H, D));
      model.add(new T.Mesh(shellGeo, shellMat));
      model.add(new T.LineSegments(keep(new T.EdgesGeometry(shellGeo)), edgeMat));

      // ---- six 18650 Li-ion cells (Ø18 x 65 mm): 3 groups across, each 2 in parallel (3S2P)
      const cellR = 0.215, cellL = 1.62, cellX = 0.1;
      const groupZ = [-0.4625, 0, 0.4625], rowY = [-0.23, 0.23];
      const cells = [];
      for (const cz of groupZ) for (const cy of rowY) {
        cylX(cellR, cellL, sleeveMat, cellX, cy, cz);
        const core = cylX(cellR * 0.8, cellL - 0.12, coreMat, cellX, cy, cz, 28);
        const halo = cylX(cellR * 0.97, cellL - 0.06, haloMat, cellX, cy, cz, 28);
        for (const s of [-1, 1]) {
          cylX(cellR * 0.98, 0.04, capMat, cellX + s * (cellL / 2), cy, cz);
          cylX(cellR * 0.34, 0.05, capMat, cellX + s * (cellL / 2 + 0.025), cy, cz, 20);
        }
        const glow = new T.Sprite(cellGlowMat); glow.scale.set(1.4, 0.5, 1); glow.position.set(cellX, cy, cz); model.add(glow);
        cells.push({ core, halo, glow, cx: cellX, len: cellL - 0.12 });
      }
      // nickel strips: each strip joins a parallel pair and links it in series to the next group
      const xl = cellX - cellL / 2 - 0.05, xr = cellX + cellL / 2 + 0.05;
      box(0.05, 0.8, 0.5, nickelMat, xl, 0, groupZ[0]);        // pack − terminal
      box(0.05, 0.8, 0.95, nickelMat, xr, 0, (groupZ[0] + groupZ[1]) / 2);
      box(0.05, 0.8, 0.95, nickelMat, xl, 0, (groupZ[1] + groupZ[2]) / 2);
      box(0.05, 0.8, 0.5, nickelMat, xr, 0, groupZ[2]);        // pack + terminal
      // series path used by the energy pulses: group 1 → group 2 → group 3
      const series = new T.CatmullRomCurve3([
        [xl, 0, groupZ[0]], [cellX, 0.2, groupZ[0]], [xr, 0, groupZ[0]], [xr, 0, groupZ[1]], [cellX, 0.2, groupZ[1]],
        [xl, 0, groupZ[1]], [xl, 0, groupZ[2]], [cellX, 0.2, groupZ[2]], [xr, 0, groupZ[2]],
      ].map((p) => new T.Vector3(...p)));

      // ---- protection board on the lead end, with SOC indicator and blue glow
      const bx = -W / 2 + 0.07;
      box(0.04, 0.62, 1.1, pcbMat, bx, 0, 0);
      box(0.05, 0.14, 0.22, chipMat, bx + 0.03, 0.12, -0.25);
      box(0.05, 0.1, 0.16, chipMat, bx + 0.03, -0.14, 0.22);
      const leds = [];
      for (let i = 0; i < 4; i++) leds.push(box(0.04, 0.09, 0.13, ledOff, -W / 2 - 0.005, 0.18, -0.3 + i * 0.2));
      const bmsGlow = new T.Sprite(bmsGlowMat); bmsGlow.scale.set(1.4, 1.1, 1); bmsGlow.position.set(-W / 2 - 0.1, 0.12, 0); model.add(bmsGlow);

      // ---- main leads out of the lead end to the pack connector
      const x0 = -W / 2;
      const lead = tube([[x0, -0.18, -0.45], [x0 - 0.3, -0.2, -0.52], [x0 - 0.5, -0.35, -0.38], [x0 - 0.6, -0.6, -0.2]], 0.045, redMat);
      tube([[x0, -0.18, -0.3], [x0 - 0.26, -0.22, -0.34], [x0 - 0.44, -0.37, -0.24], [x0 - 0.54, -0.6, -0.1]], 0.045, blackMat);
      const plug = add(new T.CylinderGeometry(0.11, 0.11, 0.36, 24), blackMat, x0 - 0.58, -0.8, -0.15);
      plug.rotation.x = 0.15;

      // ---- energy pulses
      const pulses = Array.from({ length: 7 }, () => { const s = new T.Sprite(pulseMat); s.scale.set(0.34, 0.34, 1); model.add(s); return s; });
      const leadPulse = new T.Sprite(pulseMat); leadPulse.scale.set(0.3, 0.3, 1); model.add(leadPulse);

      // ---- camera framing
      const fit = (aspect) => {
        const dir = new T.Vector3(-0.72, 0.52, 0.9).normalize();
        const radius = 1.95;
        const fovV = T.MathUtils.degToRad(camera.fov);
        const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
        const dist = (radius / Math.sin(Math.min(fovV, fovH) / 2)) * (aspect > 1.5 ? 0.66 : 0.86); // wide slots are height-limited; the pack is flat
        camera.position.copy(dir.multiplyScalar(dist)).add(new T.Vector3(-0.2, 0, 0));
        camera.lookAt(-0.2, -0.05, 0);
      };
      const resize = () => {
        const { width, height } = host.current.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height);
        camera.aspect = width / height; camera.updateProjectionMatrix(); fit(camera.aspect);
      };
      const observer = new ResizeObserver(resize); observer.observe(host.current); resize();

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      let visible = true, value = latest.current.soc ?? 0, frame, previous = performance.now(), phase = 0, leadPhase = 0;
      const intersection = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); intersection.observe(host.current);
      const cA = new T.Color(), white = new T.Color(0xffffff), tmp = new T.Vector3();

      function draw(now) {
        frame = requestAnimationFrame(draw);
        const dt = Math.max(0, Math.min((now - previous) / 1000, 0.1)); previous = now;
        if (!visible || document.hidden) return;
        const s = latest.current, known = s.active && Number.isFinite(s.soc), still = reduced.matches || !s.active;
        value += ((known ? s.soc : 0) - value) * (still ? 1 : 1 - Math.exp(-dt * 3));
        cA.setHex(s.critical ? 0xe0503f : s.low ? 0xe0a23a : s.charging ? 0x3aa8ff : 0x22d36b);
        coreMat.emissive.copy(cA); coreMat.color.copy(cA).multiplyScalar(0.25); haloMat.color.copy(cA); cellGlowMat.color.copy(cA);
        pulseMat.color.copy(cA).lerp(white, 0.35);
        const breathe = still ? 1 : 0.92 + Math.sin(now * 0.0016) * 0.08;
        coreMat.emissiveIntensity = known ? (0.55 + value * 0.45) * breathe : 0;
        haloMat.opacity = known ? 0.05 + value * 0.08 : 0;
        cellGlowMat.opacity = known ? (0.18 + value * 0.35) * breathe : 0;
        // every cell fills from one end to the same level (series pack)
        const v = Math.max(0.001, value);
        for (const c of cells) {
          c.core.visible = c.halo.visible = c.glow.visible = known && value > 0.002;
          c.core.scale.y = v; c.halo.scale.y = v;
          c.core.position.x = c.halo.position.x = c.glow.position.x = c.cx - ((1 - v) * c.len) / 2;
          c.glow.scale.set(0.5 + 1.2 * v, 0.9, 1);
        }
        // SOC indicator on the BMS (quartiles)
        const lit = known ? Math.ceil(value * 4 - 0.02) : 0;
        leds.forEach((l, i) => { l.material = i < lit ? ledOn : ledOff; });
        ledOn.emissiveIntensity = still ? 2.2 : 1.9 + Math.sin(now * 0.004) * 0.35;
        bmsGlowMat.opacity = known ? 0.3 + (s.charging ? 0.25 : 0) + (still ? 0 : Math.sin(now * 0.002) * 0.06) : 0.08;
        // current flow
        const amps = Number.isFinite(s.current) ? Math.abs(s.current) : 0;
        const flowing = s.active && known && amps > 0.002 && !still;
        const speed = Math.min(0.9, 0.12 + amps * 1.1);
        phase = (phase + dt * speed) % 1; leadPhase = (leadPhase + dt * speed * 1.6) % 1;
        pulses.forEach((p, i) => {
          p.visible = flowing;
          if (!flowing) return;
          let t = (phase + i / pulses.length) % 1; if (s.charging) t = 1 - t;
          series.getPoint(t, tmp); p.position.copy(tmp);
        });
        leadPulse.visible = flowing;
        if (flowing) { lead.getPoint(s.charging ? 1 - leadPhase : leadPhase, tmp); leadPulse.position.copy(tmp); }
        // slow presentation drift (off when reduced motion is requested)
        pivot.rotation.y = still ? 0 : Math.sin(now * 0.00022) * 0.16;
        pivot.position.y = still ? 0 : Math.sin(now * 0.0009) * 0.025;
        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(draw);
      const contextLost = (e) => { e.preventDefault(); setFallback(true); };
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      cleanup = () => {
        cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect();
        renderer.domElement.removeEventListener('webglcontextlost', contextLost);
        disposables.forEach((d) => d.dispose?.());
        env.dispose(); renderer.dispose(); renderer.domElement.remove();
      };
    }).catch(() => { if (!disposed) setFallback(true); });
    return () => { disposed = true; cleanup(); };
  }, []);

  return (
    <div className="battery-module" role="img" aria-label={`3S2P Li-ion pack, ${active&&Number.isFinite(soc) ? `${(soc * 100).toFixed(1)} percent, ${charging ? 'charging' : 'discharging'}` : 'waiting for live telemetry'}`} data-level={active?soc??'unavailable':'unavailable'} ref={host}>
      {fallback && <Battery soc={soc} current={current} low={low} />}
    </div>
  );
}
