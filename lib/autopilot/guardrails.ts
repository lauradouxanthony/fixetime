/**
 * Garde-fous Autopilot : quiet hours, rate limit, calendar, property, FAQ.
 */

export type QuietHours = { start: string; end: string; timezone?: string };

/** Retourne true si l'heure donnée (dans la timezone) est dans la plage quiet (ex. 20:00–08:00). now optionnel pour tests. */
export function isInQuietHours(quiet: QuietHours, now?: Date): boolean {
  const tz = quiet.timezone ?? "Europe/Paris";
  const date = now ?? new Date();
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const currentMin = hour * 60 + minute;

  const [startH, startM] = (quiet.start || "20:00").split(":").map(Number);
  const [endH, endM] = (quiet.end || "08:00").split(":").map(Number);
  const startMin = (startH ?? 20) * 60 + (startM ?? 0);
  const endMin = (endH ?? 8) * 60 + (endM ?? 0);

  if (startMin > endMin) {
    return currentMin >= startMin || currentMin < endMin;
  }
  return currentMin >= startMin && currentMin < endMin;
}
