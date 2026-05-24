import { readFile } from "node:fs/promises";

const PLACEHOLDER_PATTERN =
  /your_.*key|placeholder|xxxx|example|changeme/i;

export function isValidApiKey(value) {
  const key = value?.trim();
  if (!key || key.length < 20) return false;
  if (PLACEHOLDER_PATTERN.test(key)) return false;
  return true;
}

export async function loadEnvFile({ force = false } = {}) {
  try {
    const text = await readFile(new URL("../.env", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (force || !process.env[key]) process.env[key] = value;
    }
    return true;
  } catch {
    return false;
  }
}

/** Reload .env from disk so API key changes take effect without restart. */
export async function reloadEnvFile() {
  return loadEnvFile({ force: true });
}

export function withTimeout(promise, ms, label = "Request") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms
      );
    }),
  ]);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
