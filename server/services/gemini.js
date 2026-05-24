import { GoogleGenAI } from "@google/genai";
import { isValidApiKey, sleep, withTimeout } from "./env.js";

const API_TIMEOUT_MS = Number(process.env.NOVA_API_TIMEOUT_MS ?? 25_000);
const VALIDATE_TIMEOUT_MS = Number(process.env.NOVA_VALIDATE_TIMEOUT_MS ?? 15_000);
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 256);

const FREE_TIER_MODELS = ["gemini-1.5-flash", "gemini-2.0-flash"];

export function loadGeminiKey() {
  const raw = process.env.GEMINI_API_KEY?.trim();
  if (!raw) return null;
  return isValidApiKey(raw) ? raw : null;
}

export function loadGeminiModels() {
  const primary =
    process.env.GEMINI_MODEL?.trim() || process.env.NOVA_MODEL?.trim();
  if (primary) return [primary, ...FREE_TIER_MODELS.filter((m) => m !== primary)];

  return [...FREE_TIER_MODELS];
}

export function parseGeminiError(err) {
  const status = err?.status ?? err?.statusCode ?? null;
  const name = err?.name ?? "";
  let nested = err?.error ?? {};

  if (!nested?.status && !nested?.code && typeof err?.message === "string") {
    try {
      const parsed = JSON.parse(err.message);
      if (parsed?.error) nested = parsed.error;
    } catch {
      // message is plain text, not JSON
    }
  }

  const apiStatus =
    nested?.status ?? nested?.error?.status ?? err?.statusText ?? "";
  const code = nested?.code ?? nested?.error?.code ?? "";
  const message = String(
    nested?.message ?? nested?.error?.message ?? err?.message ?? ""
  );
  const details = nested?.details ?? nested?.error?.details ?? [];
  const detailsText = JSON.stringify(details);
  const fullText = `${name} ${apiStatus} ${code} ${message} ${detailsText}`.toLowerCase();

  return { status, name, apiStatus, code, message, detailsText, fullText, raw: err };
}

/** Quota ONLY when API returns 429 + RESOURCE_EXHAUSTED + explicit quota exceeded text. */
export function isQuotaExceededSignal(details) {
  const has429 = details.status === 429 || details.code === 429;
  const hasResourceExhausted = details.apiStatus === "RESOURCE_EXHAUSTED";
  const hasQuotaText = /quota exceeded|exceeded your current quota/i.test(
    `${details.message} ${details.detailsText}`
  );

  return has429 && hasResourceExhausted && hasQuotaText;
}

function isInvalidKeySignal(details) {
  if (isQuotaExceededSignal(details)) return false;

  return (
    details.status === 401 ||
    details.name === "AuthenticationError" ||
    details.apiStatus === "UNAUTHENTICATED" ||
    (details.status === 403 &&
      /api.?key|invalid.*key|permission denied|unregistered caller|api key not valid/i.test(
        details.fullText
      ))
  );
}

function isInvalidModelSignal(details) {
  return (
    details.status === 404 ||
    details.name === "NotFoundError" ||
    /model.*(not found|not supported|invalid|does not exist|unavailable)|unknown model/i.test(
      details.fullText
    )
  );
}

function isNetworkSignal(details) {
  return (
    details.name === "APIConnectionError" ||
    details.name === "APIConnectionTimeoutError" ||
    /timed out after|fetch failed|network|econnreset|enotfound|socket hang up|unable to connect/i.test(
      details.fullText
    )
  );
}

function isServerBusySignal(details) {
  if (isQuotaExceededSignal(details)) return false;

  return (
    details.status === 503 ||
    details.status >= 500 ||
    details.name === "InternalServerError" ||
    details.apiStatus === "UNAVAILABLE" ||
    ((details.status === 429 || details.name === "RateLimitError") &&
      !isQuotaExceededSignal(details))
  );
}

export function classifyGeminiError(err) {
  const details = parseGeminiError(err);

  if (isNetworkSignal(details)) return "network";
  if (isInvalidKeySignal(details)) return "invalid_key";
  if (isInvalidModelSignal(details)) return "invalid_model";
  if (isQuotaExceededSignal(details)) return "quota";
  if (isServerBusySignal(details)) return "server_busy";
  if (details.status === 400 || details.name === "BadRequestError") {
    return "request_error";
  }

  return "unknown";
}

export function geminiErrorMessage(kind) {
  switch (kind) {
    case "invalid_key":
      return "Invalid Gemini API key.";
    case "invalid_model":
      return "Selected Gemini model is unavailable.";
    case "network":
      return "Unable to connect to Gemini servers.";
    case "quota":
      return "Gemini free-tier daily quota reached.";
    case "server_busy":
      return "Gemini servers are currently busy. Please try again shortly.";
    default:
      return "Unable to connect to Gemini servers.";
  }
}

export const CONNECTED_MESSAGE =
  "Connected successfully. Chatbot is ready.";

function shouldRetry(kind) {
  return kind === "server_busy" || kind === "network" || kind === "unknown";
}

export async function withOneRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const kind = classifyGeminiError(err);
    if (!shouldRetry(kind)) throw err;
    await sleep(700);
    return await fn();
  }
}

export class GeminiClient {
  constructor(apiKey, { models, systemInstruction }) {
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({ apiKey });
    this.models = models;
    this.systemInstruction = systemInstruction;
    this.modelIndex = 0;
  }

  get activeModel() {
    return this.models[this.modelIndex];
  }

  resetModelIndex() {
    this.modelIndex = 0;
  }

  rotateModel() {
    if (this.modelIndex < this.models.length - 1) {
      this.modelIndex++;
      return true;
    }
    return false;
  }

  buildConfig() {
    return {
      systemInstruction: this.systemInstruction,
      temperature: 0.7,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    };
  }

  async runValidationRequest(model) {
    return withOneRetry(() =>
      withTimeout(
        this.ai.models.generateContent({
          model,
          contents: "hi",
          config: { maxOutputTokens: 8, temperature: 0 },
        }),
        VALIDATE_TIMEOUT_MS,
        "Gemini validation"
      )
    );
  }

  async validateConnection() {
    this.resetModelIndex();
    let lastError;

    while (this.modelIndex < this.models.length) {
      const model = this.activeModel;

      try {
        await this.runValidationRequest(model);
        return { ok: true, message: CONNECTED_MESSAGE, model };
      } catch (err) {
        lastError = err;
        const kind = classifyGeminiError(err);

        if (kind === "invalid_model" && this.rotateModel()) {
          console.log(`Gemini startup: model unavailable, trying → ${this.activeModel}`);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  async generate(contents) {
    this.resetModelIndex();
    let lastError;

    while (this.modelIndex < this.models.length) {
      const model = this.activeModel;

      try {
        const response = await withOneRetry(() =>
          withTimeout(
            this.ai.models.generateContent({
              model,
              contents,
              config: this.buildConfig(),
            }),
            API_TIMEOUT_MS,
            "Gemini"
          )
        );

        return { text: response.text ?? "", model };
      } catch (err) {
        lastError = err;
        const kind = classifyGeminiError(err);

        if (kind === "invalid_model" && this.rotateModel()) {
          console.log(`Gemini: model unavailable, trying → ${this.activeModel}`);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  async *generateStream(contents) {
    this.resetModelIndex();
    let lastError;

    while (this.modelIndex < this.models.length) {
      const model = this.activeModel;

      try {
        const stream = await withOneRetry(() =>
          withTimeout(
            this.ai.models.generateContentStream({
              model,
              contents,
              config: this.buildConfig(),
            }),
            API_TIMEOUT_MS,
            "Gemini"
          )
        );

        for await (const chunk of stream) {
          if (chunk.text) yield chunk.text;
        }

        return;
      } catch (err) {
        lastError = err;
        const kind = classifyGeminiError(err);

        if (kind === "invalid_model" && this.rotateModel()) {
          console.log(`Gemini: model unavailable, trying → ${this.activeModel}`);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  async summarize(text) {
    const model = this.models[0];

    const response = await withOneRetry(() =>
      withTimeout(
        this.ai.models.generateContent({
          model,
          contents: `Summarize this chat in 2-3 short sentences. Keep names, goals, and pending tasks only:\n\n${text}`,
          config: {
            temperature: 0.3,
            maxOutputTokens: 120,
          },
        }),
        API_TIMEOUT_MS,
        "Gemini"
      )
    );

    return response.text?.trim() ?? "";
  }
}

export async function createValidatedGeminiClient({ models, systemInstruction }) {
  const apiKey = loadGeminiKey();
  if (!apiKey) {
    const err = new Error(geminiErrorMessage("invalid_key"));
    err.kind = "invalid_key";
    throw err;
  }

  const client = new GeminiClient(apiKey, { models, systemInstruction });
  const validation = await client.validateConnection();

  return { client, ...validation };
}

export function toGeminiError(err) {
  const kind = err?.kind ?? classifyGeminiError(err);
  const error = new Error(geminiErrorMessage(kind));
  error.kind = kind;
  error.cause = err;
  return error;
}
