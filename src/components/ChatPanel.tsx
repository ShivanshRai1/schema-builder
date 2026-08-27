import { useRef, useState } from "react";
import type { Op } from "../llm/ops";
import type { AssistantContext } from "../llm/assistantTypes";
import { assistantApiUrl } from "../llm/assistantApi";
import { runAssistant } from "../llm/runAssistant";
import { AssistantProposeForm } from "./AssistantProposeForm";
import { DeviceTable } from "./DeviceTable";

interface Message {
  role: "user" | "assistant";
  text: string;
}

/**
 * Assistant panel.
 * Default: rule-based interpret via runAssistant (no env).
 * With VITE_ASSISTANT_API_URL: calls your backend stub / future LLM.
 *
 * Ops never hit the graph until the user confirms in AssistantProposeForm
 * (chat) or clicks Apply on a DeviceTable row.
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
        ? "Hi — ask me to add parts, change values, or connect wires. I'll show a form first. Or edit values in the Devices table."
        : "Hi — try “add 10k resistor”, “set R1 value 4.7k”, “connect R1 to C1”. Confirm in the form, or edit Devices below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingOps, setPendingOps] = useState<Op[] | null>(null);
  const [pendingContext, setPendingContext] = useState<AssistantContext | null>(null);
  const [tableTick, setTableTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const liveContext = getContext();
  void tableTick;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    setPendingOps(null);
    setPendingContext(null);

    try {
      const ctx = getContext();
      const { ops, reply } = await runAssistant(text, ctx, { signal: ac.signal });
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
    setTableTick((t) => t + 1);
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
      </div>

      <DeviceTable
        context={liveContext}
        onApplyOps={(ops) => {
          onApplyOps(ops);
          setTableTick((t) => t + 1);
        }}
      />

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
          placeholder="e.g. add 10k resistor"
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
