import { useEffect, useRef, useState } from "react";
import type { Op } from "../llm/ops";
import type { AssistantContext } from "../llm/assistantTypes";
import { assistantApiUrl } from "../llm/assistantApi";
import { runAssistant } from "../llm/runAssistant";
import { AssistantProposeForm } from "./AssistantProposeForm";

interface Message {
  role: "user" | "assistant";
  text: string;
}

function welcomeMessage(usingApi: boolean): Message {
  return {
    role: "assistant",
    text: usingApi
      ? "Ask circuit questions, design advice, or multi-step edits — I’ll propose changes for you to confirm. Short commands like “set R1 value 4.7k” also work."
      : "Try “add 10k resistor”, “set R1 value 4.7k”, or “connect R1 to C1”. For complex questions, start the assistant server (see server/README).",
  };
}

/**
 * Assistant panel — simple edits via rules; complex Q&A / multi-step via LLM API.
 * Ops never hit the graph until the user confirms in AssistantProposeForm.
 * Chat history is per schematic tab.
 */
export function ChatPanel({
  activeTabId,
  tabTitle,
  onApplyOps,
  getContext,
}: {
  activeTabId: string;
  /** Shown so it’s clear which circuit this chat belongs to. */
  tabTitle?: string;
  onApplyOps: (ops: Op[]) => number | void;
  getContext: () => AssistantContext;
}) {
  const usingApi = Boolean(assistantApiUrl());
  const [byTab, setByTab] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingOps, setPendingOps] = useState<Op[] | null>(null);
  const [pendingContext, setPendingContext] = useState<AssistantContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const messages = byTab[activeTabId] ?? [welcomeMessage(usingApi)];

  const setMessagesForActive = (updater: (prev: Message[]) => Message[]) => {
    const tabId = activeTabIdRef.current;
    setByTab((all) => {
      const prev = all[tabId] ?? [welcomeMessage(usingApi)];
      return { ...all, [tabId]: updater(prev) };
    });
  };

  // Switching tabs: drop in-flight propose UI (ops are for the other circuit).
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setPendingOps(null);
    setPendingContext(null);
    setInput("");
  }, [activeTabId]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const tabIdAtSend = activeTabId;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setInput("");
    const prior = messages
      .filter((m) => m.text && !m.text.startsWith("Hi —") && !m.text.startsWith("Ask circuit"))
      .slice(-8)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessagesForActive((m) => [...m, { role: "user", text }]);
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
      // Ignore late replies if the user switched tabs mid-request.
      if (activeTabIdRef.current !== tabIdAtSend) return;
      setMessagesForActive((m) => [...m, { role: "assistant", text: reply }]);
      if (ops.length) {
        setPendingOps(ops);
        setPendingContext(ctx);
      }
    } finally {
      if (!ac.signal.aborted && activeTabIdRef.current === tabIdAtSend) {
        setBusy(false);
      }
    }
  }

  function applyPending() {
    if (!pendingOps?.length) return;
    const n = onApplyOps(pendingOps) ?? pendingOps.length;
    setMessagesForActive((m) => [
      ...m,
      {
        role: "assistant",
        text:
          n > 0
            ? `Applied ${n} change(s) to the schematic.`
            : "Nothing applied — no matching parts on this schematic (check refdes like D1/D2).",
      },
    ]);
    setPendingOps(null);
    setPendingContext(null);
  }

  function cancelPending() {
    setPendingOps(null);
    setPendingContext(null);
    setMessagesForActive((m) => [
      ...m,
      { role: "assistant", text: "Cancelled — nothing was changed." },
    ]);
  }

  const label = tabTitle?.trim() || "this tab";

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span>assistant · {label}</span>
        <span
          className="badge"
          title={
            usingApi
              ? "Simple edits: rules · Questions & multi-step: LLM API · History is per tab"
              : "Built-in edit rules only — start server for complex Q&A · History is per tab"
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
