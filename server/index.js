import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chatRouter from "./routes/chat.js";
import { getConnectionStatus, initNova } from "./services/nova.js";
import { geminiErrorMessage } from "./services/gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3000;

const app = express();
app.use(express.json());

let apiStatus = null;

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, apis: apiStatus, connection: getConnectionStatus() });
});

app.use("/api", chatRouter);

const clientDir = path.join(__dirname, "../client");
app.use(express.static(clientDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

try {
  apiStatus = await initNova();
  app.listen(PORT, () => {
    console.log(`Nova server running at http://localhost:${PORT}`);
    console.log(apiStatus.message);
    console.log(
      `Gemini model: ${apiStatus.model}, max ${apiStatus.maxSessionMessages} msgs/session`
    );
  });
} catch (err) {
  const message = err.kind
    ? geminiErrorMessage(err.kind)
    : err.message ?? "Failed to start Nova.";
  console.error("Failed to start:", message);
  process.exit(1);
}
