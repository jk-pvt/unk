#!/usr/bin/env python3
"""Renders every pod part with OpenSCAD and checks the meshes against params.json: compiles without warnings, closed (every edge shared by two
triangles), positive volume, and bounding boxes equal to the design numbers. It checks the SOURCE against its own parameters. It cannot tell whether
the parameters match your real parts, so a pass here is not 'ready to print' (see check_fit.py).
    python3 hardware/enclosure/render_verify.py [output_dir]      # default: a temporary directory; exit 2 if openscad is not installed"""
import collections, json, pathlib, re, shutil, subprocess, sys, tempfile
here = pathlib.Path(__file__).parent
P = json.loads((here / "params.json").read_text())
exe = shutil.which("openscad")
if not exe:
    print("openscad not installed (macOS: brew install --cask openscad@snapshot)"); sys.exit(2)
subprocess.run([sys.executable, str(here / "check_fit.py")], capture_output=True)       # regenerates params.scad
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="pod-stl-"))
out.mkdir(parents=True, exist_ok=True)
t, c, d = P["tube"], P["cap"], P["deck"]
deck_l = d["end_margin"] * 2 + P["nucleo"]["l"] + d["gap_between_boards"] + P["afe"]["l"]
expect = {"tube": (t["od"], t["od"], t["length"]), "cap_a": (t["od"], t["od"], c["flange_t"] + c["spigot_depth"]), "cap_b": (t["od"], t["od"], c["flange_t"] + c["spigot_depth"]),
          "deck": (t["od"] - 2 * t["wall"] - 2 * d["side_clearance"], None, deck_l), "all": (t["od"], t["od"], t["length"] + 2 * c["flange_t"])}
bad = 0
for part, size in expect.items():
    stl = out / f"{part}.stl"
    r = subprocess.run([exe, "-D", f'part="{part}"', "-o", str(stl), str(here / "pod.scad")], capture_output=True, text=True)
    problems = [l for l in (r.stdout + r.stderr).splitlines() if re.search(r"WARNING|ERROR", l)]
    txt = stl.read_text() if stl.exists() else ""
    v = [tuple(map(float, m)) for m in re.findall(r"vertex\s+(\S+)\s+(\S+)\s+(\S+)", txt)]
    if r.returncode or not v or problems:
        print(f"FAIL {part}: openscad exit {r.returncode} {problems[:2]}"); bad += 1; continue
    tris = [tuple(v[i:i + 3]) for i in range(0, len(v), 3)]
    key = lambda p: tuple(round(x, 4) for x in p)
    edges = collections.Counter()
    for a, b, cc in tris:
        for p, q in ((a, b), (b, cc), (cc, a)): edges[frozenset((key(p), key(q)))] += 1
    open_edges = sum(1 for n in edges.values() if n != 2)
    vol = sum((a[0] * (b[1] * cc[2] - b[2] * cc[1]) - a[1] * (b[0] * cc[2] - b[2] * cc[0]) + a[2] * (b[0] * cc[1] - b[1] * cc[0])) / 6 for a, b, cc in tris)
    dims = tuple(max(x[k] for x in v) - min(x[k] for x in v) for k in range(3))
    dims_ok = all(e is None or abs(dims[i] - e) < 0.05 for i, e in enumerate(size))
    ok = open_edges == 0 and vol > 0 and dims_ok
    print(f"{'PASS' if ok else 'FAIL'} {part:6} {dims[0]:.2f} x {dims[1]:.2f} x {dims[2]:.2f} mm, {len(tris)} triangles, open edges {open_edges}, volume {vol / 1000:.1f} cm3")
    bad += not ok
print(f"STL files: {out}")
sys.exit(1 if bad else 0)
