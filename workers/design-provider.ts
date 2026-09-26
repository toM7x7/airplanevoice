import {
  designRequest,
  evaluateDesignProposal,
} from "../packages/core/src/design-assistant";
import { DEFAULT_AIRCRAFT } from "../packages/core/src/workshop";
import type { TrialContext, TrialReply } from "../packages/core/src/ai-trial";
import { AiError, providerJson } from "./ai-provider";
export async function proposeDesign(
  key: string,
  question: string,
  c: TrialContext,
): Promise<TrialReply> {
  if (!key) throw new AiError("TypeSafeのキーが未設定です。", 503);
  if (!c.controls?.includes("creation") || c.ui?.pendingAircraftId)
    throw new AiError("先に編集する機体を選んでください。", 409);
  const current = c.creation?.aircraft ?? DEFAULT_AIRCRAFT;
  const raw = await providerJson(
    "https://api.typesafe.ai/v1/systemone",
    key,
    designRequest(question, current),
    5000,
  );
  const result = evaluateDesignProposal(raw, current),
    aircraft = result.aircraft;
  if (result.reason === "invalid")
    throw new AiError(
      "Jevの応答形式を確認できませんでした。機体は変更していません。",
      502,
    );
  return aircraft
    ? {
        text: `Jevの案：${result.applied.join("・")}を下書きに反映します。${result.uncertain.length ? result.uncertain.join("・") + "は候補が分かれたため、今の設定を保ちます。" : ""}保存や出発はご自身で選べます。`,
        guide: "none",
        revision: c.revision,
        action: {
          mode: "apply",
          control: "creation",
          value: `design:${JSON.stringify(aircraft)}`,
        },
      }
    : {
        text:
          result.reason === "unchanged"
            ? "今の機体を維持する案でした。変えたい点を、例えば『尾翼を紺色に、双発に』のように指定できます。"
            : `${result.uncertain.join("・")}の候補が分かれました。ここは今の設定を保っています。変えたい形や色をもう少し指定するか、ボタンから選べます。`,
        guide: "none",
        revision: c.revision,
      };
}
