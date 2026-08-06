import { useRef, useState } from "react";
import type { Op } from "../llm/ops";
import type { AssistantContext } from "../llm/assistantTypes";
import { assistantApiUrl } from "../llm/assistantApi";
import { runAssistant } from "../llm/runAssistant";

interface Message {
  role: "user" | "assistant";
  text: string;
}

/**
 * Assistant panel.
 * Default: rule-based interpret via runAssistant (no env).
 * With VITE_ASSISTANT_API_URL: calls your backend stub / future LLM.
 * applyOps path unchanged.
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
        ? "Hi — ask me to add parts, change values, connect wires, or remove components."
        : "Hi — try “add resistor”, “set R1 value 4.7k”, “connect R1 to C1”, or “disconnect R1”.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);

    try {
      const { ops, reply } = await runAssistant(text, getContext(), { signal: ac.signal });
      if (ac.signal.aborted) return;
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      if (ops.length) onApplyOps(ops);
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span>assistant</span>
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
      <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          disabled={busy}
          placeholder="e.g. add resistor"
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
