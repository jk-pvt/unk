# Screenshot review fixes — 2026-10-01

The review's software changes are implemented without changing the tested policy, installed sensor/TFT firmware or mounted wiring.

## Spectrogram

The old STFT always used 256 samples, giving approximately 3.9 kHz frequency resolution at the 1 MHz reference rate. It could not resolve the 1 kHz murky-profile sweep clearly. The new window scales with pulse duration and sweep bandwidth: the 8 ms / 1 kHz profile uses 2048 samples (approximately 488 Hz resolution); the 2 ms / 4 kHz profile uses 512 samples (approximately 1.95 kHz resolution).

Frequency/time axes show the actual buffer extent. Colors show power relative to the frame collection's strongest bin. A white spectral-centroid trajectory is calculated from each STFT spectrum for LFM/geometric TX references. It is not an ideal chirp curve drawn from configuration; reversing the actual C samples reverses the trajectory. Zero padding interpolates bins and does not claim improved physical resolution. Barker-13 does not receive a sweep trajectory. Silent samples produce no trajectory.

TX and RX spectrograms retain their source buffers and distinct accessible labels. Identical repeated sample arrays reuse the chart calculation; changed samples recompute even with the same configuration.

## Independent status

The common state now distinguishes:

- **COMPUTED TX:** active when a reference buffer matching the applied configuration exists.
- **MODELED RX:** active when its corresponding modeled buffer exists.
- **PHYSICAL DAC · TELEMETRY:** active only when fresh board telemetry reports it. Legacy loopback is explicitly identified as LOOPBACK. Disconnected/stale data cannot show live DAC activity; replay shows RECORDED.

The pulse scheduler is separate. Stopping pulses or expiring the web lease does not invalidate the last applied reference and modeled buffers. The UI describes a stopped scheduler in plain language, while raw inhibition/fault codes remain under Output diagnostics. Start remains gated by input qualification and faults. No lease or stop behavior was removed.

Scope status remains in Validation. No scope measurements, transducer emissions or acoustic receptions were invented.

## Verification

74 automated tests passed, zero failed/skipped; production dashboard build passed. New checks cover narrow chirp trajectories from actual C samples, reversed-sample direction, silence, coded pulses, stopped-reference availability, and independent physical DAC provenance. Browser inspection covered Clear/Muddy spectrograms and stopped reference visibility, without page errors.

Firmware source and binary were not changed by this review. Both ARM builds from the preceding implementation remain available; this change did not flash them.

## Physical evidence still required

The installed sensor/TFT image reports its own fixed DAC loopback, not web-controlled adaptive PA4 output. Computed preset changes do not prove changes to that physical loopback. The adaptive binary, compatible A0 bench input, analog filter/op-amp/amplifier and scope capture must be demonstrated separately before claiming the transmitter requirement is complete. Physical RX and wet tests validate a broader sonar system; they are not proven by modeled RX.

The user's no-flash/fixed-wiring instruction remains in effect. Use the existing [bench checklist](../firmware/ADAPTIVE_BENCH.md#physical-acceptance--all-pending) and [installation handoff](ADAPTIVE_FIRMWARE_HANDOFF.md) when the physical bench is ready.
