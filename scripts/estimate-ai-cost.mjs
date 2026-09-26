// Offline planning calculator. No API calls; not a billing cap or measured usage.
// Rates and assumptions are documented in docs/ai-guide-spec.md (2026-09-18).
import fs from 'node:fs';

const yenPerUsd = 160; // Planning assumption, not a live exchange rate.
const rates = {
  mini: { audioIn: 10, audioOut: 20, textIn: 0.6, textOut: 2.4 },
  standard: { audioIn: 32, audioOut: 64, textIn: 4, textOut: 24 },
  text: { input: 0.4, output: 1.6 }, // gpt-4.1-mini, standard processing
  livePerMinute: 0.05,
  transcribePerMinute: 0.003, // gpt-4o-mini-transcribe estimated minute price
  jevInput: 0.042, // per million input tokens
  aivisPerCharacterYen: 440 / 10000,
};
const assumptions = {
  secondsPerSession: 90,
  responsesPerSession: 3,
  userSecondsPerResponse: 12,
  assistantSecondsPerResponse: 12,
  baseInputTextTokensPerResponse: 2000,
  outputTextTokensPerResponse: 120,
  aivisCharactersPerResponse: 80,
  jevCallsPerSession: 3,
  jevInputTokensPerCall: 1000,
  cacheDiscount: false,
  planningMultiplier: 2,
};
const n = assumptions.responsesPerSession;
const previousTurns = n * (n - 1) / 2;
const userAudio = assumptions.userSecondsPerResponse * 10;
const assistantAudio = assumptions.assistantSecondsPerResponse * 20;
// Charge previous user and assistant audio again as uncached input.
const tokens = {
  audioIn: userAudio * n * (n + 1) / 2 + assistantAudio * previousTurns,
  audioOut: assistantAudio * n,
  textIn: assumptions.baseInputTextTokensPerResponse * n + assumptions.outputTextTokensPerResponse * previousTurns,
  textOut: assumptions.outputTextTokensPerResponse * n,
};
const jevUsd = assumptions.jevCallsPerSession * assumptions.jevInputTokensPerCall * rates.jevInput / 1e6;
const textUsd = (tokens.textIn * rates.text.input + tokens.textOut * rates.text.output) / 1e6;
const realtimeUsd = (r) => (tokens.audioIn * r.audioIn + tokens.audioOut * r.audioOut + tokens.textIn * r.textIn + tokens.textOut * r.textOut) / 1e6 + jevUsd;
const perSessionYen = {
  buttonsAndLocalGuide: 0,
  textAndLocalVoice: (textUsd + jevUsd) * yenPerUsd,
  realtimeMini: realtimeUsd(rates.mini) * yenPerUsd,
  realtimeStandard: realtimeUsd(rates.standard) * yenPerUsd,
  liveWithTextBackend: (assumptions.secondsPerSession / 60 * rates.livePerMinute + textUsd + jevUsd) * yenPerUsd,
  aivisWithTranscriptionAndText: (textUsd + jevUsd + n * assumptions.userSecondsPerResponse / 60 * rates.transcribePerMinute) * yenPerUsd + n * assumptions.aivisCharactersPerResponse * rates.aivisPerCharacterYen,
};
const counts = [
  { label: 'small-20', sessions: 20 },
  { label: 'exhibition-100', sessions: 100 },
  { label: 'one-device-8h', sessions: 8 * 3600 / assumptions.secondsPerSession },
  { label: 'four-devices-8h', sessions: 4 * 8 * 3600 / assumptions.secondsPerSession },
];
const scenarios = counts.map(({ label, sessions }) => ({
  label, sessions, voiceMinutes: sessions * assumptions.secondsPerSession / 60,
  costs: Object.fromEntries(Object.entries(perSessionYen).map(([key, value]) => [key, {
    calculatedYen: Math.round(value * sessions),
    planningYen: Math.ceil(value * sessions * assumptions.planningMultiplier / 100) * 100,
  }])),
}));
// Selected architecture: TypeSafe observes the world independently of human conversations.
// The earlier per-conversation comparison above remains historical, not the primary estimate.
const observationAssumptions = {
  intervalSeconds: 10, minimumIntervalSeconds: 5, callsPerSnapshot: 1,
  inputTokensPerCall: 1000, retries: 0,
};
const cost = (usd) => ({
  calculatedYen: Math.round(usd * yenPerUsd),
  exactYen: Number((usd * yenPerUsd).toFixed(6)),
  planningYen: Math.ceil(usd * yenPerUsd * assumptions.planningMultiplier / 100) * 100,
});
const observationCallUsd = observationAssumptions.inputTokensPerCall * rates.jevInput / 1e6;
function estimate({ label, conversations, observationHours, independentWorlds = 1,
  secondsPerConversation = assumptions.secondsPerSession }) {
  const voiceMinutes = conversations * secondsPerConversation / 60;
  const typesafeCalls = Math.ceil(observationHours * 3600 / observationAssumptions.intervalSeconds)
    * independentWorlds * observationAssumptions.callsPerSnapshot;
  const voiceUsd = voiceMinutes * rates.livePerMinute;
  const backendUsd = conversations * textUsd;
  const observationUsd = typesafeCalls * observationCallUsd;
  return {
    label, conversations, secondsPerConversation, voiceMinutes, observationHours,
    independentWorlds, typesafeCalls,
    components: { voice: cost(voiceUsd), optionalTextBackend: cost(backendUsd), observation: cost(observationUsd) },
    liveAndObservation: cost(voiceUsd + observationUsd),
    withTextBackend: cost(voiceUsd + observationUsd + backendUsd),
  };
}
const selectedScenarios = [
  { label: 'small-20-one-hour', conversations: 20, observationHours: 1 },
  { label: 'exhibition-100-eight-hours', conversations: 100, observationHours: 8 },
  { label: 'one-device-8h', conversations: 320, observationHours: 8 },
  { label: 'four-devices-one-world-8h', conversations: 1280, observationHours: 8 },
  { label: 'four-devices-four-worlds-8h', conversations: 1280, observationHours: 8, independentWorlds: 4 },
].map(estimate);
const durationSensitivity = [90, 180, 300].map(secondsPerConversation => estimate({
  label: `100-conversations-${secondsPerConversation}s`, conversations: 100,
  secondsPerConversation, observationHours: 8,
})); // Fixed three backend responses: isolates connected voice duration.
const observationSensitivity = [30, 10, 5].map(intervalSeconds => {
  const calls = 8 * 3600 / intervalSeconds;
  const typesafeUsd = calls * observationCallUsd;
  const narrativeUsd = calls * (2000 * rates.text.input + 120 * rates.text.output) / 1e6;
  return { hours: 8, independentWorlds: 1, intervalSeconds, calls,
    typesafeOnly: cost(typesafeUsd),
    withOptionalTextEverySnapshot: cost(typesafeUsd + narrativeUsd),
  };
});
const result = { rateDate: '2026-09-18',
  selectedArchitecture: 'gpt-live-1 human assist + independent TypeSafe flight observer',
  backendEstimateModel: 'gpt-4.1-mini (optional, not a final model selection)',
  yenPerUsd, rates, assumptions, observationAssumptions,
  tokensPerSession: tokens, selectedScenarios, durationSensitivity, observationSensitivity,
  historicalPerConversationComparisons: scenarios,
  exclusions: ['USD-provider taxes and FX fees', 'Cloudflare overages or plan change', 'unknown future MCP provider fees', 'initial development/evaluation calls'],
  limitations: ['Planning multiplier is not a guaranteed maximum or configured spending limit.',
    'Extra tool responses, reconnects, and longer context change costs.',
    'Eight-hour rows assume separate 90-second sessions, not unbounded conversation history.',
    'Primary observation cost is per world, not per participant. Solo worlds each need an observer.',
    'One TypeSafe call per snapshot, no retry. Extra classifiers and per-viewpoint judgments add cost.',
    'WebRTC initialization is included in normal 90-second sessions; failed or short starts may add cost.',
    'Optional text generation on every snapshot is a sensitivity case, not the selected default.'] };
const json = JSON.stringify(result, null, 2);
const outputAt = process.argv.indexOf('--out');
if (outputAt !== -1) {
  const filename = process.argv[outputAt + 1];
  if (!filename) throw new Error('--out requires a path');
  fs.writeFileSync(filename, json + '\n');
}
console.log(json);
