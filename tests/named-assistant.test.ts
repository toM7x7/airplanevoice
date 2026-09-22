import { afterEach, expect, it, vi } from "vitest";
import { actionAchieved, actionProblem, actionResult, assistantMenu } from "../packages/core/src/assistant-actions";
import { contextSummary, observationCandidates, observationSuggestion, parseTrialContext, type TrialContext } from "../packages/core/src/ai-trial";
import { answerTrial } from "../workers/ai-provider";
const context: TrialContext = {
  revision: 1, surface: "shared", phase: "FLY", paused: false, volume: 35,
  soundOn: true, menuOpen: true, menuPage: "home", selected: false,
  controls: ["hangar", "menu", "creation", "aircraft"],
  fleet: [{ id: "ST-01", name: "そらのつばさ", state: "flying", distanceM: 300, radialMps: -40, pendingCount: 0 }],
  hangar: [{ id: "aircraft-001", name: "そらのつばさ", place: "クラウド" }],
  ui: { mode: "vr", place: "hangar", tab: "shape", canFly: true, flightHelp: "出発できます" },
};
afterEach(() => vi.unstubAllGlobals());
it("preserves aircraft names and current menu through server validation", () => {
  const parsed = parseTrialContext(context);
  expect(parsed.fleet[0].name).toBe("そらのつばさ"); expect(parsed.hangar).toEqual(context.hangar);
  expect(parsed.ui).toEqual(context.ui);
  expect(contextSummary(parsed)).toContain("そらのつばさ");
  const note = observationCandidates(parsed).approach;
  expect(note).toContain("そらのつばさ");
  expect(observationSuggestion(parsed, note)?.label).toBe("そらのつばさを見る");
  expect(observationSuggestion({ ...parsed, fleet: [...parsed.fleet, { ...parsed.fleet[0], id: "ST-02" }] }, note)).toBeUndefined();
  expect(() => parseTrialContext({ ...context, hangar: [...context.hangar!, ...context.hangar!] })).toThrow();
  expect(() => parseTrialContext({ ...context, fleet: [{ ...context.fleet[0], name: "x".repeat(41) }] })).toThrow();
});
it("checks actual hangar IDs and keeps confirmation separate from loading and flight", () => {
  const action = { mode: "apply", control: "hangar", value: "load:aircraft-001" } as const;
  expect(actionProblem(action, context)).toBeNull(); expect(actionAchieved(action, context)).toBe(false);
  expect(actionProblem({ ...action, value: "load:invented-id" }, context)).toContain("ありません");
  const pending = { ...context, ui: { ...context.ui!, pendingAircraftId: "aircraft-001" } };
  expect(actionAchieved(action, pending)).toBe(true);
  expect(actionResult(action, pending, true)).toContain("まだ切り替えていません");
  expect(actionProblem({ mode: "apply", control: "creation", value: "tone:0" }, pending)).toContain("確認中");
  expect(actionProblem({ mode: "apply", control: "creation", value: "fly" }, context)).toContain("最終決定");
  expect(actionProblem({ mode: "apply", control: "menu", value: "route" }, context)).toContain("PC");
  expect(assistantMenu(context).pages.some((p) => p.value === "route")).toBe(false);
});
it("gives the paid backend the real menu and named hangar, using a provider fixture only", async () => {
  let request: Record<string, unknown> = {};
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    request = JSON.parse(init.body);
    return Response.json({ status: "completed", output: [{ type: "function_call", name: "control_sky", arguments: JSON.stringify({ mode: "apply", control: "hangar", value: "load:aircraft-001" }) }] });
  }));
  const reply = await answerTrial("fixture", "そらのつばさを呼んで", context, "", "どの機体にしますか？");
  const payload = JSON.parse(request.input as string);
  expect(payload.menu.aircraft[0]).toMatchObject({ name: "そらのつばさ", value: "load:aircraft-001" });
  expect(payload.menu.editing.sounds).toHaveLength(3);
  expect(payload.screen.fleet[0]).toMatchObject({ id: "ST-01", name: "そらのつばさ" });
  expect(reply.action?.value).toBe("load:aircraft-001");
});

it("prioritizes VR selection and visible controls even with twenty-four aircraft",()=>{
 const fleet=Array.from({length:24},(_,i)=>({...context.fleet[0],id:`ST-${String(i+1).padStart(2,"0")}`,name:`機体${i+1}`,sourceEntryId:"aircraft-001"}));
 const parsed=parseTrialContext({...context,selected:true,selectedId:"ST-24",fleet,ui:{...context.ui,panelTitle:"機体をつくる · 寸法",tab:"dimensions",buttons:["胴体 ＋2m","この機体を飛ばす"]}});
 const summary=contextSummary(parsed);expect(summary.indexOf("vr/")).toBeLessThan(100);expect(summary.indexOf("機体24")).toBeLessThan(150);expect(summary).toContain("胴体 ＋2m");
 expect(assistantMenu(parsed).selectedAircraft?.sourceEntryId).toBe("aircraft-001");
 expect(assistantMenu(parsed).pages.find(p=>p.value==="hangar")?.label).toBe("保存した機体");
});
