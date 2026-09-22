import { afterEach, expect, it, vi } from "vitest";
import { changeCreation, newCreation } from "../packages/core/src/creation";
import { newRoom, changeRoom } from "../packages/core/src/shared-room";
import {
  CreationWorkspace,
  savedCreations,
} from "../apps/desktop/src/creation-workspace";
import {
  actionProblem,
  parseAssistantAction,
} from "../packages/core/src/assistant-actions";
import { parseTrialContext } from "../packages/core/src/ai-trial";

afterEach(() => vi.unstubAllGlobals());
it("shares a work without scheduling a flight and deduplicates unchanged re-submission",()=>{
  const state=newRoom(1000,true), entry=newCreation("aircraft-one").entry;
  const next=changeRoom(state,{id:"share-operation-1",type:"create-entry",revision:0,entry},1001);
  expect(next.flights).toHaveLength(0);expect(next.draft).toEqual(state.draft);
  const duplicate=changeRoom(next,{id:"share-operation-2",type:"create-entry",revision:1,entry},1002);
  expect(duplicate.hangar).toHaveLength(1);expect(duplicate.hangar![0].id).toBe("share-operation-1");
  expect(duplicate.recentOperations).toContain("share-operation-2");
});
it("creates bounded aircraft and preserves sound while changing shape", () => {
  const base = newCreation("creation-001");
  const tuned = changeCreation(base, "tone:0");
  const changed = changeCreation(tuned, "shape:1");
  expect(base.entry.recipe.aircraft.sound).not.toEqual(
    tuned.entry.recipe.aircraft.sound,
  );
  expect(changed.entry.recipe.aircraft.sound).toEqual(
    tuned.entry.recipe.aircraft.sound,
  );
  expect(() => changeCreation(base, "shape:100")).toThrow();
  expect(() => changeCreation(base, "name:" + "a".repeat(41))).toThrow();
});
it("restores browser drafts and saved aircraft; undo and guide do not save or fly", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
  vi.stubGlobal("window", new EventTarget());
  const c = new CreationWorkspace();
  c.run("name:そら");
  c.run("save");
  c.run("tone:2");
  expect(savedCreations()[0].recipe).not.toEqual(c.snapshot.entry.recipe);
  c.run("undo");
  expect(savedCreations()[0]).toEqual(c.snapshot.entry);
  c.reveal("fly");
  expect(c.snapshot.step).toBe(3);
  expect(c.snapshot.lastAction).toBe("undo");
  const restored = new CreationWorkspace();
  expect(restored.snapshot.entry).toEqual(c.snapshot.entry);
  expect(restored.snapshot.open).toBe(false);
});
it("publishes an immutable participant aircraft without changing the operator draft or automatic flight source", () => {
  const state = newRoom(1000, true);
  state.exhibition = { repeat: true, source: "hangar" };
  state.hangar = [newCreation("someone-else").entry];
  const entry = changeCreation(newCreation("someone-else"), "name:そら").entry;
  const op = {
    type: "create-flight",
    entry,
    id: "creation-flight-1",
    revision: 0,
  };
  const next = changeRoom(state, op, 1000);
  expect(next.hangar).toHaveLength(2);
  expect(next.hangar![0]).toEqual(state.hangar[0]);
  expect(next.hangar![1].id).toBe(op.id);
  expect(next.draft).toEqual(state.draft);
  expect(next.exhibition).toEqual(state.exhibition);
  expect(next.flights[0].names).toEqual(["そら"]);
  expect(next.flights[0].entryIds).toEqual([op.id]);
  expect(changeRoom(next, op, 1001)).toBe(next);
  const queued = changeRoom(next, { ...op, id: "creation-flight-2", revision: 1 }, 1002);
  expect(queued.flights[1].startsAt).toBe(next.flights[0].startsAt + 15000);
  expect(queued.hangar).toHaveLength(2);
  expect(next.hangar).toHaveLength(2);
  entry.name = "changed after request";
  expect(next.flights[0].names).toEqual(["そら"]);
});
it("reports validated creation context to AI while retaining human save and launch decisions", () => {
  const c = parseTrialContext({
    revision: 0,
    phase: "EDIT",
    paused: false,
    volume: 35,
    soundOn: false,
    menuOpen: true,
    menuPage: "home",
    selected: false,
    controls: ["creation"],
    fleet: [],
    creation: {
      open: true,
      step: 3,
      name: "そら",
      dirty: true,
      lastAction: "next",
    },
  });
  for (const value of ["save", "share", "fly"]) {
    expect(
      actionProblem(
        parseAssistantAction({ mode: "apply", control: "creation", value }),
        c,
      ),
    ).toContain("最終決定");
    expect(
      actionProblem(
        parseAssistantAction({ mode: "guide", control: "creation", value }),
        c,
      ),
    ).toBeNull();
  }
  expect(() =>
    parseTrialContext({ ...c, creation: { ...c.creation, step: 4 } }),
  ).toThrow();
});

it("edits VR dimensions with PC bounds while preserving sound and color",()=>{
 const original=newCreation("dimensions-test");const a=changeCreation(changeCreation(original,"color:1"),"tone:1");
 const b=changeCreation(changeCreation(a,"body:85"),"wings:45");
 expect(b.entry.recipe.aircraft.bodyLengthM).toBe(85);expect(b.entry.recipe.aircraft.wingSpanM).toBe(45);expect(b.entry.recipe.aircraft.sound).toEqual(a.entry.recipe.aircraft.sound);expect(b.entry.recipe.aircraft.color).toBe(a.entry.recipe.aircraft.color);
 for(const value of ["body:86","wings:44","body:NaN","wings:Infinity"])expect(()=>changeCreation(a,value)).toThrow();
});
