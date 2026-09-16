import { compileRoute } from "./route";
import {
  DEFAULT_WORKSHOP,
  parseWorkshop,
  workshopSpec,
  type WorkshopRecipe,
} from "./workshop";

export const ROOM_PROTOCOL = "airplanevoice-room-v1";
export const ROOM_TTL_MS = 60 * 60 * 1000;
export interface SharedFlight {
  id: string;
  recipe: WorkshopRecipe;
  startsAt: number;
  endsAt: number;
  clearAt: number;
  checksum: string;
}
export interface RoomState {
  protocol: typeof ROOM_PROTOCOL;
  revision: number;
  draft: WorkshopRecipe;
  flights: SharedFlight[];
  expiresAt: number;
  recentOperations: string[];
}
export type RoomOperation =
  | { id: string; revision: number; type: "edit"; recipe: WorkshopRecipe }
  | { id: string; revision: number; type: "launch" | "cancel-next" };

export function checkedWorkshop(input: unknown) {
  const recipe = parseWorkshop(JSON.stringify(input));
  const route = compileRoute(workshopSpec(recipe, 0));
  return { recipe, route };
}
export function newRoom(now: number): RoomState {
  return {
    protocol: ROOM_PROTOCOL,
    revision: 0,
    draft: structuredClone(DEFAULT_WORKSHOP),
    flights: [],
    expiresAt: now + ROOM_TTL_MS,
    recentOperations: [],
  };
}
/** Pure authority transition. Nothing is broadcast until this result is persisted. */
export function changeRoom(
  state: RoomState,
  value: unknown,
  now: number,
): RoomState {
  if (now >= state.expiresAt)
    throw new Error("この部屋は終了しました。新しい部屋を作れます。");
  if (!value || typeof value !== "object")
    throw new Error("操作を読み取れませんでした。");
  const op = value as RoomOperation;
  if (typeof op.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(op.id))
    throw new Error("操作IDを確認してください。");
  if (state.recentOperations.includes(op.id)) return state;
  if (!Number.isSafeInteger(op.revision) || op.revision !== state.revision)
    throw new Error(
      "相手が先に変更しました。最新の設定を見て、もう一度操作してください。",
    );
  const next = structuredClone(state);
  if (op.type === "edit") next.draft = checkedWorkshop(op.recipe).recipe;
  else if (op.type === "launch") {
    const pending = state.flights.filter((f) => f.startsAt > now);
    if (pending.length)
      throw new Error("次の便は予約済みです。取り消してから変更できます。");
    const { recipe, route } = checkedWorkshop(state.draft);
    const active = state.flights.find(
      (f) => f.startsAt <= now && f.clearAt > now,
    );
    const startsAt = Math.max(now + 2500, active?.clearAt ?? 0);
    // Shared preview observes around the ground origin. Include a 100 m local walking margin.
    const tail =
      Math.ceil(
        ((Math.max(
          ...route.samples.map((s) =>
            Math.hypot(s.position.x, s.position.y - 1.7, s.position.z),
          ),
        ) +
          100) /
          343) *
          1600,
      ) + 2000;
    const endsAt = startsAt + route.durationMs;
    next.flights = [
      ...(active ? [active] : []),
      {
        id: op.id,
        recipe,
        startsAt,
        endsAt,
        clearAt: endsAt + tail,
        checksum: route.checksum,
      },
    ];
  } else if (op.type === "cancel-next") {
    if (!state.flights.some((f) => f.startsAt > now))
      throw new Error("取り消す次の便はありません。");
    next.flights = state.flights.filter((f) => f.startsAt <= now);
  } else throw new Error("対応していない操作です。");
  next.revision++;
  next.recentOperations = [...state.recentOperations.slice(-31), op.id];
  return next;
}
