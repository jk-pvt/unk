# Photo-based payload reconstruction

The seven photographs in `docs/reference/prototype` are the source for this model. Coordinates use X along the tube (power bay at negative X, probe end at positive X), Y up, and Z toward the broad photographed side. Dimensions below are estimates for visual reconstruction, not fabrication CAD or verified hardware specifications.

## Component map, established before modeling

| Assembly / model ID | Photo evidence | Position and orientation | Approximate dimensions |
|---|---|---|---|
| `housing` | All views: straight, clear cylinder | X axis; constant diameter | 760 mm long, 180 mm OD, 3 mm wall; about 4.2:1 |
| `front-cap`, `rear-cap` | Thin transparent circular plates; no metal pressure flanges | Flat YZ discs at both ends | 180 mm diameter, 4 mm thick |
| `frame` | Low left tray, elevated central tray, two full internal clear discs | Discs near X −65 and +180; central tray about Y −8 | Left tray 290 × 120; central tray 245 × 130 mm |
| `rods` | Pale rods around large display | Four X-axis rods, right bay only | About 200 mm long, 4 mm diameter |
| `controller-board` | Blue UNO-style board on a clear stand at left | Horizontal, X −260; front of orange battery | About 69 × 54 mm; exact board identity unverified |
| `power-module` | Green terminal board at far left rear | Behind controller, horizontal | About 70 × 45 mm; chip identity obscured |
| `heatsink` | Black finned module at far left front | Horizontal board, fins upright | About 58 × 45 mm; module identity unverified |
| `aux-battery` | Upright orange/black commercial pack behind cells | X −155, label toward camera | About 80 × 86 × 40 mm; label artwork is decorative |
| `battery` | Two exposed violet cells taped together | X −90, low/front, axes along X | Visible cells modeled as 18 × 65 mm; unseen cell count not inferred |
| `stm32` | White controller among central headers/wires; matched to repository NUCLEO inventory | Horizontal in central bay, behind local TFT | Nucleo-64 board 82.5 × 70 mm; partially obscured placement estimated |
| `compute-module` | Silver finned cooler and circular fan on left side of middle tray | Horizontal X −25, behind TFT | About 60 × 55 mm; processor identity unverified |
| `display` | Red local TFT near front of middle tray | Upright, screen facing +Z, X −5 | About 58 × 36 mm board; ST7735 inventory match |
| `sensor-modules` | Small blue/black breakout boards, terminals, white plugs, LEDs | Front edge of middle tray | Individual visible board footprints reproduced; exact hidden ICs not asserted |
| `instrument-case` | Large dark enclosure directly beneath central tray | X +57, Y −38; below electronics | About 196 × 52 × 94 mm; contents obscured |
| `large-display` | Large dark screen at right, silver bezel, slight backward lean | Landscape X/Y plane, facing +Z | About 164 × 98 mm; display type unverified |
| `wrapped-module` | Blue taped object below large screen, black cable coil | Right bay, low/front | Irregular enclosure, about 75 × 48 × 45 mm; contents unknown |
| `hc-sr04` | Two silver circular cans on a blue board at probe end | Board in YZ plane; cans point +X | Visible ultrasonic-module form, not an underwater capability claim |
| `tds` | White cylindrical probe with metal tip at right end | Through end plate, +X | Approximate white body and electrode tips |
| `ds18b20` | Thin stainless probe below white probe | Through end plate, +X | Approximate 6 mm diameter, 50 mm exposed length |
| `turbidity` | Translucent capped probe near lower front | Through right plate, +X | Approximate 24 mm diameter |
| `pressure` | Larger threaded stainless body near bottom | Through right plate, +X | Approximate 25 mm body diameter, hex shoulder |
| `switch` | Black rocker at upper right end | Outward-facing on right plate | About 25 × 19 mm |
| `wiring` | Multicolored loose harness across central tray; blue USB loop; rear cable coil | Curved routes between connectors; end cable uses plate port | Cable diameters roughly 1–4 mm |
| `identity` | Indian flag and AquaSDR label on left bay | Facing photographed side | Photo-relative label sizes |

No old under-body piezo pair, invented analog board or metal O-ring caps is retained. Hidden electronics are not inferred from the old concept model. Small breakout chips are visual surface detail, not an identification of their electrical function.

## Build and rendering

Run `npm run model:build` to regenerate `public/models/aquasdr-payload.glb` with the existing Three.js GLTF exporter. The script builds real meshes, merges small static geometry per material/assembly, embeds PNG label/screen textures, and records component IDs, home positions and explosion vectors in GLB extras. No photograph is used as the model surface or as a substitute for geometry.

Explosion is coaxial by bay: left power assemblies move left, middle electronics remain centered, and right display/probe assemblies move right. Cap separation is greater than bay separation. Shell and transverse bulkheads remain coaxial. Flexible crossing cables are regenerated between moving anchors by the viewer so their endpoints remain attached. Component selection changes the camera/highlight only, not physical placement.

The approximate dimensions, hidden board placement, cable paths and obscured probe details remain visual estimates. No watertightness, sensor commissioning or measured-CAD claim is implied by the render.

## Verification

- Self-contained GLB: 31 selectable assemblies, 85,102 triangles, approximately 2.98 MiB, five embedded PNG decals. Toolbar labels come from the generated manifest and only name modeled parts.
- Browser: assembled, housing toggle, internal view, explosion at 0/30/60/100%, component focus, reset, orbit, right-drag pan, Alt-wheel zoom and automatic rotation verified. Automatic rotation is approximately one orbit per 18.75 seconds and respects reduced motion.
- Camera fit uses sampled mesh surfaces rather than only the cylinder's bounding box. It refits after resizing/exploding and during automatic rotation. No second WebGL renderer is created for the inspector.
- Mission remains scroll-locked with all surrounding cards visible at 1280 × 720 and 1470 × 846. Live payload telemetry remains connected.
- Browser rotation sample: 119 frame intervals, mean 16.666 ms, 95th percentile 16.7 ms on the development machine. This is an observed browser-frame result, not a guarantee for other GPUs.
- All 89 automated tests passed; the production build passed. Model-specific checks cover GLB integrity, embedded assets, matching component IDs, transparent cap materials, coaxial explosion, valid cable anchors and geometry budget. Final targeted tests passed after the visual refinements.

## Changed files

- `scripts/build-payload-model.mjs`: reproducible photo-based procedural mesh and embedded decal build.
- `public/models/aquasdr-payload.glb`: replacement model.
- `src/ui/payload-parts.json`, `src/ui/payload-model-info.json`: generated component inventory and asset cache hash.
- `src/ui/PayloadViewport.jsx`: mesh-surface camera fitting, restrained lights, shared material handling, flexible explosion bridges and resource disposal; removed the previous illustrative wave rings and old-model image fallback.
- `src/ui/PayloadScene.jsx`, `src/ui/PayloadTelemetry.jsx`: matching controls/inspection descriptions, assembled default and photographic reconstruction context.
- `src/ui/Welcome.jsx`, `src/pages/pages.jsx`: shared model starts assembled; consistent camera hint.
- `package.json`, `package-lock.json`: model build command and build-only canvas dependency for embedded labels.
- `tests/payload-model.test.js`: asset and assembly checks.
- `docs/reference/prototype/`: the seven supplied source photographs retained for future matching.

## Remaining approximation

This is a hand-reconstructed procedural mesh, not a measured scan. Tube dimensions, obscured board mounting, small connectors, cable topology and some probe details are estimates. Visible boards with uncertain identity retain generic descriptive names. Fine scratches, glue contours, individual resistor markings and exact display glass reflections are simplified. No unseen board circuitry or electrical functionality is asserted. Source photos remain authoritative for a later measured revision.
