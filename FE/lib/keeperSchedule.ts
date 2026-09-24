import { after } from 'next/server';

/**
 * Wakes the keeper (app/api/keeper/tick) at the exact moment a duel's work
 * falls due -- a lobby's open window closing, or a live duel's timer ending --
 * instead of waiting up to a minute for the cron. One Google Cloud Task per
 * event, created through the Cloud Tasks REST API with the Cloud Run service
 * account's token from the metadata server (no SDK dependency).
 *
 * Configured by:
 *   KEEPER_TASKS_QUEUE  projects/<project>/locations/<region>/queues/<queue>
 *   KEEPER_TICK_URL     https://<cloud-run-url>/api/keeper/tick
 *   CRON_SECRET         sent as the task's bearer token (lib/adminAuth.ts)
 * Unset (local dev, tests, Vercel): a no-op -- the per-minute cron still
 * picks everything up. Failures are logged, never thrown: a missed task costs
 * at most a minute, never a payout.
 */

/** Slack after the deadline so the chain's block time has passed it too. */
const DEADLINE_SLACK_MS = 5_000;

async function metadataToken(): Promise<string> {
    const res = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' } }
    );
    if (!res.ok) throw new Error(`metadata token: HTTP ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
}

/**
 * Enqueues a keeper tick for `deadline` + slack. `taskId` makes it idempotent
 * (Cloud Tasks rejects a duplicate name with 409, treated as success).
 * Returns whether a task now exists for it.
 */
export async function enqueueKeeperTick(deadline: Date, taskId: string): Promise<boolean> {
    const queue = process.env.KEEPER_TASKS_QUEUE;
    const url = process.env.KEEPER_TICK_URL;
    const secret = process.env.CRON_SECRET;
    if (!queue || !url || !secret) return false;

    const safeId = taskId.replace(/[^A-Za-z0-9_-]/g, '-');
    const res = await fetch(`https://cloudtasks.googleapis.com/v2/${queue}/tasks`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await metadataToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
            task: {
                name: `${queue}/tasks/${safeId}`,
                scheduleTime: new Date(deadline.getTime() + DEADLINE_SLACK_MS).toISOString(),
                httpRequest: {
                    httpMethod: 'POST',
                    url,
                    headers: { authorization: `Bearer ${secret}` },
                },
            },
        }),
    });
    if (res.ok || res.status === 409) return true;
    throw new Error(`Cloud Tasks: HTTP ${res.status} ${await res.text()}`);
}

/** Fire-and-forget from a route handler: the response isn't held up by the enqueue. */
export function scheduleKeeperTick(deadline: Date, taskId: string): void {
    const run = () =>
        enqueueKeeperTick(deadline, taskId).catch((err) =>
            console.error(`[keeperSchedule] ${taskId}: ${(err as Error).message} (the cron will pick it up)`)
        );
    try {
        after(run);
    } catch {
        // No request scope (a script or test): nothing to hang it on; the cron covers it.
    }
}
