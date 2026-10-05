# Payload pod: parametric enclosure

Status: **compiled with OpenSCAD 2026.10.01 (2026-10-02) and mesh-checked; not printed or fitted, and not print-ready.** All five parts (tube, both caps, deck, assembly) compile without warnings, are closed meshes with positive volume, and match the design dimensions (`render_verify.py`). That checks the source against its own parameters only. `check_fit.py` validates the *numbers*; it cannot validate your parts, and still ends with `READY TO PRINT: NO` until the tube bore, battery pack and analog board are measured.

## What is here

| File | Purpose |
|---|---|
| `params.json` | Single source of dimensions. Each block says `confirmed: true/false` |
| `render_verify.py` | Renders every part with OpenSCAD and checks each mesh is closed, has positive volume and matches `params.json` (exit 2 if OpenSCAD is missing) |
| `check_fit.py` | Fit and printability checks (deck length, board heights against the bore, battery clearance, bed size, cap features) and writes `params.scad` |
| `pod.scad` | OpenSCAD source: `tube`, `cap_a`, `cap_b`, `deck`, or `all` for an assembled preview |

## Before printing

1. **Measure** and put into `params.json`: the real battery pack (width, length, height, with wrap and leads), the analog board you actually build, and the Nucleo's height with your headers. Only the Nucleo outline (70.0 × 82.5 mm, ST UM1724) is a datasheet number. The battery envelope is now *derived* (3S2P of standard 18650 cells, 18.6 × 65.2 mm, plus wrap and protection board: 57.8 × 39.2 × 72.2 mm), not measured, and it clears the bore by only about 2 mm, which `check_fit.py` flags as TIGHT. `check_fit.py` ends with `READY TO PRINT: NO` until the tube bore, battery and analog board are measured.
2. `python3 hardware/enclosure/check_fit.py` must print PASS on every line. It lists which dimensions are still unconfirmed.
3. Render: install OpenSCAD (the stable Homebrew cask `openscad` was disabled on 2026-09-01; `brew install --cask openscad@snapshot` works), then `python3 hardware/enclosure/render_verify.py` renders and checks everything, or by hand:

```bash
openscad -D 'part="tube"'  -o tube.stl  hardware/enclosure/pod.scad
openscad -D 'part="cap_a"' -o cap_a.stl hardware/enclosure/pod.scad
openscad -D 'part="cap_b"' -o cap_b.stl hardware/enclosure/pod.scad
openscad -D 'part="deck"'  -o deck.stl  hardware/enclosure/pod.scad
```

4. Inspect the STLs in a slicer. Check the O-ring groove, screw holes and rails.

## Design intent

A straight cylindrical pod: 116 mm OD, 3 mm wall, 184 mm long, so it can slide into the 174 mm bore of the existing 180 mm acrylic hull as a cartridge (verify the real bore before relying on this). A flat deck on internal rails carries the Nucleo and the analog board on top, with the battery strapped underneath. Two caps with a spigot, O-ring groove and four radial M3 screws close the ends; the deck slides out of either end for service.

| Cap | Features |
|---|---|
| A | USB slot (14 × 8 mm, for the ST-LINK cable), BNC jack (Ø 9.7 mm, scope output), toggle switch (Ø 6.2 mm) |
| B | A0 potentiometer (Ø 7.2 mm), two 4 mm binding posts (Ø 4.2 mm), cable gland (Ø 8 mm) |

Suggested print: PETG, 0.2 mm layers, 4 walls, 40 % infill; tube standing on its end, caps flange-down, deck flat. Parts: 8 × M3 self-tapping screws (about 8 mm), 2 × 3 mm cord O-rings sized to the spigot, zip ties for boards and battery.

## Not claimed

Not pressure rated and not tested for water ingress; the O-ring groove is provision only. Thermal behaviour, cable strain relief and connector clearance (a BNC and USB plug need about 15–40 mm behind the cap) must be checked on the assembled unit. "Field deployable" requires that check, which has not happened.
