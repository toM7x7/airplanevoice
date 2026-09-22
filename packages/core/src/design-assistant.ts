import { AIRCRAFT_PATTERNS } from "./show";
import { AIRCRAFT_COLORS } from "./creation";
import { validateAircraft, type AircraftDesign } from "./workshop";
import { TYPESAFE_MODEL } from "./ai-intent";

export const DESIGN_CHOICES: Record<string, Record<string, string>> = {
  shape: {
    keep: "今の機体の寸法・形を維持",
    ...Object.fromEntries(
      AIRCRAFT_PATTERNS.map((p, i) => [
        `shape_${i}`,
        `${p.name}: ${JSON.stringify(p.aircraft)}`,
      ]),
    ),
  },
  accent: {
    keep: "今の尾翼の色を維持",
    ...Object.fromEntries(
      AIRCRAFT_COLORS.map((p, i) => [`color_${i}`, p.name]),
    ),
  },
  body: {
    keep: "今の胴体色を維持",
    white: "明るい白",
    cream: "柔らかいクリーム",
    silver: "落ち着いた銀色",
  },
  engines: {
    keep: "今のエンジン数を維持",
    two: "双発（2基）",
    four: "四発（4基）",
  },
  winglet: {
    keep: "今の翼端を維持",
    none: "翼端を立てない",
    low: "低い翼端（1.5m）",
    high: "高い翼端（3m）",
  },
};
export const DESIGN_LABELS: Record<string, string> = {
  shape: "形",
  accent: "尾翼の色",
  body: "胴体の色",
  engines: "エンジン数",
  winglet: "翼端",
};
const QUESTIONS: Record<string, string> = {
  shape:
    "機体の全体形状・寸法はどの候補が要求に最も合うか。色や音では選ばない。",
  accent: "尾翼の色は何色か。胴体色の指示と混同しない。",
  body: "胴体の色は何色か。尾翼色の指示と混同しない。",
  engines: "要求されるエンジン数は双発か四発か。",
  winglet:
    "翼端をどの高さに立てるか。翼が長いという指示だけで翼端の高さを変えない。",
};
export function designRequest(utterance: string, current: AircraftDesign) {
  validateAircraft(current);
  return {
    model: TYPESAFE_MODEL,
    state: { request: utterance.slice(0, 500), current },
    questions: Object.fromEntries(
      Object.entries(DESIGN_CHOICES).map(([key, criteria]) => [
        key,
        {
          type: "choice",
          instructions:
            QUESTIONS[key] +
            " requestだけを変更要求として読む。currentは現在値であり変更の要求ではない。言及されていない項目や曖昧な項目はkeep。保存・出発は行わない。",
          criteria,
        },
      ]),
    ),
  };
}
export function evaluateDesignProposal(
  raw: unknown,
  current: AircraftDesign,
): {
  aircraft: AircraftDesign | null;
  reason: "ready" | "uncertain" | "unchanged" | "invalid";
  applied: string[];
  uncertain: string[];
} {
  const r = raw as {
    model?: string;
    answers?: Record<
      string,
      {
        type: string;
        choice: string;
        confidence: number;
        probabilities: Record<string, number>;
      }
    >;
  };
  const invalid = () => ({
    aircraft: null,
    reason: "invalid" as const,
    applied: [],
    uncertain: [],
  });
  if (!r || r.model !== TYPESAFE_MODEL || !r.answers) return invalid();
  const uncertain: string[] = [],
    applied: string[] = [];
  const selected: Record<string, string> = {};
  for (const [key, criteria] of Object.entries(DESIGN_CHOICES)) {
    const a = r.answers[key],
      names = Object.keys(criteria);
    if (
      !a ||
      a.type !== "choice" ||
      !Object.hasOwn(criteria, a.choice) ||
      !Number.isFinite(a.confidence) ||
      a.confidence < 0 ||
      a.confidence > 1 ||
      !a.probabilities ||
      Object.keys(a.probabilities).length !== names.length
    )
      return invalid();
    const values = names.map((k) => a.probabilities[k]);
    if (
      values.some((v) => !Number.isFinite(v) || v < 0 || v > 1) ||
      Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 0.01 ||
      a.probabilities[a.choice] < Math.max(...values)
    )
      return invalid();
    selected[key] = a.confidence >= 0.55 ? a.choice : "keep";
    if (a.confidence < 0.55 && a.choice !== "keep")
      uncertain.push(DESIGN_LABELS[key]);
    if (selected[key] !== "keep") applied.push(DESIGN_LABELS[key]);
  }
  const result = { ...current };
  if (selected.shape !== "keep") {
    const shape = AIRCRAFT_PATTERNS[Number(selected.shape.slice(6))].aircraft;
    for (const key of [
      "bodyLengthM",
      "wingSpanM",
      "bodyWidthM",
      "wingSweepDeg",
      "engineScale",
    ] as const) {
      if (shape[key] !== undefined) result[key] = shape[key];
    }
  }
  if (selected.accent !== "keep")
    result.color = AIRCRAFT_COLORS[Number(selected.accent.slice(6))].color;
  if (selected.body !== "keep")
    result.bodyColor = (
      { white: "#eceeea", cream: "#eee4cf", silver: "#adb8c0" } as Record<
        string,
        string
      >
    )[selected.body];
  if (selected.engines !== "keep")
    result.engineCount = selected.engines === "two" ? 2 : 4;
  if (selected.winglet !== "keep")
    result.wingletHeightM = (
      { none: 0, low: 1.5, high: 3 } as Record<string, number>
    )[selected.winglet];
  validateAircraft(result);
  const changed = JSON.stringify(result) !== JSON.stringify(current);
  return {
    aircraft: changed ? result : null,
    reason: changed ? "ready" : uncertain.length ? "uncertain" : "unchanged",
    applied,
    uncertain,
  };
}

export function designProposal(
  raw: unknown,
  current: AircraftDesign,
): AircraftDesign | null {
  return evaluateDesignProposal(raw, current).aircraft;
}
