import type { RoomState, SharedFlight } from "./shared-room";
import type { WorkshopRecipe } from "./workshop";

const settings = (recipe: WorkshopRecipe) => ({
  engines: recipe.aircraft.engineCount,
  altitudeM: recipe.route.altitudeM,
  speedMps: recipe.flight.speedMps,
});
const flight = (value: SharedFlight) => ({
  id: value.id,
  startsAt: value.startsAt,
  endsAt: value.endsAt,
  clearAt: value.clearAt,
  settings: settings(value.recipe),
});

/** Read-only facts for UI, speech, and future AI. Never includes room credentials.
 * Recipe values are settings, not measurements of the current aircraft pose.
 */
export function observeRoom(
  state: RoomState | null,
  now: number,
  connected: boolean,
) {
  const available = !!state && connected && now < state.expiresAt;
  const current = available
    ? state.flights.find((f) => f.startsAt <= now && now < f.clearAt)
    : undefined;
  const next = available
    ? state.flights.find((f) => f.startsAt > now)
    : undefined;
  const phase = !state
    ? "no-room"
    : now >= state.expiresAt
      ? "expired"
      : !connected
        ? "offline"
        : current
          ? now < current.endsAt
            ? "flying"
            : "arrival"
          : next
            ? "scheduled"
            : "idle";
  return {
    sampledAt: now,
    revision: state?.revision ?? null,
    phase,
    current: current ? flight(current) : null,
    next: next ? flight(next) : null,
    draft: available ? settings(state.draft) : null,
    repeating: available && !!state.exhibition?.repeat,
  } as const;
}
export type RoomObservation = ReturnType<typeof observeRoom>;

export function describeRoom(facts: RoomObservation) {
  const title = {
    "no-room": "部屋への入室を待っています。",
    expired: "この部屋は終了しました。",
    offline: "接続を確認中です。最新の予定は確認できません。",
    flying: "旅客機が飛行中です。",
    arrival: "飛行を終え、遅れて届く音を待っています。",
    scheduled: "次の便の出発を待っています。",
    idle: "飛行の準備を待っています。",
  }[facts.phase];
  const describeSettings = (s: NonNullable<RoomObservation["draft"]>) =>
    `${s.engines}発 / 高度設定 ${s.altitudeM} m / ${Math.round(s.speedMps * 3.6)} km/h`;
  const next = facts.next
    ? `予約便：あと ${Math.max(0, Math.ceil((facts.next.startsAt - facts.sampledAt) / 1000))}秒`
    : facts.repeating
      ? "次の便：音の余韻のあと、自動で準備します。"
      : "予約便：ありません。";
  const lines = [title];
  if (facts.current)
    lines.push(`現在の便：${describeSettings(facts.current.settings)}`);
  if (facts.draft) lines.push(next);
  if (facts.next) lines.push(describeSettings(facts.next.settings));
  // No countdown or head-relative direction in speech: those can expire while spoken.
  const spoken =
    title +
    (facts.phase === "flying" && facts.current
      ? `${facts.current.settings.engines}発の旅客機です。音のする方を、ゆっくり探してみてください。`
      : facts.phase === "idle" && facts.repeating
        ? "次の便を自動で準備します。"
        : "");
  return {
    title,
    lines,
    spoken,
    draft: facts.draft ? describeSettings(facts.draft) : null,
  };
}
