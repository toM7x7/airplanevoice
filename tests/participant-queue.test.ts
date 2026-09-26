import { expect, it } from "vitest";
import {
  advanceExhibition,
  changeRoom,
  newCloudExhibition,
  newRoom,
} from "../packages/core/src/shared-room";
import { newCreation } from "../packages/core/src/creation";
import { withFlightSlots } from "../packages/core/src/traffic";
import { SharedPlayback } from "../packages/core/src/shared-playback";
import { Experience } from "../packages/core/src/experience";

it("queues repeated participant submissions FIFO, at least 15 seconds apart, without reusing occupied slots", () => {
  let s = newRoom(1000, true);
  s.traffic = { capacity: 3, jev: false };
  const entry = newCreation("visitor-plane").entry;
  for (let i = 0; i < 10; i++)
    s = changeRoom(
      s,
      {
        type: "create-flight",
        id: `request-flight-${i}`,
        revision: s.revision,
        entry,
      },
      1000 + i,
    );
  expect(s.flights).toHaveLength(10);
  expect(s.hangar).toHaveLength(1);
  expect(s.flights[0].startsAt).toBe(16000);
  for (let i = 1; i < s.flights.length; i++)
    expect(
      s.flights[i].startsAt - s.flights[i - 1].startsAt,
    ).toBeGreaterThanOrEqual(15000);
  expect(() => withFlightSlots(s.flights)).not.toThrow();
  for (const f of s.flights)
    expect(
      s.flights.filter(
        (p) => p.startsAt <= f.startsAt && p.clearAt > f.startsAt,
      ).length,
    ).toBeLessThanOrEqual(3);
  const playback = new SharedPlayback(new Experience(), () => {});
  for (const f of s.flights) {
    playback.tick(s, f.startsAt + 1);
    expect(playback.names.some((n) => n.startsAt === f.startsAt)).toBe(true);
  }
});
it("turning off automatic aircraft preserves participant reservations and airborne flights", () => {
  let s = newCloudExhibition(1000);
  s = changeRoom(
    s,
    {
      type: "create-flight",
      id: "visitor-flight",
      revision: s.revision,
      entry: newCreation("visitor-plane").entry,
    },
    1001,
  );
  s = changeRoom(
    s,
    {
      type: "traffic",
      id: "traffic-update",
      revision: s.revision,
      settings: { capacity: 24, jev: false, automaticIds: [] },
    },
    1002,
  );
  expect(s.flights.map((f) => f.id)).toEqual(["visitor-flight"]);
  expect(advanceExhibition(s, s.flights[0].clearAt + 1)).toBe(s);
  const next = changeRoom(
    s,
    {
      type: "create-flight",
      id: "visitor-second",
      revision: s.revision,
      entry: newCreation("visitor-plane").entry,
    },
    1003,
  );
  expect(next.flights).toHaveLength(2);
});
it("uses only the selected automatic pool and does not alter saved recipes", () => {
  let s = newCloudExhibition(1000);
  const a = newCreation("aircraft-one").entry,
    b = newCreation("aircraft-two").entry;
  a.name = "そら";
  b.name = "かなた";
  s.hangar = [a, b];
  s = changeRoom(
    s,
    {
      type: "traffic",
      id: "traffic-pool",
      revision: s.revision,
      settings: {
        capacity: 24,
        jev: false,
        automaticIds: [b.id],
        objective: "lively",
        note: "ゆっくり眺めたい",
      },
    },
    1001,
  );
  const next = advanceExhibition(s, 1002);
  expect(next.flights[0].names).toEqual(["かなた"]);
  expect(next.hangar).toEqual([a, b]);
  expect(next.trafficDecision?.pace).toBe("flow");
});

it("retains request deduplication beyond the recent-32 window and bounds the waiting queue",()=>{
 let s=newRoom(1000,true);s.traffic={capacity:24,jev:false};const entry=newCreation("long-queue-plane").entry;
 for(let i=0;i<64;i++)s=changeRoom(s,{type:"create-flight",id:`long-queue-${i}`,revision:s.revision,entry},1000);
 expect(s.flights).toHaveLength(64);expect(s.recentOperations).not.toContain("long-queue-0");
 expect(changeRoom(s,{type:"create-flight",id:"long-queue-0",revision:0,entry},1001)).toBe(s);
 expect(()=>changeRoom(s,{type:"create-flight",id:"long-queue-full",revision:s.revision,entry},1002)).toThrow("64機");
},15000);

it("cancel-next removes only the first reserved participant flight",()=>{
 let s=newRoom(1000,true);const entry=newCreation("cancel-test-plane").entry;
 for(let i=0;i<3;i++)s=changeRoom(s,{type:"create-flight",id:`cancel-queue-${i}`,revision:s.revision,entry},1000);
 const next=changeRoom(s,{type:"cancel-next",id:"cancel-only-first",revision:s.revision},1001);
 expect(next.flights.map(f=>f.id)).toEqual(["cancel-queue-1","cancel-queue-2"]);
 expect(next.flights.map(f=>f.startsAt)).toEqual(s.flights.slice(1).map(f=>f.startsAt));
});
