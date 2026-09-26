import { checkedEntry, HANGAR_LIMIT, type HangarEntry } from "./hangar";
import type { FlightId } from "./airspace";
import {
  DEFAULT_TRAFFIC,
  checkedTraffic,
  trafficCapacity,
  trafficDecision,
  trafficGapMs,
  automaticCruiseLaps,
  flightSlots,
  withFlightSlots,
  availableCruiseAltitude,
  type TrafficSettings,
  type TrafficDecision,
} from "./traffic";
import { compileShow, type ShowRecipe } from "./show";
import { recordTraffic, type TrafficHistoryEntry } from "./traffic";
import { compileRoute } from "./route";
import { withRunwayDeparture, DEPARTURE_MS } from "./departure";
import { flightJourney, journeyChecksum, instructedRoute, ARRIVAL_MS, type FlightInstruction } from "./flight-journey";
import { flightPose } from "./flight";
import {checkedEnvironment,type EnvironmentRecipe} from "./environment";
import { checkedVenue, type VenueMap } from "./venue";
import {
  DEFAULT_WORKSHOP,
  parseWorkshop,
  workshopSpec,
  type WorkshopRecipe,
} from "./workshop";

export const ROOM_PROTOCOL = "airplanevoice-room-v1";
export const ROOM_TTL_MS = 60 * 60 * 1000;
export const EXHIBITION_TTL_MS = 8 * ROOM_TTL_MS;
export const CLOUD_EXHIBITION_ID = "7e7af951-4101-4ecf-9139-a8223354b9c4";
export const DEPARTURE_QUEUE_LIMIT = 64;
export interface SharedFlight {
  id: string;
  recipe: WorkshopRecipe;
  startsAt: number;
  endsAt: number;
  clearAt: number;
  checksum: string;
  show?: ShowRecipe;
  names?: string[];
  entryIds?: string[];
  departure?: boolean;
  cruiseLaps?: number;
  slotIds?: FlightId[];
  automatic?: boolean;
  journey?: 2;
  landingDelayMs?: number;
  instructions?: FlightInstruction[];
}
export interface RoomState {
  protocol: typeof ROOM_PROTOCOL;
  revision: number;
  draft: WorkshopRecipe;
  flights: SharedFlight[];
  expiresAt: number;
  persistent?: boolean;
  recentOperations: string[];
  exhibition?: { repeat: boolean; source?: "draft" | "hangar" };
  hangar?: HangarEntry[];
  hangarCursor?: number;
  venue?: VenueMap;
  traffic?: TrafficSettings;
  environment?: EnvironmentRecipe;
  trafficDecision?: TrafficDecision;
  trafficHistory?: TrafficHistoryEntry[];
  trafficAgent?: {
    requestedAt: number;
    requests: number;
    status: "waiting" | "active" | "fallback" | "stale";
  };
}
export type RoomOperation =
  | { id:string;revision:number;type:"environment";environment:EnvironmentRecipe }
  | { id: string; revision: number; type: "flight-instruction"; flightId: string; instruction: "overhead" | "wide" | "higher"; observer: {x:number;z:number} }
  | { id: string; revision: number; type: "traffic"; settings: TrafficSettings }
  | {
      id: string;
      revision: number;
      type: "create-flight" | "create-entry";
      entry: HangarEntry;
    }
  | {
      id: string;
      revision: number;
      type: "hangar-save";
      entry: HangarEntry;
      expected?: HangarEntry | null;
    }
  | { id: string; revision: number; type: "hangar-remove"; entryId: string }
  | { id: string; revision: number; type: "venue"; venue: VenueMap }
  | { id: string; revision: number; type: "edit"; recipe: WorkshopRecipe }
  | { id: string; revision: number; type: "repeat"; enabled: boolean }
  | {
      id: string;
      revision: number;
      type: "launch" | "launch-hangar" | "cancel-next";
    };

export function checkedWorkshop(input: unknown) {
  const recipe = parseWorkshop(JSON.stringify(input));
  const route = compileRoute(workshopSpec(recipe, 0));
  return { recipe, route };
}
export function sharedFlightRoute(flight: SharedFlight) {
  const base=checkedWorkshop(flight.recipe).route;
  return instructedRoute(flight.journey === 2 ? flightJourney(base, flight.cruiseLaps ?? 2,flight.landingDelayMs) : flight.departure ? withRunwayDeparture(base,flight.cruiseLaps ?? 1) : base, flight.instructions);
}
export function newRoom(now: number, exhibition = false): RoomState {
  return {
    protocol: ROOM_PROTOCOL,
    revision: 0,
    draft: structuredClone(DEFAULT_WORKSHOP),
    flights: [],
    expiresAt: now + (exhibition ? EXHIBITION_TTL_MS : ROOM_TTL_MS),
    recentOperations: [],
    ...(exhibition ? { exhibition: { repeat: false } } : {}),
  };
}
export function newCloudExhibition(now: number): RoomState {
  const state = newRoom(now, true);
  state.persistent = true;
  state.expiresAt = Number.MAX_SAFE_INTEGER;
  state.exhibition = { repeat: true, source: "draft" };
  state.traffic = { ...DEFAULT_TRAFFIC };
  return advanceExhibition(state, now);
}
/** Pure authority transition. Nothing is broadcast until this result is persisted. */
export function changeRoom(
  state: RoomState,
  value: unknown,
  now: number,
  automatic = false,
  participantQueue = false,
): RoomState {
  if (now >= state.expiresAt)
    throw new Error("この部屋は終了しました。新しい部屋を作れます。");
  if (!value || typeof value !== "object")
    throw new Error("操作を読み取れませんでした。");
  const op = value as RoomOperation;
  if (typeof op.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(op.id))
    throw new Error("操作IDを確認してください。");
  if (state.recentOperations.includes(op.id) || state.flights.some(f=>f.id===op.id)) return state;
  if (!Number.isSafeInteger(op.revision) || op.revision !== state.revision)
    throw new Error(
      "相手が先に変更しました。最新の設定を見て、もう一度操作してください。",
    );
  // A visitor's explicit departure takes precedence over a not-yet-started automatic flight.
  if (
    !automatic &&
    ["create-flight", "launch", "launch-hangar"].includes(op.type)
  )
    state = {
      ...state,
      flights: state.flights.filter((f) => !(f.automatic && f.startsAt > now)),
    };
  if (op.type === "create-flight" || op.type === "create-entry") {
    // A participant can submit an immutable work, never overwrite another entry or the room draft.
    const entry = checkedEntry({ ...op.entry, id: op.id });
    checkedWorkshop(entry.recipe);
    const existing = state.hangar?.find(
      (e) =>
        e.name === entry.name &&
        JSON.stringify(e.recipe) === JSON.stringify(entry.recipe),
    );
    if (!existing && (state.hangar?.length ?? 0) >= HANGAR_LIMIT)
      throw new Error(
        "この部屋の格納庫は24機までです。運営にお知らせください。",
      );
    if (op.type === "create-entry") {
      return {
        ...structuredClone(state),
        revision: state.revision + 1,
        hangar: existing
          ? structuredClone(state.hangar)
          : [...structuredClone(state.hangar ?? []), entry],
        recentOperations: [...state.recentOperations.slice(-31), op.id],
      };
    }
    const launched = changeRoom(
      { ...state, draft: entry.recipe },
      { id: op.id, revision: op.revision, type: "launch" },
      now,
      automatic,
      true,
    );
    launched.draft = structuredClone(state.draft);
    launched.exhibition = state.exhibition
      ? { ...state.exhibition, source: state.exhibition.source ?? "hangar" }
      : undefined;
    launched.hangar = existing
      ? structuredClone(state.hangar)
      : [...structuredClone(state.hangar ?? []), entry];
    const flight = launched.flights.at(-1)!;
    flight.departure = true;
    flight.cruiseLaps = 2;
    const base = checkedWorkshop(entry.recipe).route;
    flight.journey = 2;
    flight.checksum = journeyChecksum(base, 2);
    flight.endsAt += DEPARTURE_MS + base.durationMs + ARRIVAL_MS;
    flight.clearAt += DEPARTURE_MS + base.durationMs + ARRIVAL_MS;
    reserveRunway(flight, launched.flights.filter(f=>f.id!==flight.id));
    flight.names = [entry.name];
    flight.entryIds = [existing?.id ?? entry.id];
    return launched;
  }
  const next = structuredClone(state);
  if(op.type === "environment") {
    next.environment=checkedEnvironment(op.environment);
  } else if (op.type === "flight-instruction") {
    const flight=next.flights.find(f=>f.id===op.flightId);
    if(!flight || flight.show || flight.startsAt+DEPARTURE_MS>now || flight.endsAt-(flight.journey?ARRIVAL_MS:0)<now+125000)
      throw new Error("巡航中で、着陸まで2分以上ある機体を選んでください。");
    if(!["overhead","wide","higher"].includes(op.instruction) || !op.observer || ![op.observer.x,op.observer.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=3000))
      throw new Error("飛行の指示と観察位置を確認してください。");
    if((flight.instructions?.length??0)>=4 || flight.instructions?.some(c=>flight.startsAt+c.untilMs>now))
      throw new Error("この機体は指示に沿って飛行中です。元の航路に戻ってから指示できます。");
    if(next.flights.some(f=>f.show && f.clearAt>now)) throw new Error("旧形式の展示飛行が終わってから航路を指示してください。");
    const original=sharedFlightRoute(flight), fromMs=now-flight.startsAt+5000, untilMs=fromMs+120000;
    const middle=flightPose(original,(fromMs+untilMs)/2).position;
    const offset=op.instruction==="overhead" ? {x:op.observer.x-middle.x,y:0,z:op.observer.z-middle.z} : op.instruction==="higher" ? {x:0,y:Math.min(80,500-middle.y),z:0} : {x:middle.x>=op.observer.x?280:-280,y:0,z:middle.z>=op.observer.z?280:-280};
    if(Math.hypot(offset.x,offset.z)>3000 || (op.instruction==="higher"&&offset.y<10)) throw new Error("この位置からの変更は大きすぎます。別の機体か、広く回る指示を選んでください。");
    const command:FlightInstruction={id:op.id,kind:op.instruction,fromMs,untilMs,offset};
    const instructions=[...(flight.instructions??[]),command], candidate=instructedRoute(original,[command]);
    const others=state.flights.filter(f=>f.id!==flight.id&&f.clearAt>now&&!f.show).map(f=>({f,route:sharedFlightRoute(f)}));
    for(let ms=fromMs;ms<=untilMs;ms+=2000) {
      const at=flight.startsAt+ms, p=flightPose(candidate,ms).position;
      for(const {f,route} of others) {
        if(at<f.startsAt || at>=f.endsAt) continue;
        const q=flightPose(route,at-f.startsAt).position;
        const spacing=Math.max(f.recipe.aircraft.wingSpanM,flight.recipe.aircraft.wingSpanM)*1.4;
        if(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)<spacing) throw new Error("変更先に近い機体があります。今は航路を保ちます。少し待って再度お試しください。");
      }
    }
    flight.instructions=instructions;
    flight.checksum=sharedFlightRoute(flight).checksum;
    recordTraffic(next,{at:now,source:"rules",status:"applied",note:`${flight.names?.[0]??"旅客機"}：${{overhead:"頭上を通過",wide:"広く回る",higher:"少し高く飛ぶ"}[op.instruction]}。約2分で元の航路へ。`});
  } else if (op.type === "traffic") {
    next.traffic = checkedTraffic(op.settings);
    next.flights = next.flights.filter(
      (f) => !f.automatic || f.startsAt <= now,
    );
    next.trafficDecision = undefined;
  } else if (op.type === "hangar-save") {
    const entry = checkedEntry(op.entry);
    checkedWorkshop(entry.recipe);
    const entries = next.hangar ?? [];
    const index = entries.findIndex((e) => e.id === entry.id);
    if (
      op.expected !== undefined &&
      JSON.stringify(index < 0 ? null : entries[index]) !==
        JSON.stringify(op.expected)
    )
      throw new Error(
        "この機体は別の端末で更新されました。下書きは残っています。クラウドの機体を呼び直して確認してください。",
      );
    if (index < 0 && entries.length >= HANGAR_LIMIT)
      throw new Error("この部屋の格納庫は24機までです。");
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
    next.hangar = entries;
    if (next.persistent && next.exhibition) next.exhibition.source = "hangar";
  } else if (op.type === "hangar-remove") {
    if (!next.hangar?.some((e) => e.id === op.entryId))
      throw new Error("機体が見つかりません。");
    next.hangar = next.hangar.filter((e) => e.id !== op.entryId);
    if (!next.hangar.length && next.exhibition?.source === "hangar") {
      next.exhibition.source = "draft";
      if (!next.persistent) next.exhibition.repeat = false;
    }
  } else if (op.type === "venue") next.venue = checkedVenue(op.venue);
  else if (op.type === "edit") next.draft = checkedWorkshop(op.recipe).recipe;
  else if (op.type === "launch" || op.type === "launch-hangar") {
    const pending = state.flights.filter((f) => f.startsAt > now);
    if (pending.length && !participantQueue)
      throw new Error("次の便は予約済みです。取り消してから変更できます。");
    if (participantQueue && pending.length >= DEPARTURE_QUEUE_LIMIT)
      throw new Error(
        "出発待ちが64機あります。少し待ってから飛ばしてください。",
      );
    let recipe = state.draft;
    let show: ReturnType<typeof compileShow> | undefined;
    let names: string[] | undefined;
    if (op.type === "launch-hangar") {
      const entries = state.hangar ?? [];
      if (!entries.length) throw new Error("格納庫に機体を登録してください。");
      const chosen = Array.from(
        { length: Math.min(trafficCapacity(state), entries.length) },
        (_, i) => entries[((state.hangarCursor ?? 0) + i) % entries.length],
      );
      show = compileShow({
        version: 1,
        title: "みんなの空",
        flights: chosen.map((entry, i) => ({
          startSec: i * 8,
          recipe: entry.recipe,
        })),
      });
      names = chosen.map((e) => e.name);
      recipe = chosen[0].recipe;
      next.hangarCursor =
        ((state.hangarCursor ?? 0) + chosen.length) % entries.length;
      if (next.exhibition) next.exhibition.source = "hangar";
    } else if (next.exhibition) next.exhibition.source = "draft";
    const { route } = checkedWorkshop(recipe);
    const active = withFlightSlots(
      state.flights.filter((f) => f.clearAt > now),
    );
    // Reserve render/audio identities, including late-arriving sound.
    // Participant flights can overlap; a full hangar show still needs all its slots.
    let startsAt = now + 15000;
    if (participantQueue)
      startsAt = Math.max(startsAt, ...pending.map((f) => f.startsAt + 15000));
    const slots = show?.flights.length ?? 1;
    for (const end of [...new Set(active.map((f) => f.clearAt))].sort(
      (a, b) => a - b,
    )) {
      if (
        active
          .filter((f) => f.clearAt > startsAt)
          .reduce((n, f) => n + (f.show?.flights.length ?? 1), 0) +
          slots <=
        trafficCapacity(state)
      )
        break;
      startsAt = Math.max(startsAt, end);
    }
    // Shared preview observes around the ground origin. Include a 100 m local walking margin.
    const tail =
      Math.ceil(
        ((Math.max(
          ...(show
            ? show.flights.flatMap((f) => f.route.samples)
            : route.samples
          ).map((s) =>
            Math.hypot(s.position.x, s.position.y - 1.7, s.position.z),
          ),
        ) +
          100) /
          343) *
          1600,
      ) + 2000;
    const endsAt = startsAt + (show?.durationMs ?? route.durationMs);
    next.flights = withFlightSlots([
      ...active,
      {
        id: op.id,
        recipe,
        startsAt,
        endsAt,
        clearAt: endsAt + tail,
        checksum: show?.checksum ?? route.checksum,
        ...(automatic ? { automatic: true } : {}),
        ...(show
          ? {
              show: show.recipe,
              names,
              entryIds: show.recipe.flights.map(
                (_, i) =>
                  state.hangar![
                    ((state.hangarCursor ?? 0) + i) % state.hangar!.length
                  ].id,
              ),
            }
          : {}),
      },
    ]);
  } else if (op.type === "repeat") {
    if (!state.exhibition || typeof op.enabled !== "boolean")
      throw new Error("展示用の部屋で操作してください。");
    next.exhibition = { ...state.exhibition, repeat: op.enabled };
    if (!op.enabled)
      next.flights = next.flights.filter(
        (f) => !f.automatic || f.startsAt <= now,
      );
  } else if (op.type === "cancel-next") {
    const first = [...state.flights].filter(f=>f.startsAt>now).sort((a,b)=>a.startsAt-b.startsAt)[0];
    if (!first)
      throw new Error("取り消す次の便はありません。");
    next.flights = state.flights.filter((f) => f.id !== first.id);
  } else throw new Error("対応していない操作です。");
  next.revision++;
  next.recentOperations = [...state.recentOperations.slice(-31), op.id];
  return next;
}

/** Called by the server alarm, never by each visitor. Delayed alarms start one new flight. */
export function advanceExhibition(state: RoomState, now: number): RoomState {
  if (state.traffic && state.exhibition?.repeat && now < state.expiresAt) {
    if (state.flights.some((f) => f.startsAt > now)) return state;
    const occupied = state.flights
      .filter((f) => f.clearAt > now)
      .reduce((n, f) => n + flightSlots(f), 0);
    const decision = trafficDecision(state, now);
    const lastStart = Math.max(
      -Infinity,
      ...state.flights.map((f) => f.startsAt),
    );
    if (
      occupied >= automaticCapacity(state) ||
      now < lastStart + trafficGapMs(decision)
    )
      return state;
    const allowed = state.traffic.automaticIds;
    const entries = (state.hangar ?? []).filter(
      (e) => allowed === undefined || allowed.includes(e.id),
    );
    if (allowed !== undefined && !entries.length) return state;
    const entry =
      entries[(state.hangarCursor ?? 0) % Math.max(1, entries.length)];
    const recipe = structuredClone(entry?.recipe ?? state.draft);
    const altitude = availableCruiseAltitude(
      state,
      recipe.route.altitudeM,
      now,
      decision.altitude,
    );
    if (altitude === null) return state;
    recipe.route.altitudeM = altitude;
    const next = changeRoom(
      { ...state, draft: recipe },
      {
        type: "launch",
        id: `automatic-${state.revision}-${Math.floor(now)}`,
        revision: state.revision,
      },
      now,
      true,
    );
    const flight = next.flights.at(-1)!;
    const base = checkedWorkshop(recipe).route;
    // One runway lands about one flight a minute; larger skies keep automatic flights aloft longer.
    const laps = automaticCruiseLaps(trafficCapacity(state));
    flight.departure = true;
    flight.cruiseLaps = laps;
    flight.journey = 2;
    flight.checksum = journeyChecksum(base, laps);
    const extra = DEPARTURE_MS + base.durationMs * (laps - 1) + ARRIVAL_MS;
    flight.endsAt += extra;
    flight.clearAt += extra;
    reserveRunway(flight, next.flights.filter(f=>f.id!==flight.id));
    flight.names = [entry?.name ?? "旅客機"];
    if (entry) flight.entryIds = [entry.id];
    next.draft = structuredClone(state.draft);
    next.exhibition = { ...state.exhibition };
    next.hangarCursor = entries.length
      ? ((state.hangarCursor ?? 0) + 1) % entries.length
      : 0;
    next.trafficDecision = decision;
    recordTraffic(next, {
      at: now,
      source: decision.source,
      status: "applied",
      note: decision.note,
      gapSec: trafficGapMs(decision) / 1000,
      altitudeM: altitude,
      aircraft: flight.names[0],
    });
    return next;
  }
  if (
    !state.exhibition?.repeat ||
    now >= state.expiresAt ||
    state.flights.some((f) => f.clearAt > now)
  )
    return state;
  return changeRoom(
    state,
    {
      type: state.exhibition.source === "hangar" ? "launch-hangar" : "launch",
      revision: state.revision,
      id: `automatic-${state.revision}-${Math.floor(now)}`,
    },
    now,
  );
}

/** Slots automatic flights leave open so a visitor's departure need not wait for a landing. */
export const visitorReserve = (capacity: number) => (capacity >= 6 ? 2 : 1);
const automaticCapacity = (state: RoomState) =>
  trafficCapacity(state) - visitorReserve(trafficCapacity(state));
/** A single runway: new reservations move, existing departures and landings never do. */
function reserveRunway(flight: SharedFlight, others: SharedFlight[]) {
  // Landings touch down at x=-950 and roll out to the takeoff point at x=-200 (endsAt-35 s), then taxi off.
  // A departure appears at that point and leaves it within 5 s, so it only waits while a landed
  // aircraft is within ~50 m of it; landings keep 50 s apart plus a 20 s takeoff gap.
  const takeoff=(f:SharedFlight)=>[f.startsAt,f.startsAt+15000];
  const leavingPoint=(f:SharedFlight)=>[f.startsAt,f.startsAt+5000];
  const atTakeoffPoint=(f:SharedFlight)=>f.journey===2?[[f.endsAt-42000,f.endsAt-27000]]:[];
  const landing=(f:SharedFlight,gap=0)=>f.journey===2?[[f.endsAt-70000,f.endsAt-20000+gap]]:[];
  const shiftPast=(a:number[],occupied:number[][])=>{
    const conflicts=occupied.filter(b=>a[0]<b[1]&&b[0]<a[1]);
    return conflicts.length?Math.ceil(Math.max(...conflicts.map(b=>b[1]-a[0])))+1:0;
  };
  for(let n=0;n<256;n++) {
    const shift=Math.max(
      shiftPast(takeoff(flight),others.map(takeoff)),
      shiftPast(leavingPoint(flight),others.flatMap(atTakeoffPoint)),
    );
    if(!shift) break;
    flight.startsAt+=shift;flight.endsAt+=shift;flight.clearAt+=shift;
  }
  if(flight.journey!==2) return;
  for(let n=0;n<256;n++) {
    const shift=Math.max(
      shiftPast(landing(flight)[0],others.flatMap(f=>landing(f,20000))),
      shiftPast(atTakeoffPoint(flight)[0],others.map(leavingPoint)),
    );
    if(!shift) {
      flight.checksum=flight.instructions?.length?sharedFlightRoute(flight).checksum:journeyChecksum(checkedWorkshop(flight.recipe).route,flight.cruiseLaps ?? 2,flight.landingDelayMs);
      return;
    }
    flight.landingDelayMs=(flight.landingDelayMs??0)+shift;
    flight.endsAt+=shift;flight.clearAt+=shift;
  }
  throw new Error("滑走路の予定が混み合っています。少し待ってから飛ばしてください。");
}

export function nextRoomAlarm(state: RoomState, now: number) {
  if (!state.exhibition?.repeat)
    return state.persistent ? now + 86400000 : state.expiresAt;
  if (state.traffic) {
    if (
      state.traffic.automaticIds !== undefined &&
      !(state.hangar ?? []).some((e) =>
        state.traffic!.automaticIds!.includes(e.id),
      )
    )
      return Math.min(state.expiresAt, now + 86400000);
    const active = state.flights.filter((f) => f.clearAt > now);
    const pending = active.find((f) => f.startsAt > now);
    const occupied = active.reduce((n, f) => n + flightSlots(f), 0);
    const lastStart = Math.max(
      now,
      ...state.flights.map(
        (f) => f.startsAt + trafficGapMs(trafficDecision(state, now)),
      ),
    );
    const noLane =
      availableCruiseAltitude(state, state.draft.route.altitudeM, now) === null;
    const due = pending
      ? pending.startsAt
      : occupied >= automaticCapacity(state) || noLane
        ? Math.min(...active.map((f) => f.clearAt))
        : lastStart;
    return Math.min(state.expiresAt, Math.max(now + 1000, due));
  }
  const last = state.flights.at(-1);
  return Math.min(state.expiresAt, Math.max(now + 100, last?.clearAt ?? now));
}
