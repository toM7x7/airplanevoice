export interface SoundDesign {
  body: number;
  fan: number;
  air: number;
}
export const DEFAULT_SOUND: SoundDesign = { body: 1, fan: 0.15, air: 0.08 };
export function checkedSound(value: unknown): SoundDesign {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("音の設定を確認してください。");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 3 ||
    !["body", "fan", "air"].every(
      (k) =>
        typeof v[k] === "number" &&
        Number.isFinite(v[k]) &&
        (v[k] as number) >= 0 &&
        (v[k] as number) <= 1,
    )
  )
    throw new Error("音の各設定は0〜1です。");
  return { body: v.body as number, fan: v.fan as number, air: v.air as number };
}
