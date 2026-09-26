export const MAX_AUDIO_VOICES = 24;
/** Reserve a fair share for every audible aircraft instead of letting early arrivals occupy all voices. */
export function aircraftVoiceBudget(
  gains: Record<string, number | undefined>,
  id: string,
) {
  const count = Object.values(gains).filter((gain) => (gain ?? 0) > 0).length;
  return (gains[id] ?? 0) <= 0
    ? 0
    : Math.min(
        6,
        Math.max(1, Math.floor(MAX_AUDIO_VOICES / Math.max(1, count))),
      );
}
