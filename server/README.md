# SimulAI assistant backend (Step 3)

Small **separate** server. The schematic Vite app stays frontend-only; this
process holds the LLM API key later.

## API key (create `server/.env`)

There is **no** `.env` in the repo on purpose — it is gitignored. Create it yourself:

```bash
cd server
copy .env.example .env
```

Edit `.env` and paste your key:

```
GEMINI_API_KEY=your-key-here
```

## Run

```bash
cd server
npm install
npm start
```

Listens on `http://localhost:8787`.

## Point the frontend at it

In the **app root** `.env`:

```
VITE_ASSISTANT_API_URL=http://localhost:8787/api/assistant
```

Restart `npm run dev`. Chat will call this API.

**Unset** that env var to go back to the built-in rule assistant (no server needed).

## API

`POST /api/assistant`

```json
{
  "message": "add a resistor",
  "context": {
    "components": [{ "refdes": "R1", "kind": "R", "params": { "value": "10k" } }],
    "netlist": "* ..."
  }
}
```

Response:

```json
{
  "ops": [{ "type": "addComponent", "kind": "R" }],
  "reply": "Added a resistor.",
  "source": "stub"
}
```

## Plug in a real LLM later

Edit `src/provider.mjs` — replace the stub body with your OpenAI/Claude/etc. call.
Use tool calling whose schema matches the `Op` union (`addComponent` / `setParam` /
`deleteComponent`). Keep returning `{ ops, reply, source: "llm" }`.

Do **not** put API keys in the Vite frontend.
