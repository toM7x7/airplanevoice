import {
  DEFAULT_SOUND,
  checkedSound,
  type SoundDesign,
} from "../../../packages/core/src/sound-design";
// Authored turbofan-like synthesis, not a recording or a prediction of a real engine.
// Three bands of correlated air noise plus broad fan harmonics; deterministic
// buffers keep offline playback and comparisons independent of network/media.
export function engineSignal(
  sampleRate: number,
  engines: 2 | 4,
  seconds = 4,
  design: SoundDesign = DEFAULT_SOUND,
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
  const tone = checkedSound(design);
  const samples = new Float32Array(Math.floor(sampleRate * seconds));
  const coefficient = (hz: number) =>
    1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
  // Separate noise sources and bands: controls change the mixture, not just
  // the gain of one shared rumble. Mid-band harmonics survive small speakers.
  const lowCut = coefficient(150), bodyCut = coefficient(430);
  const airLowCut = coefficient(650), airHighCut = coefficient(2400);
  let seed = 92821 + engines, deep = 0, body = 0, airLow = 0, airHigh = 0, rounded = 0, sum = 0;
  const rounding = coefficient(850 + tone.air * 1500);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
  const fanHz = engines === 4 ? 112 : 137;
  for (let i = 0; i < samples.length; i++) {
    const n = random(), wind = random(), t = i / sampleRate;
    deep += lowCut * (n - deep);
    body += bodyCut * (n - body);
    airLow += airLowCut * (wind - airLow);
    airHigh += airHighCut * (wind - airHigh);
    const phase = 2 * Math.PI * fanHz * t + 0.18 * Math.sin(2 * Math.PI * .65 * t);
    const fanLayer = (Math.sin(phase) * .36 + Math.sin(phase * 2 + .4) * .3
      + Math.sin(phase * 3 + 1.3) * .22 + Math.sin(phase * 4 + .7) * .12)
      * (1 + .1 * Math.sin(2 * Math.PI * 1.5 * t));
    const bodyLayer = (deep * 3.2 + (body - deep) * 2.4)
      * (1 + .12 * Math.sin(2 * Math.PI * .8 * t));
    const airLayer = (airHigh - airLow) * 3.5;
    const value = bodyLayer * (.08 + tone.body ** 2 * 1.5)
      + fanLayer * (.015 + tone.fan ** 2 * 1.3)
      + airLayer * (.01 + tone.air ** 2 * .9);
    rounded += rounding * (value - rounded);
    samples[i] = rounded;
    sum += rounded * rounded;
  }
  // Match source loudness across patterns; engine count changes timbre, not loudness.
  const gain = 0.155 / Math.sqrt(sum / samples.length);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}
