import { useState } from "react";
import { interpret, type Op } from "../llm/ops";

interface Message {
  role: "user" | "assistant";
  text: string;
}

// ---------------------------------------------------------------------------
// Assistant panel. Sends the user's message through interpret() (the rule-based
// LLM stand-in), then hands the returned structured ops to the parent to apply
// to the graph. In step 3 interpret() becomes a real model call; this component
// does not change.
// ---------------------------------------------------------------------------

export function ChatPanel({ onApplyOps }: { onApplyOps: (ops: Op[]) => void }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text:
        "I edit the circuit through structured ops. Try “add resistor”, “set R1 value 4.7k”, or “delete C1”. " +
        "The graph stays the source of truth — I never rewrite the netlist directly.",
    },
  ]);
  const [input, setInput] = useState("");

  function send() {
    const text = input.trim();
    if (!text) return;
    const { ops, reply } = interpret(text);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: reply }]);
    if (ops.length) onApplyOps(ops);
    setInput("");
  }

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span>assistant</span>
        <span className="badge">structured ops → graph</span>
      </div>
      <div className="chat-log">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">{m.text}</div>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          placeholder="e.g. add resistor"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="chat-send" onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
