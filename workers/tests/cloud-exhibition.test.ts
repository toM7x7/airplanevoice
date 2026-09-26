import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { changeRoom, CLOUD_EXHIBITION_ID, type RoomState } from "../../packages/core/src/shared-room";
import { newCreation } from "../../packages/core/src/creation";
vi.mock("cloudflare:workers", () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
const { SkyRoom } = await import("../room-worker");

it("initializes one persistent instance, reopens stored edits and advances the alarm with no clients", async () => {
  const db = new DatabaseSync(":memory:");
  const ctx = {
    storage: {
      sql: { exec(query: string, ...args: (string | number)[]) { const rows = db.prepare(query).all(...args); return { toArray: () => rows, one: () => rows[0] }; } },
      setAlarm: vi.fn(async () => {}), deleteAll: vi.fn(async () => {}),
    }, getWebSockets: () => [],
  };
  const read = () => JSON.parse((db.prepare("SELECT state FROM room WHERE id=1").get() as { state: string }).state) as RoomState;
  try {
    const room = new SkyRoom(ctx as never, {} as never);
    const results = await Promise.all([room.openExhibition(), room.openExhibition()]);
    expect(results.map((r) => r.id)).toEqual([CLOUD_EXHIBITION_ID, CLOUD_EXHIBITION_ID]);
    let state = read();
    const entry = newCreation("retained-aircraft").entry;
    state = changeRoom(state, { id: "saved-cloud", revision: state.revision, type: "hangar-save", entry, expected: null }, Date.now());
    db.prepare("UPDATE room SET state=? WHERE id=1").run(JSON.stringify(state));
    const resumed = new SkyRoom(ctx as never, {} as never);
    await resumed.openExhibition();
    expect(read()).toEqual(state);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 86400000);
    await resumed.alarm();
    expect(read().hangar).toEqual([entry]);
    expect(read().flights[0].entryIds).toEqual([entry.id]);
    expect(ctx.storage.deleteAll).not.toHaveBeenCalled();
    const revision = read().revision;
    await resumed.alarm();
    expect(read().revision).toBe(revision);
  } finally { vi.restoreAllMocks(); db.close(); }
});
