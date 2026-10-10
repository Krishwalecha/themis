import { config } from "../../config";
import { formatDuration } from "../../lib/duration";
import { assertPublicUrl, BlockedAddress } from "../../lib/netguard";

export type AlertKind = "down" | "degraded" | "escalated" | "recovered";

interface AlertPayload {
  kind: AlertKind;
  monitor: { id: string; name: string; url: string };
  incident: { id: string; severity: string; cause: string; startedAt: Date; durationMs?: number };
}

const alertText = (p: AlertPayload): string => {
  const head = `[themis] ${p.monitor.name}`;
  switch (p.kind) {
    case "down":
      return `${head} is DOWN: ${p.incident.cause}`;
    case "degraded":
      return `${head} is DEGRADED: ${p.incident.cause}`;
    case "escalated":
      return `${head} went from degraded to DOWN: ${p.incident.cause}`;
    case "recovered":
      return `${head} recovered after ${formatDuration(p.incident.durationMs ?? 0)}`;
  }
};

const COLORS: Record<AlertKind, number> = { down: 0xef8f84, escalated: 0xef8f84, degraded: 0xe8c07a, recovered: 0x8fd19e };

// Slack and Discord reject anything but their own shape, so they get native messages; any other URL gets the full JSON
export const alertBody = (url: string, p: AlertPayload): Record<string, unknown> => {
  const text = alertText(p);
  const link = `${config.appUrl}/monitors/${p.monitor.id}`;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  if (host === "hooks.slack.com")
    return {
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*<${link}|${p.monitor.name}>*
${text.replace(`[themis] ${p.monitor.name} `, "")}` } },
        { type: "context", elements: [{ type: "mrkdwn", text: `\`${p.monitor.url}\` · started <!date^${Math.floor(new Date(p.incident.startedAt).getTime() / 1000)}^{time}|${new Date(p.incident.startedAt).toISOString()}>` }] },
      ],
    };
  if (/(^|\.)discord(app)?\.com$/.test(host) && new URL(url).pathname.startsWith("/api/webhooks/"))
    return {
      username: "Themis",
      embeds: [
        {
          title: `${p.monitor.name}: ${p.kind === "recovered" ? "recovered" : p.kind === "degraded" ? "degraded" : "down"}`,
          url: link,
          description: p.kind === "recovered" ? text.replace(`[themis] ${p.monitor.name} `, "") : p.incident.cause,
          color: COLORS[p.kind],
          fields: [{ name: "Endpoint", value: `\`${p.monitor.url}\``.slice(0, 1024) }],
          timestamp: new Date(p.incident.startedAt).toISOString(),
        },
      ],
    };
  return { text, content: text, event: p.kind, link, ...p };
};

// Posts an alert to a webhook
export const sendWebhook = async (url: string, payload: AlertPayload): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    // a webhook can't point the server at its own network
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Themis-Alerts/0.2" },
      body: JSON.stringify(alertBody(url, payload)),
      signal: controller.signal,
    });
    return res.ok ? null : `Webhook responded ${res.status}`;
  } catch (e) {
    if (e instanceof BlockedAddress) return e.message;
    return controller.signal.aborted ? "Webhook timed out" : `Webhook failed: ${(e as Error).message}`;
  } finally {
    clearTimeout(timer);
  }
};
