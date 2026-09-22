import { describe, expect, it } from "vitest";
import { Experience } from "../packages/core/src";
import { skyContext } from "../apps/desktop/src/ai/sky-assistant";
import {
  actionAchieved,
  actionProblem,
  parseAssistantAction,
} from "../packages/core/src/assistant-actions";
import {
  observationCandidates,
  observationSuggestion,
  parseTrialContext,
  type TrialContext,
} from "../packages/core/src/ai-trial";
const context: TrialContext = {
  revision: 1,
  surface: "desktop",
  phase: "EDIT",
  paused: false,
  volume: 35,
  soundOn: false,
  menuOpen: false,
  menuPage: "home",
  selected: false,
  selectedId: null,
  canEdit: true,
  controls: ["volume", "flight", "fleet", "aircraft", "sound"],
  fleet: [{ id: "ST-01", state: "waiting", distanceM: 300, pendingCount: 0 }],
};
describe("assistant capability contract", () => {
  it("includes configured aircraft before there are active flights", () => {
    const e = new Experience();
    e.setAirspace({ ...e.airspace, aircraftCount: 3 });
    const c = skyContext(
      e,
      { levels: { flights: {} }, context: null } as never,
      {
        volume: 35,
        soundOn: false,
        menuOpen: false,
        menuPage: "home",
        selected: false,
      },
    );
    expect(c.phase).toBe("EDIT");
    expect(c.fleet.map((f) => f.id)).toEqual(["ST-01", "ST-02", "ST-03"]);
    expect(
      c.fleet.every((f) => f.state === "waiting" && f.signalDb === -120),
    ).toBe(true);
  });
  it("rejects unknown tools, unsafe numbers and invented aircraft", () => {
    for (const raw of [
      { mode: "apply", control: "run_code", value: "anything" },
      { mode: "apply", control: "volume", value: "71" },
      { mode: "apply", control: "volume", value: "NaN" },
      { mode: "apply", control: "fleet", value: "100" },
    ])
      expect(() => parseAssistantAction(raw)).toThrow();
    const select = parseAssistantAction({
      mode: "apply",
      control: "aircraft",
      value: "ST-03",
    });
    expect(actionProblem(select, context)).toContain("いません");
  });
  it("distinguishes guidance from a setting change and checks actual results", () => {
    const a = parseAssistantAction({
      mode: "apply",
      control: "volume",
      value: "25",
    });
    expect(actionAchieved(a, context)).toBe(false);
    expect(actionAchieved(a, { ...context, volume: 25 })).toBe(true);
    expect(
      actionProblem(
        { ...a, control: "fleet", value: "3" },
        { ...context, canEdit: false },
      ),
    ).toContain("編集");
    expect(
      actionProblem(
        { ...a, control: "flight", value: "start" },
        { ...context, phase: "FLY" },
      ),
    ).toContain("すでに");
    expect(
      actionAchieved(
        { ...a, control: "flight", value: "start" },
        { ...context, phase: "COMPILE" },
      ),
    ).toBe(true);
  });
  it("prevents the shared adapter from advertising a local flight action", () => {
    const c = {
      ...context,
      surface: "shared" as const,
      controls: ["volume" as const],
    };
    expect(
      actionProblem({ mode: "apply", control: "flight", value: "start" }, c),
    ).toContain("使えない");
    expect(
      actionProblem({ mode: "guide", control: "volume", value: "25" }, c),
    ).toBeNull();
  });
});
describe("observation becomes an optional next action", () => {
  it("offers the actual approaching aircraft without changing settings by observation alone", () => {
    const c: TrialContext = {
      ...context,
      phase: "FLY",
      fleet: [
        {
          ...context.fleet[0],
          state: "flying",
          radialMps: -40,
          signalDb: -120,
        },
      ],
    };
    const candidates = observationCandidates(c);
    expect(candidates.approach).toContain("近づいて");
    expect(candidates.signal).toBeUndefined();
    expect(observationSuggestion(c, candidates.approach)).toEqual({
      label: "ST-01を見る",
      action: { mode: "apply", control: "aircraft", value: "ST-01" },
    });
    expect(c.selectedId).toBeNull();
  });
  it("validates telemetry and describes signals without claiming a listener heard them", () => {
    expect(() =>
      parseTrialContext({
        ...context,
        fleet: [{ ...context.fleet[0], signalDb: Infinity }],
      }),
    ).toThrow();
    const c = parseTrialContext({
      ...context,
      soundOn: true,
      fleet: [{ ...context.fleet[0], signalDb: -30 }],
    });
    expect(observationCandidates(c).signal).toContain(
      "マイクで聴こえ方を測った結果ではありません",
    );
    expect(
      observationCandidates({ ...c, soundOn: false }).signal,
    ).toBeUndefined();
  });
});
