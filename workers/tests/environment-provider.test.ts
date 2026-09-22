import { it, expect, vi, afterEach } from "vitest";
import { proposeEnvironment } from "../environment-provider";
import {
  changeEnvironment,
  environmentPreset,
} from "../../packages/core/src/environment";
import { actionAchieved } from "../../packages/core/src/assistant-actions";
import type { TrialContext } from "../../packages/core/src/ai-trial";
const context: TrialContext = {
  revision: 1,
  phase: "EDIT",
  paused: false,
  volume: 30,
  soundOn: false,
  menuOpen: false,
  menuPage: "home",
  selected: false,
  fleet: [],
  controls: ["environment"],
  ui: {
    mode: "pc",
    place: "observe",
    tab: "shape",
    canFly: false,
    flightHelp: "",
  },
  environment: environmentPreset("airfield"),
};
const recipe = {
  ...environmentPreset("city"),
  name: "巴里と東京の空",
  heightM: 65,
  greenery: 0.3,
  buildingSound: false,
};
function response(value: unknown) {
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  });
}
afterEach(() => vi.unstubAllGlobals());
it("returns one atomic local draft with an honest summary, never a launch or publish", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      response({
        ...recipe,
        summary:
          "箱形の建物で高さと密度を近づけた案です。建築様式は再現していません。",
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const reply = await proposeEnvironment("test", "パリと東京を混ぜて", context);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(reply.action?.control).toBe("environment");
  const draft = changeEnvironment(context.environment!, reply.action!.value);
  expect(draft).toEqual(recipe);
  expect(
    actionAchieved(reply.action!, { ...context, environment: draft }),
  ).toBe(true);
  expect(reply.text).toContain("建築様式は再現していません");
});
it("rejects out of range or executable fields without affecting the current environment", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(response({ ...recipe, heightM: 500, summary: "案" })),
  );
  await expect(proposeEnvironment("test", "高い街", context)).rejects.toThrow(
    "設定値",
  );
  expect(() =>
    changeEnvironment(
      context.environment!,
      "recipe:" + JSON.stringify({ ...recipe, script: "eval()" }),
    ),
  ).toThrow();
  expect(context.environment).toEqual(environmentPreset("airfield"));
});
it("does not request a provider outside PC scenery editing", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    proposeEnvironment("test", "街", {
      ...context,
      ui: { ...context.ui!, mode: "vr" },
    }),
  ).rejects.toThrow("PC");
  expect(fetcher).not.toHaveBeenCalled();
});
