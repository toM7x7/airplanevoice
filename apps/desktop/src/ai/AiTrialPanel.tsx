import { useEffect, useRef, useState } from "react";
import type {
  AiGuide,
  TrialContext,
  TrialStatus,
  TrialReply,
} from "../../../../packages/core/src/ai-trial";
import type { AssistantAction } from "../../../../packages/core/src/assistant-actions";
import {
  TrialApi,
  TrialVoice,
  bindTrialPageLifecycle,
  type LiveClientState,
} from "./trial-client";
import "./ai-trial.css";
export interface VoiceControls {
  ready: boolean;
  active: boolean;
  muted: boolean;
  message: string;
  start: () => void;
  stop: () => void;
  toggleMute: () => void;
  prepared?: boolean;
  authorized?: boolean;
  prepare?: () => void;
  observing?: boolean;
  observerReady?: boolean;
  observationNote?: string;
  toggleObservation?: () => void;
  show?: () => void;
  askText?: (text: string) => Promise<string>;
}

function savedAccess() {
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get("trial");
  if (key) {
    sessionStorage.setItem("av-ai-trial", key);
    params.delete("trial");
    history.replaceState(
      null,
      "",
      location.pathname +
        location.search +
        (params.size ? "#" + params.toString() : ""),
    );
  }
  return sessionStorage.getItem("av-ai-trial") ?? "";
}
export function AiTrialPanel({
  getContext,
  onGuide,
  disabled,
  onAction,
  integrated = false,
  onVoiceControls,
  onSpeakingChange,
}: {
  getContext: () => TrialContext;
  onGuide: (guide: AiGuide) => void;
  disabled: boolean;
  onAction?: (action: AssistantAction) => Promise<boolean>;
  integrated?: boolean;
  onVoiceControls?: (controls: VoiceControls) => void;
  onSpeakingChange?: (speaking: boolean) => void;
}) {
  const [open, setOpen] = useState(
    ["trial", "guide"].includes(
      new URLSearchParams(location.search).get("ai") ?? "",
    ),
  );
  const [access, setAccess] = useState(savedAccess);
  useEffect(() => {
    let disposed = false;
    void fetch("/api/ai/access", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((config) => {
        if (!disposed && config?.publicDemo) {
          setAccess("public-demo");
          setOpen(true);
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  const [inputKey, setInputKey] = useState("");
  const [compact, setCompact] = useState(integrated);
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const textInput = useRef<HTMLInputElement>(null);
  const textBusy = useRef(false);
  const [reply, setReply] = useState("");
  const [check, setCheck] = useState("");
  const [voice, setVoice] = useState<LiveClientState>({
    phase: "idle",
    message: "会話は停止中です。",
    user: "",
    assistant: "",
    muted: false,
  });
  const api = useRef<TrialApi | null>(null);
  useEffect(() => {
    onSpeakingChange?.(voice.speaking ?? false);
    return () => onSpeakingChange?.(false);
  }, [voice.speaking, onSpeakingChange]);
  const player = useRef<TrialVoice | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const context = useRef(getContext);
  context.current = getContext;
  const guide = useRef(onGuide);
  guide.current = onGuide;
  const action = useRef(onAction);
  action.current = onAction;
  const seenReply = useRef("");
  const consume = useRef<
    (reply: TrialReply & { id: string }) => Promise<string>
  >(async () => "");
  useEffect(() => {
    if (!access || !open || disabled || !audio.current) return;
    let cancelled = false;
    let sending = false;
    const client = new TrialApi(access);
    api.current = client;
    const live = new TrialVoice(client, audio.current, (s) => {
      if (!cancelled) setVoice(s);
    });
    player.current = live;
    setVoice(live.state);
    consume.current = async (r) => {
      if (cancelled || r.id === seenReply.current) return r.text;
      let completedText = r.text;
      seenReply.current = r.id;
      setReply(r.text);
      if (r.command) {
        const designDraft =
          r.command.action.control === "creation" &&
          r.command.action.value.startsWith("design:");
        const sceneryDraft=r.command.action.control==="environment" && r.command.action.value.startsWith("recipe:");
        setCompact(!designDraft);
        let ok = false;
        try {
          if (r.command.expiresAt >= Date.now() && action.current)
            ok = await action.current(r.command.action);
        } catch {
          /* Report failure without repeating the operation. */
        }
        if (cancelled) return "操作の接続が終了しました。";
        try {
          const result = await client.request<{ text: string }>(
            "action-result",
            { id: r.command.id, ok, context: context.current() },
          );
          completedText =
            ok && (designDraft||sceneryDraft) ? `${r.text}\n${result.text}` : result.text;
          if (!cancelled) setReply(completedText);
        } catch {
          completedText =
            "画面の操作結果を通信で返せませんでした。操作は自動で繰り返しません。現在の設定を確認してください。";
          if (!cancelled) setError(completedText);
        }
      } else {
        if (r.guide !== "none") setCompact(true);
        guide.current(r.guide);
      }
      return completedText;
    };
    const sync = async () => {
      if (cancelled || sending) return;
      sending = true;
      try {
        const s = await client.context(context.current());
        if (cancelled) return;
        setStatus(s);
        setError("");
        if (s.reply && s.reply.id !== seenReply.current) {
          await consume.current(s.reply);
        }
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "AIに接続できませんでした。",
          );
      } finally {
        sending = false;
      }
    };
    void sync();
    let lastKey = "",
      lastSync = 0;
    const timer = setInterval(() => {
      const c = context.current();
      const key = JSON.stringify([
        c.selectedId,
        c.fleet.find((f) => f.id === c.selectedId)?.name,
        [c.ui?.mode, c.ui?.place, c.ui?.tab, c.ui?.pendingAircraftId],
        c.creation,
      ]);
      if (!sending && (key !== lastKey || Date.now() - lastSync > 5000)) {
        lastKey = key;
        lastSync = Date.now();
        void sync();
      }
    }, 500);
    let polling = false;
    const commands = setInterval(() => {
      if (cancelled || polling || live.state.phase !== "connected") return;
      polling = true;
      void client
        .status()
        .then((s) => {
          if (!cancelled && s.reply) return consume.current(s.reply);
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, 800);
    const unbind = bindTrialPageLifecycle(
      () => void sync(),
      () => {
        void live.end("ページを閉じたため、会話を終了しました。");
        void client.stop().catch(() => {});
      },
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(commands);
      unbind();
      live.dispose();
      void client.stop().catch(() => {});
      if (api.current === client) api.current = null;
      player.current = null;
    };
  }, [access, open, disabled]);
  const perform = async (fn: (client: TrialApi) => Promise<void>) => {
    if (!api.current || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.current.context(context.current());
      await fn(api.current);
      setStatus(await api.current.status());
    } catch (e) {
      setError(e instanceof Error ? e.message : "接続できませんでした。");
    } finally {
      setBusy(false);
    }
  };
  const askText = async (text: string): Promise<string> => {
    if (textBusy.current || busy) return "前の相談への回答を待っています。";
    if (!text.trim() || text.length > 500)
      return "相談は1〜500文字で入力してください。";
    textBusy.current = true;
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      for (let n = 0; n < 30 && !api.current; n++)
        await new Promise((r) => setTimeout(r, 100));
      const client = api.current;
      if (!client)
        throw new Error(
          "AIに接続できません。AI案内の接続状態を確認してください。",
        );
      const status = await client.context(context.current());
      if (!status.enabled) throw new Error("AI接続の準備ができていません。");
      setStatus(status);
      const response = await client.ask(text);
      const latest=await client.status();
      const result = latest.reply ? await consume.current(latest.reply) : response.text;
      setStatus(latest);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "相談に接続できませんでした。";
      setError(message);
      return message;
    } finally {
      textBusy.current = false;
      setBusy(false);
    }
  };
  const ask = () =>
    void perform(async (client) => {
      await client.ask(question);
      setQuestion("");
      const s = await client.status();
      setStatus(s);
      if (s.reply) {
        await consume.current(s.reply);
      }
    });
  const active = ["connecting", "connected", "closing"].includes(voice.phase);
  const voiceReady =
    !!status?.enabled &&
    !!player.current &&
    !busy &&
    !active &&
    !["creating", "active", "closing", "unconfirmed"].includes(
      status?.live.status ?? "",
    );
  useEffect(() => {
    onVoiceControls?.({
      ready: voiceReady,
      active,
      muted: voice.muted,
      message: !access
        ? "運営者によるAI接続設定が必要です。手操作はそのまま使えます。"
        : !open
          ? "AIを準備してから、会話や観察を選べます。"
          : error || voice.message,
      authorized: !!access,
      prepared: open && !!api.current,
      askText,
      show: () => {
        setOpen(true);
        setCompact(false);
        setTimeout(() => {
          textInput.current?.focus();
          textInput.current?.scrollIntoView({ block: "nearest" });
        }, 100);
      },
      prepare: () => {
        setOpen(true);
        setCompact(true);
      },
      observing: !!status?.observer.on,
      observerReady: !!status?.enabled && !!api.current && !busy,
      observationNote: status?.observer.error || status?.observer.note || "",
      toggleObservation: () => {
        void perform(async (c) => {
          setStatus(await c.request("observe", { on: !status?.observer.on }));
        });
      },
      start: () => {
        if (voiceReady)
          void perform(async () => {
            await player.current?.start();
          });
      },
      stop: () => {
        void player.current?.end();
      },
      toggleMute: () => player.current?.setMuted(!voice.muted),
    });
  }, [
    onVoiceControls,
    voiceReady,
    active,
    voice.muted,
    voice.message,
    error,
    open,
    access,
    busy,
    status?.enabled,
    status?.observer.on,
    status?.observer.note,
    status?.observer.error,
  ]);
  return (
    <aside
      className="av-ai"
      data-open={open}
      data-integrated={integrated}
      data-compact={compact && open}
      aria-label="AI操作案内"
    >
      {!open ? (
        <button
          type="button"
          className="av-ai-launch"
          onClick={() => {
            setCompact(false);
            setOpen(true);
          }}
        >
          AI案内
        </button>
      ) : (
        <section className="av-ai-panel" data-compact={compact}>
          <header>
            <div>
              <small>AIRPLANEVOICE · 操作アシスト</small>
              <h2>機体づくりと空の相談相手</h2>
            </div>
            {!compact && (
              <button type="button" onClick={() => setCompact(true)}>
                小さくする
              </button>
            )}
            <button
              type="button"
              aria-label="AI案内を閉じる"
              onClick={() => setOpen(false)}
            >
              閉じる
            </button>
          </header>
          {compact && (
            <div className="av-ai-voice-actions">
              <button type="button" onClick={() => setCompact(false)}>
                案内を開く
              </button>
              {!active && access && (
                <button
                  type="button"
                  disabled={!voiceReady}
                  onClick={() =>
                    void perform(async () => {
                      await player.current?.start();
                    })
                  }
                >
                  GPTライブで相談
                </button>
              )}
              {access && (
                <button
                  type="button"
                  disabled={!status?.enabled || busy}
                  onClick={() =>
                    void perform(async (c) => {
                      setStatus(
                        await c.request("observe", {
                          on: !status?.observer.on,
                        }),
                      );
                    })
                  }
                >
                  {status?.observer.on
                    ? "Jevの観察を止める"
                    : "Jevの観察を始める"}
                </button>
              )}
              {active && (
                <button
                  type="button"
                  onClick={() => void player.current?.end()}
                >
                  会話を終える
                </button>
              )}
            </div>
          )}
          {compact && error && (
            <p className="av-ai-error" role="alert">
              {error}
            </p>
          )}
          <div className="av-ai-body">
            <p className="av-ai-intro">
              「どこを押すの？」で場所を示し、「変えて」で対応する設定を変えます。自分でも同じ操作ができます。
            </p>
            {!access ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sessionStorage.setItem("av-ai-trial", inputKey.trim());
                  setAccess(inputKey.trim());
                  setInputKey("");
                }}
              >
                <label>
                  AI案内の入場キー
                  <input
                    type="password"
                    autoComplete="off"
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                    required
                  />
                </label>
                <button type="submit">AI案内を開く</button>
                <p>OpenAIやTypeSafeのAPIキーはここに入力しません。</p>
              </form>
            ) : (
              <>
                <form
                  className="av-ai-section"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask();
                  }}
                >
                  <h3>文字でも相談</h3>
                  <label>
                    操作や飛行について
                    <input
                      ref={textInput}
                      placeholder="例：細身の双発機で、尾翼を紺色に"
                      maxLength={500}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !status?.enabled || !question.trim()}
                  >
                    相談する
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !status?.enabled ||
                      !status?.configured.typesafe ||
                      !question.trim()
                    }
                    onClick={() =>
                      void perform(async (c) => {
                        await c.ask(`【Jev機体案】${question}`.slice(0, 500));
                        setQuestion("");
                        const s = await c.status();
                        setStatus(s);
                        if (s.reply) await consume.current(s.reply);
                      })
                    }
                  >
                    Jevで機体案を作る
                  </button>
                  {reply && (
                    <p className="av-ai-reply" role="status">
                      {reply}
                    </p>
                  )}
                </form>
                <div className="av-ai-section">
                  <h3>
                    空の注目点 <small>TypeSafe</small>
                  </h3>
                  <p role="status">
                    {status?.observer.note ?? "接続設定を確認しています…"}
                  </p>
                  {status?.observer.at ? (
                    <small>
                      {new Date(status.observer.at).toLocaleTimeString("ja-JP")}{" "}
                      の観察{" "}
                      {status.observer.waiting
                        ? "· 画面の更新待ち"
                        : status.observer.on
                          ? "· 更新中"
                          : "· 停止中"}
                    </small>
                  ) : null}
                  {status?.observer.error && (
                    <p className="av-ai-error">{status.observer.error}</p>
                  )}
                  {status?.observer.suggestion && onAction && (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        status.observer.waiting ||
                        Date.now() - status.observer.at > 20000
                      }
                      onClick={() => {
                        setCompact(true);
                        void onAction(status.observer.suggestion!.action).catch(
                          () =>
                            setError(
                              "操作できませんでした。今の状態を確認してください。",
                            ),
                        );
                      }}
                    >
                      {status.observer.suggestion.label}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || !status?.enabled}
                    onClick={() =>
                      void perform(async (c) => {
                        setStatus(
                          await c.request("observe", {
                            on: !status?.observer.on,
                          }),
                        );
                      })
                    }
                  >
                    {status?.observer.on ? "観察を止める" : "観察を始める"}
                  </button>
                </div>
                <div className="av-ai-section">
                  <h3>
                    声で相談 <small>GPT-Live</small>
                  </h3>
                  <p role="status">{voice.message}</p>
                  <p>
                    一度開始したら、続けて質問できます。発話ごとのボタン操作は不要です。終えるときは「会話を終える」。
                  </p>
                  {!active ? (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        !status?.enabled ||
                        [
                          "creating",
                          "active",
                          "closing",
                          "unconfirmed",
                        ].includes(status?.live.status ?? "")
                      }
                      onClick={() =>
                        void perform(async () => {
                          await player.current?.start();
                        })
                      }
                    >
                      会話を始める
                    </button>
                  ) : (
                    <div className="av-ai-voice-actions">
                      <button
                        type="button"
                        className="av-ai-stop"
                        onClick={() => void player.current?.end()}
                      >
                        会話を終える
                      </button>
                      {voice.phase === "connected" && (
                        <button
                          type="button"
                          aria-pressed={voice.muted}
                          onClick={() => player.current?.setMuted(!voice.muted)}
                        >
                          {voice.muted ? "マイクを戻す" : "マイクをミュート"}
                        </button>
                      )}
                    </div>
                  )}
                  <p>
                    回数・時間制限はありません。接続中は沈黙・ミュート中も利用時間に含みます。
                  </p>
                  <audio
                    ref={audio}
                    autoPlay
                    controls
                    hidden={!active}
                    aria-label="AIの音声"
                  />
                  {status?.live.error && (
                    <p className="av-ai-error">{status.live.error}</p>
                  )}
                  {(voice.user || voice.assistant) && (
                    <details>
                      <summary>会話の字幕</summary>
                      <p>あなた：{voice.user}</p>
                      <p>案内：{voice.assistant}</p>
                    </details>
                  )}
                </div>

                <details className="av-ai-details">
                  <summary>接続・利用履歴</summary>
                  <p>
                    音声 {status?.used.conversations ?? 0}回 · 回答{" "}
                    {status?.used.replies ?? 0}回 · 観察{" "}
                    {status?.used.observations ?? 0}回
                  </p>
                  <p>
                    上限ではなく送信履歴です。失敗した送信も含みます。観察は約10秒ごと。ページを閉じるかAIパネルを閉じると終了します。タブの切替だけでは会話を止めません。
                  </p>
                  {status?.live.endReason && (
                    <p>前回の終了理由：{status.live.endReason}</p>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async (c) => {
                        const r = await c.request<{
                          liveModel: string;
                          backendModel: string;
                        }>("check", {});
                        setCheck(
                          `GPT-Live：${r.liveModel}\n文字の回答：${r.backendModel}`,
                        );
                      })
                    }
                  >
                    接続設定を確認
                  </button>
                  {check && <p className="av-ai-check">{check}</p>}
                  <button
                    type="button"
                    onClick={() => {
                      sessionStorage.removeItem("av-ai-trial");
                      setAccess("");
                      setStatus(null);
                    }}
                  >
                    入場キーを忘れる
                  </button>
                </details>
              </>
            )}
            {error && (
              <p className="av-ai-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
