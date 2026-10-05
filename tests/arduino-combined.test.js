import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPTIONS, SKETCH } from "../scripts/sync-arduino-engine.mjs";

test("combined sketch copies the shared C engine and sensor headers unchanged (one policy, not two)", () => {
  const r = spawnSync(process.execPath, ["scripts/sync-arduino-engine.mjs", "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, `engine copies drifted: ${r.stderr}. Run: node scripts/sync-arduino-engine.mjs`);
});

test("combined build options carry the TDS full scale, platform label and a build id", () => {
  const opt = readFileSync(join(SKETCH, "build_opt.h"), "utf8");
  for (const flag of OPTIONS) assert.ok(opt.includes(flag), flag);
  assert.match(opt, /-DFW_BUILD=\\"[\w.-]+\\"/);
});

test("the sketch never claims hardware it does not drive: no continuous loopback tone, adaptive packet is firmwareMode ADAPTIVE", () => {
  const ino = readFileSync(join(SKETCH, "05_sensors_adaptive_tx.ino"), "utf8");
  assert.ok(!/sonarloop/.test(ino));
  assert.ok(ino.includes("ADAPTIVE_TRANSMITTER"));
  assert.ok(ino.includes("adaptive::service"));
});

test("UART: core Serial receives, DMA Stream 6 transmits, and RX never claims DMA (USART2_RX shares Stream 5 with the DAC)", () => {
  const code = (readFileSync(join(SKETCH, "05_sensors_adaptive_tx.ino"), "utf8") + readFileSync(join(SKETCH, "AdaptiveTx.h"), "utf8")).replace(/\/\/.*$/gm, "");
  assert.ok(!/Serial\.(print|println|write|flush)/.test(code), "the core must never transmit: its interrupt TX contended with RX");
  assert.ok(code.includes("DMA1_Stream6") && code.includes("USART_CR3_DMAT"), "DMA TX");
  assert.ok(!code.includes("DMA1_Stream7") && !code.includes("USART_CR3_DMAR"), "RX DMA was tried in build 2 and received 0 bytes (wrong request mapping)");
});

// Opt-in because a first compile takes about 30 s: AQUASDR_ARDUINO_BUILD=1 npm test  (or npm run arduino:build)
// A fresh core cache is used on purpose: arduino-cli caches the compiled core by build properties, NOT by build_opt.h, so a stale
// cache silently ignored -DSERIAL_RX_BUFFER_SIZE=512 and left a 64-byte receive ring that dropped every command line over 63 bytes.
const cli = "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli";
const nm = `${process.env.HOME}/Library/Arduino15/packages/STMicroelectronics/tools/xpack-arm-none-eabi-gcc/14.2.1-1.1/bin/arm-none-eabi-nm`;
test("combined sketch compiles for the NUCLEO-F446RE with a 512-byte UART receive ring", { skip: !(process.env.AQUASDR_ARDUINO_BUILD && existsSync(cli)) && "set AQUASDR_ARDUINO_BUILD=1 (needs the Arduino IDE's arduino-cli)", timeout: 300000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "aquasdr-ino-out-"));
  const log = execFileSync(cli, ["compile", "--fqbn", "STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F446RE", "--build-cache-path", mkdtempSync(join(tmpdir(), "aquasdr-ino-cache-")),
    "--output-dir", out, SKETCH], { encoding: "utf8" });
  assert.match(log, /Sketch uses \d+ bytes/);
  if (existsSync(nm)) {
    const syms = execFileSync(nm, ["-S", join(out, "05_sensors_adaptive_tx.ino.elf")], { encoding: "utf8" });
    const m = /([0-9a-f]{8}) [bB] Serial2$/m.exec(syms);
    assert.ok(m, "Serial2 symbol");
    assert.ok(parseInt(m[1], 16) > 600, `Serial2 is ${parseInt(m[1], 16)} bytes: the core was built with the default 64-byte RX ring, so command lines over 63 bytes will be dropped`);
  }
});
