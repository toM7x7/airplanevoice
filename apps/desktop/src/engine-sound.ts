// Authored turbofan-like synthesis, not a recording or a prediction of a real engine.
// Three bands of correlated air noise plus broad fan harmonics; deterministic
// buffers keep offline playback and comparisons independent of network/media.
export function engineSignal(
  sampleRate: number,
  engines: 2 | 4,
  seconds = 4,
): Float32Array {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000 ||
    ![2, 4].includes(engines) ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 8
  )
    throw new Error("Invalid sound format");
  const samples = new Float32Array(Math.floor(sampleRate * seconds));
  const coefficient = (hz: number) =>
    1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
  const a = coefficient(200),
    b = coefficient(650),
    c = coefficient(1500);
  let seed = 92821 + engines,
    deep = 0,
    body = 0,
    air = 0,
    rounded = 0,
    sum = 0;
  const rounding = coefficient(950);
  const fan = engines === 4 ? 78 : 94;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    deep += a * (noise - deep);
    body += b * (noise - body);
    air += c * (noise - air);
    const t = i / sampleRate;
    const phase =
      2 * Math.PI * fan * t + 0.12 * Math.sin(2 * Math.PI * 0.45 * t);
    const tones =
      Math.sin(phase) * 0.06 +
      Math.sin(phase * 2 + 0.4) * 0.038 +
      Math.sin(phase * 3 + 1.3) * 0.024 +
      Math.sin(phase * 5 + 0.7) * 0.009;
    const breadth =
      engines === 4 ? 1 + 0.08 * Math.sin(2 * Math.PI * 1.3 * t) : 1;
    const value =
      (deep * 2.6 + (body - deep) * 1.1 + (air - body) * 0.13 + tones) *
      breadth;
    rounded += rounding * (value - rounded);
    samples[i] = rounded;
    sum += rounded * rounded;
  }
  // Match source loudness across patterns; engine count changes timbre, not loudness.
  const gain = 0.155 / Math.sqrt(sum / samples.length);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}
