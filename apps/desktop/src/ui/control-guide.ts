import type {
  ControlActionId,
  ControlContext,
  ControlMenuState,
} from "./control-menu";

/** Local guide contract, also usable by a future voice adapter. Never executes an action. */
export interface ControlGuideSession {
  initialVolume: number;
  targetVolume: number;
  expiresAt: number;
}
export interface ControlGuideView {
  status: "active" | "complete" | "expired";
  instruction: string;
  detail: string;
  target?: { actionId: ControlActionId; location: "panel" | "dock" };
}
export function beginVolumeGuide(
  volume: number,
  now: number,
  direction?: "up" | "down",
): ControlGuideSession {
  return {
    initialVolume: volume,
    targetVolume:
      direction === "down"
        ? Math.max(0, volume - 5)
        : direction === "up"
          ? Math.min(70, volume + 5)
          : volume >= 70
            ? 65
            : Math.min(70, volume + 5),
    expiresAt: now + 120_000,
  };
}
export function describeControlGuide(
  session: ControlGuideSession,
  menu: ControlMenuState["snapshot"],
  context: Pick<ControlContext, "volume" | "soundOn">,
  now: number,
): ControlGuideView {
  if (now >= session.expiresAt)
    return {
      status: "expired",
      instruction: "案内を終了しました。ボタン操作はそのまま続けられます。",
      detail: "続けるときは「操作案内を試す」から始められます。",
    };
  const louder = session.targetVolume > session.initialVolume;
  if (
    louder
      ? context.volume >= session.targetVolume
      : context.volume <= session.targetVolume
  )
    return {
      status: "complete",
      instruction: `音量が ${session.initialVolume}% から ${context.volume}% に変わりました。`,
      detail: context.soundOn
        ? "これからも「聴き方」で、自分の好みに調整できます。"
        : "音の再生は停止中です。聴くときは「音を聴く」を押してください。",
    };
  const target = (
    actionId: ControlActionId,
    location: "panel" | "dock",
    instruction: string,
  ): ControlGuideView => ({
    status: "active",
    target: { actionId, location },
    instruction,
    detail: `音量を ${session.targetVolume}% にする練習です。枠が付いたボタンを押してみましょう。`,
  });
  if (!menu.open)
    return target(
      "menu.toggle",
      "dock",
      "下のバーの「メニュー」を押してみてください。",
    );
  if (menu.page === "sound")
    return target(
      louder ? "sound.louder" : "sound.quieter",
      "panel",
      `「音量を${louder ? "上げる" : "下げる"}」を押してみてください。`,
    );
  if (menu.page !== "home")
    return target(
      "menu.home",
      "panel",
      "「メニューに戻る」を押してみてください。",
    );
  return target("menu.sound", "panel", "「聴き方」を押してみてください。");
}
