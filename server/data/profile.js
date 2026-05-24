import { readFile } from "node:fs/promises";

export async function loadUserProfile() {
  try {
    const raw = await readFile(
      new URL("./user-profile.json", import.meta.url),
      "utf8"
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function profileToContext(profile) {
  if (!profile) return "";

  const lines = [
    "\n\n--- User profile (remember and use this) ---",
    `Daily schedule: wake ${profile.schedule?.wake}, sleep ${profile.schedule?.sleep}`,
    `Priorities: ${profile.priorities?.join(", ") ?? "—"}`,
    `AI focus: ${profile.aiFocus ?? "—"}`,
    `Business: ${profile.business?.name ?? "—"}${profile.business?.openTomorrow === false ? " (closed tomorrow)" : profile.business?.openTomorrow === true ? " (open tomorrow)" : ""}`,
    `Health: ${profile.health?.habits?.join(", ") ?? "—"}`,
  ];

  if (profile.health?.weightLossGoalKg != null) {
    lines.push(
      `Weight loss goal: ${profile.health.weightLossGoalKg} kg total (safe, sustainable pace)`
    );
  }
  if (profile.notes) lines.push(`Notes: ${profile.notes}`);

  return lines.join("\n");
}
