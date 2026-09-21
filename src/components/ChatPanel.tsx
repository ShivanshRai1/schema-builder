import { useRef, useState } from "react";
import type { Op } from "../llm/ops";
import type { AssistantContext } from "../llm/assistantTypes";
import { assistantApiUrl } from "../llm/assistantApi";
import { runAssistant } from "../llm/runAssistant";
import { AssistantProposeForm } from "./AssistantProposeForm";

interface Message {
  role: "user" | "assistant";
  text: string;
}

/**
 * Assistant panel — simple edits via rules; complex Q&A / multi-step via LLM API.
 * Ops never hit the graph until the user confirms in AssistantProposeForm.
 */
export function ChatPanel({
  onApplyOps,
  getContext,
}: {
  onApplyOps: (ops: Op[]) => void;
  getContext: () => AssistantContext;
}) {
  const usingApi = Boolean(assistantApiUrl());
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: usingApi
        ? "Ask circuit questions, design advice, or multi-step edits — I’ll propose changes for you to confirm. Short commands like “set R1 value 4.7k” also work."
        : "Try “add 10k resistor”, “set R1 value 4.7k”, or “connect R1 to C1”. For complex questions, start the assistant server (see server/README).",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingOps, setPendingOps] = useState<Op[] | null>(null);
  const [pendingContext, setPendingContext] = useState<AssistantContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setInput("");
    const prior = messages
      .filter((m) => m.text && !m.text.startsWith("Hi —") && !m.text.startsWith("Ask circuit"))
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    setPendingOps(null);
    setPendingContext(null);

    try {
      const ctx = getContext();
      const { ops, reply } = await runAssistant(text, ctx, {
        signal: ac.signal,
        history: prior,
      });
      if (ac.signal.aborted) return;
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      if (ops.length) {
        setPendingOps(ops);
        setPendingContext(ctx);
      }
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }

  function applyPending() {
    if (!pendingOps?.length) return;
    onApplyOps(pendingOps);
    setMessages((m) => [
      ...m,
      { role: "assistant", text: `Applied ${pendingOps.length} change(s) to the schematic.` },
    ]);
    setPendingOps(null);
    setPendingContext(null);
  }

  function cancelPending() {
    setPendingOps(null);
    setPendingContext(null);
    setMessages((m) => [
      ...m,
      { role: "assistant", text: "Cancelled — nothing was changed." },
    ]);
  }

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span>assistant</span>
        <span
          className="badge"
          title={
            usingApi
              ? "Simple edits: rules · Questions & multi-step: LLM API"
              : "Built-in edit rules only — start server for complex Q&A"
          }
        >
          {usingApi ? "rules + LLM" : "rules"}
        </span>
      </div>

      <div className="chat-log">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">{m.text}</div>
          </div>
        ))}
        {busy && (
          <div className="chat-msg assistant">
            <div className="chat-bubble">Thinking…</div>
          </div>
        )}
      </div>

      {pendingOps && pendingContext && (
        <AssistantProposeForm
          ops={pendingOps}
          context={pendingContext}
          onChange={setPendingOps}
          onApply={applyPending}
          onCancel={cancelPending}
        />
      )}

      <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          disabled={busy}
          placeholder='e.g. Why is Vout ringing?  or  add 10k resistor'
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send()}
        />
        <button className="chat-send" disabled={busy} onClick={() => void send()}>
          Send
        </button>
      </div>
    </div>
  );
}
