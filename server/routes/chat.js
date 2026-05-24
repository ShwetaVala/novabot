import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  askNova,
  askNovaStream,
  clearSession,
  formatApiError,
} from "../services/nova.js";

const router = Router();

router.post("/chat", async (req, res) => {
  const message = req.body?.message?.trim();
  let sessionId = req.body?.sessionId;
  const stream = req.body?.stream === true;

  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  if (!sessionId) sessionId = randomUUID();

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      const result = await askNovaStream(sessionId, message, (chunk) => {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });

      res.write(
        `data: ${JSON.stringify({
          done: true,
          sessionId,
          provider: result.provider,
          limited: result.limited ?? false,
        })}\n\n`
      );
      res.end();
    } catch (err) {
      res.write(
        `data: ${JSON.stringify({ error: formatApiError(err), sessionId })}\n\n`
      );
      res.end();
    }
    return;
  }

  try {
    const { text, provider, limited } = await askNova(sessionId, message);
    res.json({ reply: text, sessionId, provider, limited: limited ?? false });
  } catch (err) {
    res.status(503).json({
      error: formatApiError(err),
      sessionId,
    });
  }
});

router.post("/clear", (req, res) => {
  const sessionId = req.body?.sessionId;
  if (sessionId) clearSession(sessionId);
  res.json({ ok: true });
});

export default router;
