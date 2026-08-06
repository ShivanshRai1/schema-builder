/**
 * SimulAI Schematic — Assistant API (Step 3)
 *
 * Separate backend. Frontend calls POST /api/assistant when
 * VITE_ASSISTANT_API_URL is set.
 */

import "./loadEnv.mjs";
import cors from "cors";
import express from "express";
import { handleAssistant, providerStatus } from "./provider.mjs";
import { interpretFallback, normalizeOps } from "./fallback.mjs";
import { validateOpsPayload } from "./validate.mjs";

const PORT = Number(process.env.PORT) || 8787;
const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "simulai-assistant", llm: providerStatus() });
});

/**
 * POST /api/assistant
 * body: { message: string, context: { components, netlist } }
 * returns: { ops: Op[], reply: string, source: string }
 */
app.post("/api/assistant", async (req, res) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    const context = req.body?.context ?? { components: [], netlist: "" };

    if (!message) {
      res.status(400).json({ ops: [], reply: "Empty message.", source: "stub" });
      return;
    }

    const raw = await handleAssistant(message, context);
    let ops = validateOpsPayload(normalizeOps(raw.ops));
    let reply = String(raw.reply ?? "Done.");
    let source = raw.source ?? "stub";

    // Models often claim success with empty/invalid ops — recover with local parse.
    if (ops.length === 0) {
      const fb = interpretFallback(message);
      if (fb) {
        ops = validateOpsPayload(normalizeOps(fb.ops));
        if (ops.length) {
          reply = fb.reply;
          source = source === "llm" ? "llm+rules" : "rules";
        }
      }
    }

    res.json({ ops, reply, source });
  } catch (e) {
    const err = e instanceof Error ? e.message : "server error";
    res.status(500).json({ ops: [], reply: `Server error: ${err}`, source: "stub" });
  }
});

app.listen(PORT, () => {
  console.log(`[assistant] http://localhost:${PORT}`);
  console.log(`[assistant] POST /api/assistant  (provider: ${providerStatus()})`);
});
