/// <reference path="../worker-configuration.d.ts" />
import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { newCloudExhibition } from "../../packages/core/src/shared-room";
import { requestTrafficDecision } from "../traffic-agent";
import { cruiseAltitudeCandidates } from "../../packages/core/src/traffic";
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown,
    ) {}
  },
}));
const { SkyRoom } = await import("../room-worker");
const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  databases.splice(0).forEach((d) => d.close());
});
const response = (choice = "spaced", altitude = "spread") =>
  Response.json({
    answers: {
      focus: {
        type: "choice",
        choice,
        probabilities: {
          flow: choice === "flow" ? 1 : 0,
          spaced: choice === "spaced" ? 1 : 0,
          quiet: choice === "quiet" ? 1 : 0,
        },
      },
      altitude: {
        type: "choice",
        choice: altitude,
        probabilities: {
          near: altitude === "near" ? 1 : 0,
          spread: altitude === "spread" ? 1 : 0,
        },
      },
    },
  });
function room() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const socket = {
    send: vi.fn(),
    deserializeAttachment: () => ({ role: "editor", id: "fixture" }),
  };
  const ctx = {
    storage: {
      sql: {
        exec(query: string, ...args: unknown[]) {
          const rows = db.prepare(query).all(...(args as never[]));
          return { toArray: () => rows, one: () => rows[0] };
        },
      },
      setAlarm: vi.fn(async () => {}),
      deleteAll: vi.fn(async () => {}),
    },
    getWebSockets: () => [socket],
  };
  const instance = new SkyRoom(
    ctx as never,
    { TYPESAFE_API_KEY: "fixture-only" } as never,
  );
  const state = newCloudExhibition(Date.now());
  state.traffic!.jev = true;
  const write = (value: typeof state) =>
    db
      .prepare("INSERT OR REPLACE INTO room VALUES(1,?,?)")
      .run(JSON.stringify(value), "fixture");
  const read = () =>
    JSON.parse(
      (
        db.prepare("SELECT state FROM room WHERE id=1").get() as {
          state: string;
        }
      ).state,
    ) as typeof state;
  write(state);
  return { instance, state, read, write, ctx };
}
it("uses only a validated finite choice, and falls back on malformed/unavailable replies", async () => {
  const state = newCloudExhibition(1000);
  const recipe = structuredClone(state.draft);
  recipe.route.altitudeM = 450;
  state.hangar = [{ id: "fixture-aircraft", name: "次のあおぞら", recipe }];
  const fetcher = vi.fn(async (_input?: unknown, _init?: RequestInit) =>
    response(),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await requestTrafficDecision(state, 1000, "fixture")).toMatchObject({
    source: "jev",
    pace: "spaced",
    altitude: "spread",
  });
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body.state.nextDeparture).toMatchObject({
    name: "次のあおぞら",
    altitudeM: 450,
  });
  expect(body.state.altitudeCandidatesM).toEqual(
    cruiseAltitudeCandidates(state, 450, 1000),
  );
  expect(body.state.forecast).toMatchObject({
    horizonSec: 30,
    sampleStepSec: 3,
  });
  expect(body.questions.altitude.criteria).toHaveProperty("spread");
  fetcher.mockImplementation(async () =>
    response("spaced", "unbounded-altitude"),
  );
  expect(await requestTrafficDecision(state, 1000, "fixture")).toBeNull();
  fetcher.mockImplementation(async () => response("arbitrary-command"));
  expect(await requestTrafficDecision(state, 1000, "fixture")).toBeNull();
  fetcher.mockImplementation(
    async () => new Response("provider failure", { status: 500 }),
  );
  expect(await requestTrafficDecision(state, 1000, "fixture")).toBeNull();
  fetcher.mockClear();
  expect(await requestTrafficDecision(state, 1000)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it("applies one room decision and deduplicates repeated alarms within the request interval", async () => {
  const r = room(),
    fetcher = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetcher);
  await r.instance.alarm();
  await r.instance.alarm();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(r.read().trafficDecision).toMatchObject({
    source: "jev",
    pace: "spaced",
  });
  expect(r.read().trafficAgent).toMatchObject({
    requests: 1,
    status: "active",
  });
  expect(r.read().trafficHistory).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "jev",
        status: "selected",
        gapSec: 30,
      }),
    ]),
  );
});
it("discards a late Jev response after an operator changes the room", async () => {
  const r = room();
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const pending = r.instance.alarm();
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  const changed = r.read();
  changed.revision++;
  changed.traffic!.jev = false;
  r.write(changed);
  resolve(response("quiet"));
  await pending;
  expect(r.read().traffic?.jev).toBe(false);
  expect(r.read().trafficDecision?.source).not.toBe("jev");
  expect(r.read().trafficAgent?.status).toBe("stale");
  expect(r.read().trafficHistory?.at(-1)?.status).toBe("discarded");
  expect(r.ctx.storage.setAlarm).toHaveBeenCalled();
});
it("records provider failure and keeps automatic flights running with rules", async () => {
  const r = room();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("fixture", { status: 503 })),
  );
  await r.instance.alarm();
  const state = r.read();
  expect(state.trafficAgent?.status).toBe("fallback");
  expect(
    state.trafficHistory?.some(
      (e) => e.status === "fallback" && e.note.includes("接続・応答"),
    ),
  ).toBe(true);
  expect(state.flights.length).toBeGreaterThan(0);
  expect(r.ctx.storage.setAlarm).toHaveBeenCalled();
});
it("does not call Jev when disabled or automatic departures are stopped", async () => {
  const r = room(),
    fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const state = r.read();
  state.traffic!.jev = false;
  r.write(state);
  await r.instance.alarm();
  state.traffic!.jev = true;
  state.exhibition!.repeat = false;
  r.write(state);
  await r.instance.alarm();
  expect(fetcher).not.toHaveBeenCalled();
});
