/** Shared low-traffic ops alert: logs, and posts to ALERT_WEBHOOK_URL if set (Slack/etc. incoming webhook). Never throws. */
export async function postAlert(text: string): Promise<void> {
    console.error(text);
    const webhook = process.env.ALERT_WEBHOOK_URL;
    if (!webhook) return;
    await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
    }).catch((err) => console.error(`[alerts] webhook failed: ${(err as Error).message}`));
}
