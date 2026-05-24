import {
  FREE_TIER_SESSION_HINT,
  NOVA_SYSTEM_INSTRUCTION,
} from "../data/nova-prompt.js";
import { loadUserProfile, profileToContext } from "../data/profile.js";
import { loadEnvFile, reloadEnvFile } from "./env.js";
import {
  classifyGeminiError,
  createValidatedGeminiClient,
  geminiErrorMessage,
  loadGeminiKey,
  loadGeminiModels,
  toGeminiError,
} from "./gemini.js";
import { Conversation } from "./conversation.js";

const sessions = new Map();
const MAX_SESSION_MESSAGES = Number(process.env.NOVA_MAX_SESSION_MESSAGES ?? 20);

let geminiClient = null;
let activeApiKey = null;
let systemInstruction = "";
let connectionStatus = { ok: false, message: "", model: null };

async function buildSystemInstruction() {
  const profile = await loadUserProfile();
  return NOVA_SYSTEM_INSTRUCTION + profileToContext(profile);
}

function resetGeminiState() {
  geminiClient = null;
  activeApiKey = null;
  connectionStatus = { ok: false, message: "", model: null };
  sessions.clear();
}

async function initGeminiClient() {
  const geminiKey = loadGeminiKey();
  if (!geminiKey) {
    throw toGeminiError({ kind: "invalid_key" });
  }

  if (!systemInstruction) {
    systemInstruction = await buildSystemInstruction();
  }

  resetGeminiState();

  try {
    const { client, message, model } = await createValidatedGeminiClient({
      models: loadGeminiModels(),
      systemInstruction,
    });

    geminiClient = client;
    activeApiKey = geminiKey;
    connectionStatus = { ok: true, message, model };
    return connectionStatus;
  } catch (err) {
    resetGeminiState();
    throw toGeminiError(err);
  }
}

async function ensureGeminiReady() {
  await reloadEnvFile();
  const geminiKey = loadGeminiKey();

  if (!geminiKey) {
    throw toGeminiError({ kind: "invalid_key" });
  }

  if (geminiKey !== activeApiKey || !geminiClient || !connectionStatus.ok) {
    console.log("Gemini: API key changed or client missing — revalidating…");
    return initGeminiClient();
  }

  return connectionStatus;
}

export async function initNova() {
  await loadEnvFile();
  systemInstruction = await buildSystemInstruction();
  const status = await initGeminiClient();

  return {
    provider: "gemini",
    model: status.model ?? geminiClient?.activeModel,
    freeTier: true,
    maxSessionMessages: MAX_SESSION_MESSAGES,
    connected: status.ok,
    message: status.message,
  };
}

export function getConnectionStatus() {
  return connectionStatus;
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Conversation());
  }
  return sessions.get(sessionId);
}

export function clearSession(sessionId) {
  sessions.delete(sessionId);
}

export function formatApiError(err) {
  if (err?.kind) return geminiErrorMessage(err.kind);
  return geminiErrorMessage(classifyGeminiError(err));
}

function sessionLimitReply(conversation) {
  conversation.addModel(FREE_TIER_SESSION_HINT);
  return {
    text: FREE_TIER_SESSION_HINT,
    provider: "gemini",
    limited: true,
  };
}

async function maybeSummarize(conversation) {
  if (!conversation.needsSummarize()) return;

  try {
    const summary = await geminiClient.summarize(conversation.textForSummary());
    conversation.applySummary(summary);
  } catch (err) {
    console.warn("Summary skipped:", err.message ?? err);
    conversation.history = conversation.history.slice(
      -Number(process.env.NOVA_MAX_HISTORY_TURNS ?? 6) * 2
    );
  }
}

export async function askNova(sessionId, userMessage) {
  await ensureGeminiReady();

  const conversation = getSession(sessionId);
  conversation.addUser(userMessage);

  if (conversation.userMessageCount > MAX_SESSION_MESSAGES) {
    return sessionLimitReply(conversation);
  }

  await maybeSummarize(conversation);

  try {
    const { text } = await geminiClient.generate(conversation.contents);
    conversation.addModel(text || " ");
    return { text, provider: "gemini" };
  } catch (err) {
    conversation.history.pop();
    console.error("Gemini error:", parseLogError(err));
    throw toGeminiError(err);
  }
}

export async function askNovaStream(sessionId, userMessage, onChunk) {
  await ensureGeminiReady();

  const conversation = getSession(sessionId);
  conversation.addUser(userMessage);

  if (conversation.userMessageCount > MAX_SESSION_MESSAGES) {
    const reply = FREE_TIER_SESSION_HINT;
    onChunk(reply);
    conversation.addModel(reply);
    return { text: reply, provider: "gemini", limited: true };
  }

  await maybeSummarize(conversation);

  let fullText = "";

  try {
    for await (const chunk of geminiClient.generateStream(conversation.contents)) {
      fullText += chunk;
      onChunk(chunk);
    }

    conversation.addModel(fullText || " ");
    return { text: fullText, provider: "gemini" };
  } catch (err) {
    conversation.history.pop();
    console.error("Gemini error:", parseLogError(err));
    throw toGeminiError(err);
  }
}

function parseLogError(err) {
  const kind = classifyGeminiError(err);
  const message = err?.message ?? String(err);
  return `[${kind}] ${message}`;
}
