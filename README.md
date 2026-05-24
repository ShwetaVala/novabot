# Nova Chatbot

Personal AI assistant with a web UI. **Gemini API** (free-tier optimized).

## Project structure

```
├── client/          # Web UI
├── server/          # API + Gemini logic
│   ├── routes/
│   ├── services/
│   └── data/
└── package.json
```

## Setup

1. Install dependencies:

   ```bash
   cd server
   npm install
   ```

2. Create `server/.env` from `.env.example` and add your Gemini key:

   ```env
   GEMINI_API_KEY=your_key_here
   ```

   Get a free key: https://aistudio.google.com/apikey

3. Start (from project root):

   ```bash
   npm start
   ```

4. Open http://localhost:3000

## Free tier limits (default)

| Setting | Default | Purpose |
|---------|---------|---------|
| `NOVA_MAX_SESSION_MESSAGES` | **20** | Max user messages per session |
| `NOVA_MAX_HISTORY_TURNS` | 6 | Recent turns sent to API |
| `GEMINI_MAX_OUTPUT_TOKENS` | 256 | Short, fast replies |
| `GEMINI_MODEL` | `gemini-1.5-flash` | Free-tier Flash model (fallback: `gemini-2.0-flash`) |

**User message limit:** Keep sessions to **15–20 messages**. Use **Clear chat** to reset.

## Error messages

Quota is only shown when Gemini returns `429` + `RESOURCE_EXHAUSTED` + `quota exceeded`.

- Invalid key: *Invalid Gemini API key.*
- Wrong model: *Selected Gemini model is unavailable.*
- Network: *Unable to connect to Gemini servers.*
- Real quota: *Gemini free-tier daily quota reached.*

On API key change, the client is recreated, sessions cleared, and connection retested.

## Notes

- Never commit `server/.env`.
- Responses stream for lower latency.
- Long chats are auto-summarized to save tokens.
