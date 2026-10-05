import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Compiles hardware/enclosure/pod.scad with OpenSCAD and checks the meshes against params.json. Skipped when OpenSCAD is not installed.
// It verifies the CAD source against its own parameters; it does not make the enclosure print-ready (check_fit.py still says NO until measured).
test("pod parts compile, are closed meshes and match the design dimensions", (t) => {
  const r = spawnSync("python3", ["hardware/enclosure/render_verify.py"], { encoding: "utf8" });
  if (r.status === 2) { t.skip("openscad not installed"); return; }
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((r.stdout.match(/^PASS /gm) || []).length, 5);
});

test("fit check stays honest: it reports unconfirmed dimensions and refuses READY TO PRINT", () => {
  const r = spawnSync("python3", ["hardware/enclosure/check_fit.py"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /UNCONFIRMED DIMENSIONS.*tube.*afe.*battery/);
  assert.match(r.stdout, /READY TO PRINT: NO/);
});
