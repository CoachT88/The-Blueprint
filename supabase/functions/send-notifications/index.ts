/**
 * Sends the notifications the settings screen promises, and nothing else.
 *
 * Run hourly by pg_cron (see supabase/notifications.sql). Every member whose
 * chosen reminder hour has arrived in their own timezone is considered; almost
 * all of them are then skipped, because they already trained, already got
 * today's message, are on a rest day, or spent a Recovery Pass.
 *
 * All of that judgement lives in _shared/notifyRules.js, which is unit tested.
 * This file is only plumbing: read, decide, send, record.
 *
 * The previous version of this function sent sixteen educational tips a day,
 * ignored the member's chosen time and streak preference entirely, and had no
 * auth on the endpoint.
 *
 * Invoking it requires BOTH credentials, and they go in different headers:
 *
 *   Authorization: Bearer <project JWT>   Supabase's gateway checks this
 *   x-cron-secret: <CRON_SECRET>          this function checks this
 *
 * The gateway credential only satisfies the platform, and the anon key is
 * enough for it. CRON_SECRET is the secret that authenticates the caller.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { decideNotification, localDateFor } from '../_shared/notifyRules.js';
import { authoriseCron } from '../_shared/cronAuth.js';
import { resolveServiceKey } from '../_shared/serviceKey.js';
import { safeErrorBody, dbErrorDetail, pushErrorDetail } from '../_shared/errorResponse.js';

/* Resolved once, at module load. On a project using the newer API key system
   SUPABASE_SERVICE_ROLE_KEY is neither injected nor settable, so reading it
   directly handed createClient undefined: every query went out unauthenticated,
   row level security refused it, and the function reported read_failed. See
   _shared/serviceKey.js.

   The client is built only when a key exists. A client with no key is worse
   than no client, because it fails at the first query and blames the database. */
const serviceKey = resolveServiceKey({
    SUPABASE_SECRET_KEYS: Deno.env.get('SUPABASE_SECRET_KEYS'),
    SUPABASE_SECRET_KEY_NAME: Deno.env.get('SUPABASE_SECRET_KEY_NAME'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
});
for (const note of serviceKey.notes) console.warn('send-notifications: ' + note);
if (serviceKey.key) console.log('send-notifications: backend key from ' + serviceKey.source);

const supabase = serviceKey.key
    ? createClient(Deno.env.get('SUPABASE_URL')!, serviceKey.key)
    : null;

webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
);

/** Subscriptions per round trip. Keeps any single query bounded. */
const PAGE_SIZE = 500;

interface Subscription {
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    reminder_time: string | null;
    streak_warn: boolean | null;
    timezone: string | null;
    last_notified_date: string | null;
}

interface TrainingRow {
    user_id: string;
    session_log?: unknown[];
    pass_protected_dates?: string[];
    schedule?: string[];
}

/**
 * A push service returns 404 or 410 when a subscription is dead: the app was
 * uninstalled, or the browser rotated it. Keeping those rows means retrying a
 * doomed send every hour forever.
 */
function isGone(err: unknown): boolean {
    const code = (err as { statusCode?: number })?.statusCode;
    return code === 404 || code === 410;
}

/**
 * 403 means the push service would not accept our signature: either the
 * subscription was created under a different VAPID key, or this server's key
 * configuration is wrong.
 *
 * Deliberately NOT treated as a dead subscription. The second cause makes every
 * send fail at once, so deleting on 403 would empty the whole table over a
 * single mistyped environment variable. The first cause repairs itself: the
 * client re-subscribes under the current key next time that member opens the
 * app (see _ensureCurrentPushSubscription in index.html). Count it and move on.
 */
function isRejectedSignature(err: unknown): boolean {
    return (err as { statusCode?: number })?.statusCode === 403;
}

/** A column the table may not have yet, same detection the app uses on save. */
function isUnknownColumn(err: { code?: string; message?: string } | null): boolean {
    if (!err) return false;
    return err.code === 'PGRST204' || err.code === '42703'
        || /column .* does not exist|could not find the .* column/i.test(err.message || '');
}

/**
 * Read just enough of each member's row to decide.
 *
 * pass_protected_dates and schedule were both added after the original schema,
 * so a project that has not run every migration would reject the whole select.
 * The app already tolerates that on the way in (see _NEWER_COLUMNS in
 * index.html); this does the same on the way out, and reports honestly when it
 * cannot read at all so the caller can decline to send rather than guess.
 */
async function readTrainingState(ids: string[]): Promise<{ rows: TrainingRow[]; failed: boolean }> {
    const full = await supabase
        .from('user_data')
        .select('user_id, session_log, pass_protected_dates, schedule')
        .in('user_id', ids);
    if (!full.error) return { rows: full.data || [], failed: false };

    if (!isUnknownColumn(full.error)) {
        console.error('send-notifications: reading user_data failed',
            dbErrorDetail(full.error, 'public.user_data'));
        return { rows: [], failed: true };
    }

    // session_log predates everything and is the one field the decision cannot
    // do without. A member simply loses rest-day and Recovery Pass awareness
    // until the migration is run.
    console.warn('user_data is missing newer columns; falling back to session_log only');
    const basic = await supabase.from('user_data').select('user_id, session_log').in('user_id', ids);
    if (basic.error) {
        console.error('send-notifications: fallback user_data read failed',
            dbErrorDetail(basic.error, 'public.user_data'));
        return { rows: [], failed: true };
    }
    return { rows: basic.data || [], failed: false };
}

Deno.serve(async (req) => {
    /* Two gates, and this is the second of them.
     *
     * Supabase's gateway has already checked `Authorization` for a valid
     * project JWT by the time this runs; verify_jwt stays on and that check is
     * not implemented here. What this checks is `x-cron-secret`, which is what
     * actually says the caller is our scheduled job.
     *
     * They used to share the `Authorization` header, which meant the gateway
     * saw CRON_SECRET where it expected a JWT, answered 401, and this function
     * was never reached. See _shared/cronAuth.js.
     */
    const allowed = authoriseCron(req, { CRON_SECRET: Deno.env.get('CRON_SECRET') });
    if (!allowed.ok) {
        if (allowed.status === 503) {
            console.error('send-notifications: refusing to run, ' + allowed.why);
        } else {
            console.warn('send-notifications: refused a caller, ' + allowed.why);
        }
        return new Response(JSON.stringify(safeErrorBody(allowed.why)), {
            status: allowed.status, headers: { 'Content-Type': 'application/json' },
        });
    }

    /* No backend key, no queries. Reported as 503 rather than letting the
       first read fail: a missing credential is a deploy fault, and the old
       read_failed pointed at row level security instead of the environment.
       The shape of what was found is already in the startup log. */
    if (!supabase) {
        console.error('send-notifications: refusing to run, ' + serviceKey.why);
        return new Response(JSON.stringify(safeErrorBody(serviceKey.why)), {
            status: 503, headers: { 'Content-Type': 'application/json' },
        });
    }

    const now = new Date();
    let checked = 0, sent = 0, dropped = 0, rejected = 0;

    try {
        for (let page = 0; ; page++) {
            const { data: subs, error } = await supabase
                .from('push_subscriptions')
                .select('user_id, endpoint, p256dh, auth, reminder_time, streak_warn, timezone, last_notified_date')
                .order('user_id')
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (error) {
                /* Detail to the log, a label to the caller. The Postgres code
                   is what separates the candidate causes, and the log is
                   where the owner can read it. A response body describes the
                   schema to whoever is on the other end of the connection,
                   and "they are authenticated" is weaker than "we never said
                   it". See _shared/errorResponse.js. */
                console.error('send-notifications: reading push_subscriptions failed',
                    dbErrorDetail(error, 'public.push_subscriptions'));
                return new Response(
                    JSON.stringify(safeErrorBody('read_failed', { checked, sent, dropped, rejected })), {
                        status: 500, headers: { 'Content-Type': 'application/json' },
                    });
            }
            if (!subs?.length) break;

            // One read for the whole page, and only the fields the rules need.
            // Session logs are large; nothing here should pull a whole row.
            const ids = (subs as Subscription[]).map(s => s.user_id);
            const { rows, failed } = await readTrainingState(ids);

            // Without this a failed read looks exactly like "nobody has trained
            // today", and everyone on this page gets messaged despite having
            // done the session. Sending nothing is the safe direction.
            if (failed) {
                console.error('Skipping page: could not read training state');
                if (subs.length < PAGE_SIZE) break;
                continue;
            }
            const byUser = new Map<string, TrainingRow>(rows.map(r => [r.user_id, r]));

            for (const sub of subs as Subscription[]) {
                checked++;
                const row = byUser.get(sub.user_id);

                const decision = decideNotification({
                    sessionLog: row?.session_log || [],
                    passProtectedDates: row?.pass_protected_dates || [],
                    schedule: row?.schedule || null,
                    reminderTime: sub.reminder_time || '19:00',
                    streakWarn: sub.streak_warn !== false,
                    timezone: sub.timezone || 'UTC',
                    lastNotifiedDate: sub.last_notified_date,
                    now,
                });
                if (!decision) continue;

                try {
                    await webpush.sendNotification(
                        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                        JSON.stringify({
                            title: decision.title,
                            body: decision.body,
                            tag: decision.tag,
                            url: decision.url,
                        })
                    );
                    sent++;

                    // Stamped with the member's local date, which is what the
                    // one-a-day rule compares against.
                    await supabase
                        .from('push_subscriptions')
                        .update({ last_notified_date: localDateFor(now, sub.timezone || 'UTC') })
                        .eq('user_id', sub.user_id);
                } catch (sendErr) {
                    if (isGone(sendErr)) {
                        await supabase.from('push_subscriptions').delete().eq('user_id', sub.user_id);
                        dropped++;
                    } else if (isRejectedSignature(sendErr)) {
                        // Left in place on purpose; see isRejectedSignature.
                        rejected++;
                    } else {
                        // One member's bad endpoint must not end the run.
                        /* Three fields, not the object: a WebPushError carries `endpoint`
                           and the push service's response body, and an endpoint
                           identifies a member's device. */
                        console.error(`send-notifications: send failed for ${sub.user_id}`,
                            pushErrorDetail(sendErr));
                    }
                }
            }

            if (subs.length < PAGE_SIZE) break;
        }

        // rejected > 0 across the board means this server's VAPID keys are
        // wrong, not that members' subscriptions are stale.
        return new Response(JSON.stringify({ checked, sent, dropped, rejected }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    } catch (e) {
        /* Message only. A thrown object here could carry request detail. */
        console.error('send-notifications: unhandled failure -', (e && e.message) || 'unknown');
        return new Response(JSON.stringify(safeErrorBody('unhandled_failure', { checked, sent, dropped, rejected })), {
            status: 500, headers: { 'Content-Type': 'application/json' },
        });
    }
});
