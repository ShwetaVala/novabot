const MAX_HISTORY_TURNS = Number(process.env.NOVA_MAX_HISTORY_TURNS ?? 6);
const SUMMARIZE_AFTER_TURNS = Number(process.env.NOVA_SUMMARIZE_AFTER_TURNS ?? 10);

export class Conversation {
  constructor() {
    this.history = [];
    this.summary = "";
    this.userMessageCount = 0;
  }

  addUser(text) {
    this.userMessageCount++;
    this.history.push({ role: "user", parts: [{ text }] });
  }

  addModel(text) {
    this.history.push({ role: "model", parts: [{ text }] });
  }

  clear() {
    this.history = [];
    this.summary = "";
    this.userMessageCount = 0;
  }

  get contents() {
    return this.compactContents();
  }

  compactContents() {
    const maxMessages = MAX_HISTORY_TURNS * 2;
    const recent = this.history.slice(-maxMessages);

    if (!this.summary) return [...recent];

    return [
      {
        role: "user",
        parts: [{ text: `[Context summary: ${this.summary}]` }],
      },
      { role: "model", parts: [{ text: "Understood." }] },
      ...recent,
    ];
  }

  needsSummarize() {
    return (
      this.history.length > SUMMARIZE_AFTER_TURNS * 2 &&
      this.history.length > MAX_HISTORY_TURNS * 2
    );
  }

  textForSummary() {
    const older = this.history.slice(0, -MAX_HISTORY_TURNS * 2);
    return older
      .map((item) => {
        const role = item.role === "model" ? "Nova" : "User";
        const text = item.parts?.map((p) => p.text).join("") ?? "";
        return `${role}: ${text}`;
      })
      .join("\n");
  }

  applySummary(summary) {
    if (!summary) return;
    this.summary = this.summary
      ? `${this.summary} ${summary}`.slice(0, 500)
      : summary.slice(0, 500);
    this.history = this.history.slice(-MAX_HISTORY_TURNS * 2);
  }
}
