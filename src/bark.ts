import type { Env } from "./types";

export async function sendBark(
  env: Env,
  title: string,
  body: string,
  dedupeKey: string,
  level: "active" | "timeSensitive" = "active"
): Promise<void> {
  if (!env.BARK_DEVICE_KEY) throw new Error("Missing BARK_DEVICE_KEY secret");
  const exists = await env.DB.prepare(
    "SELECT id FROM alert_log WHERE dedupe_key = ?"
  ).bind(dedupeKey).first();
  if (exists) return;

  const base = (env.BARK_BASE_URL || "https://api.day.app").replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(env.BARK_DEVICE_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title, body, group: "A股ETF反弹监控",
      level, sound: "telegraph", isArchive: 1
    })
  });
  if (!response.ok) throw new Error(`Bark HTTP ${response.status}`);
  await env.DB.prepare(
    "INSERT INTO alert_log (dedupe_key, symbol, alert_type, trade_date) VALUES (?, ?, ?, ?)"
  ).bind(dedupeKey, dedupeKey.split("|")[0], dedupeKey.split("|")[1], dedupeKey.split("|")[2]).run();
}
