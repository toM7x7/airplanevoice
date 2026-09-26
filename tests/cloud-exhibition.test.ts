import { afterEach, expect, it, vi } from "vitest";
import { changeRoom, newCloudExhibition, advanceExhibition, nextRoomAlarm } from "../packages/core/src/shared-room";
import { newCreation } from "../packages/core/src/creation";
import { CreationWorkspace, savedCreations } from "../apps/desktop/src/creation-workspace";

afterEach(() => vi.unstubAllGlobals());
it("keeps the cloud hangar after eight hours and rotates its aircraft without a connected host", () => {
  let state = newCloudExhibition(1000);
  expect(state.persistent).toBe(true);
  expect(state.flights).toHaveLength(1);
  const entry = newCreation("cloud-aircraft").entry;
  state = changeRoom(state, { id: "save-first", revision: state.revision, type: "hangar-save", entry, expected: null }, 1001);
  const later = 1000 + 3 * 86400000;
  const advanced = advanceExhibition(state, later);
  expect(advanced.hangar).toEqual([entry]);
  expect(advanced.flights[0].entryIds).toEqual([entry.id]);
  expect(advanced.flights[0].startsAt).toBe(later + 15000);
  expect(nextRoomAlarm(advanced, later)).toBe(advanced.flights[0].startsAt);
  const paused = changeRoom(advanced, { id: "stop-repeat", revision: advanced.revision, type: "repeat", enabled: false }, later);
  expect(nextRoomAlarm(paused, later)).toBe(later + 86400000);
});
it("rejects a stale aircraft edit even with an up-to-date room revision", () => {
  const original = newCreation("cloud-aircraft").entry;
  let state = newCloudExhibition(1000);
  state = changeRoom(state, { id: "save-first", revision: state.revision, type: "hangar-save", entry: original, expected: null }, 1001);
  state = changeRoom(state, { id: "save-other", revision: state.revision, type: "hangar-save", entry: { ...original, name: "Questから変更" }, expected: original }, 1002);
  expect(() => changeRoom(state, { id: "save-stale", revision: state.revision, type: "hangar-save", entry: { ...original, name: "古いPC下書き" }, expected: original }, 1003)).toThrow("別の端末");
  expect(state.hangar![0].name).toBe("Questから変更");
});
it("continues the default exhibition after its last saved aircraft is removed", () => {
  let state = newCloudExhibition(1000);
  const entry = newCreation("last-aircraft").entry;
  state = changeRoom(state, { id: "save-last", revision: state.revision, type: "hangar-save", entry, expected: null }, 1001);
  state = changeRoom(state, { id: "remove-last", revision: state.revision, type: "hangar-remove", entryId: entry.id }, 1002);
  expect(state.exhibition).toEqual({repeat:true,source:"draft"});
  const later = advanceExhibition(state, state.flights[0].clearAt + 1);
  expect(later.flights).toHaveLength(1);
  expect(later.hangar).toEqual([]);
});
it("caches the acknowledged aircraft without marking edits made during upload as saved", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  vi.stubGlobal("window", new EventTarget());
  const workspace = new CreationWorkspace();
  workspace.run("name:保存する機体");
  const sent = structuredClone(workspace.snapshot.entry);
  workspace.run("name:保存中に変更");
  workspace.acknowledgeCloudSave(sent);
  expect(workspace.snapshot.dirty).toBe(true);
  expect(workspace.snapshot.entry.name).toBe("保存中に変更");
  expect(savedCreations()[0]).toEqual(sent);
});
