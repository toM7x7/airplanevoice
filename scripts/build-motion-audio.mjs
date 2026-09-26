import { mkdir, writeFile } from "node:fs/promises";
// Gentle, original synthetic wind/hum. Deterministic samples; no third-party assets.
const rate = 48000,
  duration = 9,
  count = rate * duration;
for (const [index, style] of ["lift", "trail", "ripple"].entries()) {
  const pcm = Buffer.alloc(count * 4);
  let seed = 47,
    low = 0,
    phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    let left = 0,
      right = 0;
    for (const start of [0.75, 5.9]) {
      const u = (t - start - (style === "ripple" ? 0.32 : 0)) / 1.65;
      if (u < 0 || u > 1) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      low += 0.035 * ((seed / 4294967296) * 2 - 1 - low);
      phase += ((92 - u * 23 + index * 9) * 2 * Math.PI) / rate;
      const env = Math.sin(Math.PI * u) ** 2;
      const sample =
        env *
        (low * 0.23 + Math.sin(phase) * 0.025 + Math.sin(phase * 1.99) * 0.009);
      const pan = style === "trail" ? -0.7 + 1.4 * u : 0;
      left += sample * Math.sqrt((1 - pan) / 2);
      right += sample * Math.sqrt((1 + pan) / 2);
    }
    pcm.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, left)) * 32767),
      i * 4,
    );
    pcm.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, right)) * 32767),
      i * 4 + 2,
    );
  }
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  for (const dir of [
    "apps/desktop/public/motion-audio",
    "motion-film/public/motion-audio",
  ]) {
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${style}.wav`, Buffer.concat([h, pcm]));
  }
}
console.log("Created 3 original stereo motion cues, 48 kHz / 9 s.");
