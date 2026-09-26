import type { SharedVrPanel } from "../vr";
type Button = SharedVrPanel["buttons"][number];
/** Reusable VR page: choices above, always the same return position below. Dock belongs to the surface. */
export function xrMenuPage(input: {
  title: string;
  status: string;
  detail: string;
  actions: Pick<Button, "label" | "press" | "enabled" | "role" | "highlight">[];
  back: () => void;
  backLabel?: string;
}): SharedVrPanel {
  if (input.actions.length > 6)
    throw new Error("XR page needs pagination above six choices");
  return {
    layout: "authored",
    title: input.title,
    status: input.status,
    detail: input.detail,
    buttons: [
      ...input.actions.map((b, i) => ({
        ...b,
        x: 28 + (i % 2) * 494,
        y: 145 + Math.floor(i / 2) * 64,
        w: 476,
        h: 54,
      })),
      {
        label: input.backLabel ?? "空のメニューに戻る",
        press: input.back,
        role: "navigation",
        x: 28,
        y: 351,
        w: 476,
        h: 56,
      },
    ],
  };
}
