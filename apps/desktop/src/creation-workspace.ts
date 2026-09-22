import {
  changeCreation,
  newCreation,
  type CreationState,
} from "../../../packages/core/src/creation";
import {
  checkedEntry,
  HANGAR_LIMIT,
  type HangarEntry,
} from "../../../packages/core/src/hangar";
export const HANGAR_KEY = "airplanevoice-hangar-v1";
export function savedCreations(): HangarEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HANGAR_KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.slice(0, HANGAR_LIMIT).map(checkedEntry)
      : [];
  } catch {
    return [];
  }
}
const DRAFT_KEY = "airplanevoice-creation-v1";
export function exportCreations(entries = savedCreations()) {
  return JSON.stringify({ version: 1, aircraft: entries }, null, 2);
}
export function importCreations(text: string) {
  if (text.length > 300000) throw new Error("格納庫ファイルが大きすぎます。");
  const data = JSON.parse(text);
  if (data?.version !== 1 || !Array.isArray(data.aircraft))
    throw new Error("格納庫の保存ファイルを選んでください。");
  const incoming = data.aircraft.map(checkedEntry),
    current = savedCreations();
  for (const entry of incoming) {
    if (
      current.some(
        (e) =>
          e.name === entry.name &&
          JSON.stringify(e.recipe) === JSON.stringify(entry.recipe),
      )
    )
      continue;
    current.push({
      ...entry,
      id: current.some((e) => e.id === entry.id)
        ? crypto.randomUUID()
        : entry.id,
    });
  }
  if (current.length > HANGAR_LIMIT)
    throw new Error("読み込み後の機体が24機を超えます。");
  localStorage.setItem(HANGAR_KEY, JSON.stringify(current));
  window.dispatchEvent(new Event("airplanevoice-hangar-change"));
  return current.length;
}
export class CreationWorkspace {
  snapshot: CreationState;
  private listeners = new Set<() => void>();
  private history: CreationState[] = [];
  constructor() {
    this.snapshot = newCreation(crypto.randomUUID());
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
      if (raw)
        this.snapshot = {
          ...this.snapshot,
          entry: checkedEntry(raw.entry),
          step: Math.max(0, Math.min(3, Math.floor(Number(raw.step) || 0))),
          dirty: !savedCreations().some(
            (entry) =>
              JSON.stringify(entry) === JSON.stringify(checkedEntry(raw.entry)),
          ),
        };
    } catch {
      /* Keep stored data until an explicit edit or save. */
    }
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(next: CreationState) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    this.snapshot = next;
    this.listeners.forEach((fn) => fn());
  }
  run(value: string) {
    if (value === "undo") {
      const old = this.history.at(-1);
      if (old) {
        this.publish({ ...old, open: true, lastAction: value });
        this.history.pop();
      }
      return;
    }
    const next = changeCreation(this.snapshot, value);
    if (value === "save") {
      const raw = JSON.parse(localStorage.getItem(HANGAR_KEY) ?? "[]");
      if (!Array.isArray(raw))
        throw new Error("格納庫の保存内容を確認してください。");
      const entries: HangarEntry[] = raw.map(checkedEntry);
      const index = entries.findIndex((e) => e.id === next.entry.id);
      if (index < 0 && entries.length >= HANGAR_LIMIT)
        throw new Error("格納庫は24機までです。");
      if (index < 0) entries.push(next.entry);
      else entries[index] = next.entry;
      localStorage.setItem(HANGAR_KEY, JSON.stringify(entries));
      next.dirty = false;
      window.dispatchEvent(new Event("airplanevoice-hangar-change"));
    }
    if (JSON.stringify(next.entry) !== JSON.stringify(this.snapshot.entry))
      this.history = [...this.history.slice(-15), this.snapshot];
    this.publish(next);
  }
  load(entry: HangarEntry) {
    this.history = [];
    this.publish({
      ...this.snapshot,
      entry: checkedEntry(entry),
      open: true,
      step: 0,
      dirty: false,
      lastAction: "open",
    });
  }
  acknowledgeCloudSave(entry: HangarEntry) {
    // Cache a confirmed cloud revision, never mark later edits as saved.
    const entries = savedCreations().filter((item) => item.id !== entry.id);
    entries.unshift(checkedEntry(entry));
    try {
      localStorage.setItem(HANGAR_KEY, JSON.stringify(entries.slice(0, HANGAR_LIMIT)));
      window.dispatchEvent(new Event("airplanevoice-hangar-change"));
    } catch { /* Cloud acknowledgement remains valid if this device's cache is full. */ }
    if (JSON.stringify(this.snapshot.entry) === JSON.stringify(entry))
      this.publish({ ...this.snapshot, dirty: false, lastAction: "save" });
  }
  fresh() {
    this.history = [];
    this.publish({ ...newCreation(crypto.randomUUID()), open: true });
  }
  reveal(value: string) {
    const step =
      value.startsWith("shape:") || value.startsWith("color:")
        ? 0
        : value.startsWith("tone:") || value === "listen"
          ? 1
          : value.startsWith("name:")
            ? 2
            : ["save", "share", "fly"].includes(value)
              ? 3
              : this.snapshot.step;
    this.publish({ ...this.snapshot, open: true, step });
  }
  patch(recipe: HangarEntry["recipe"]) {
    const entry = checkedEntry({ ...this.snapshot.entry, recipe });
    this.history = [...this.history.slice(-15), this.snapshot];
    this.publish({ ...this.snapshot, entry, dirty: true, lastAction: "" });
  }
}
