import {
  designRequest,
  designProposal,
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
  const aircraft = designProposal(raw, current);
  return aircraft
    ? {
        text: "Jevが機体案を組みました。下書きで確認し、スライダーや『ひとつ戻す』で調整できます。",
        guide: "none",
        revision: c.revision,
        action: {
          mode: "apply",
          control: "creation",
          value: `design:${JSON.stringify(aircraft)}`,
        },
      }
    : {
        text: "機体案を絞れませんでした。双発か四発、色、長い翼など、重視する点を教えてください。",
        guide: "none",
        revision: c.revision,
      };
}
