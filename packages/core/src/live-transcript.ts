export interface LiveTranscriptFragment {
  speaker: "user" | "assistant";
  text: string;
  startMs: number | null;
  endMs: number | null;
}

/** Keep a bounded rolling history, not one fake conversation turn per delta. */
export class LiveTranscript {
  private fragments: LiveTranscriptFragment[] = [];
  clear() {
    this.fragments = [];
  }
  append(
    speaker: LiveTranscriptFragment["speaker"],
    text: string,
    start?: unknown,
    end?: unknown,
  ) {
    if (!text) return;
    const time = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
    this.fragments.push({
      speaker,
      text: text.slice(-4000),
      startMs: time(start),
      endMs: time(end),
    });
    while (
      this.fragments.length > 160 ||
      this.fragments.reduce((n, f) => n + f.text.length, 0) > 5000
    )
      this.fragments.shift();
  }
  snapshot(): readonly LiveTranscriptFragment[] {
    return this.fragments.map((f) => ({ ...f }));
  }
  summary() {
    const groups: {
      speaker: LiveTranscriptFragment["speaker"];
      text: string;
    }[] = [];
    for (const f of this.fragments) {
      const last = groups.at(-1);
      if (last?.speaker === f.speaker) last.text += f.text;
      else groups.push({ speaker: f.speaker, text: f.text });
    }
    return groups
      .map((g) => `${g.speaker === "user" ? "利用者" : "音声案内"}: ${g.text}`)
      .join("\n");
  }
}
