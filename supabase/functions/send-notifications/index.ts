// The Blueprint — Push Notification Sender
// Deploy: supabase functions deploy send-notifications
// Cron:   runs every hour via Supabase cron trigger
//
// Required secrets (set via: supabase secrets set KEY=value):
//   VAPID_PUBLIC_KEY   — the public key from vapid key generation
//   VAPID_PRIVATE_KEY  — the private key from vapid key generation
//   VAPID_SUBJECT      — mailto:your@email.com
//   SUPABASE_URL       — your project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key (not anon)

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
);

// ─── Notification copy ────────────────────────────────────────────────────
// Indexed 0-6 (Sun–Sat) so messages rotate through the week without repeating.

const TRAINING_REMINDERS = [
    { title: 'Time to train.', body: '10-min warmup → protocol → done. Open The Blueprint.' },
    { title: 'Your tissue is ready.', body: 'Nothing left but the work. Open the app and get it done.' },
    { title: 'Consistency is the protocol.', body: 'One session today keeps the adaptation cycle running.' },
    { title: 'Get the session in.', body: 'Warm up, execute, recover. That is the whole job.' },
    { title: 'Progress is made tonight.', body: 'Collagen remodels 48–72 h after the stimulus. Give it one.' },
    { title: 'Open The Blueprint.', body: 'Start the warmup. The rest follows.' },
    { title: 'One session. That is it.', body: 'Warmup, work, done. Your future self does not skip.' },
];

const STREAK_REMINDERS = [
    (streak: number) => ({ title: `Day ${streak + 1}. Keep it moving.`, body: 'Warm up, hit the protocol, log it. Streak stays alive.' }),
    (streak: number) => ({ title: `${streak}-day streak on the line.`, body: 'One session keeps the chain unbroken. Open the app.' }),
    (streak: number) => ({ title: `Day ${streak + 1}.`, body: 'Consistent reps compound. Do not let today be the gap.' }),
    (streak: number) => ({ title: `${streak} days straight.`, body: 'Warmup → protocol → done. That is the whole move.' }),
    (streak: number) => ({ title: `Streak alive: ${streak} days.`, body: 'Tissue adapts in recovery. Give it the stimulus first.' }),
    (streak: number) => ({ title: `Day ${streak + 1}. You know the drill.`, body: '10 minutes of warmup and the work is half done.' }),
    (streak: number) => ({ title: `${streak} days in.`, body: 'This is where most guys stop. You are not most guys.' }),
];

const RECOVERY_REMINDERS = [
    { title: 'Recovery day.', body: 'Hip flexors + RK holds. 5 minutes locks in the gains.' },
    { title: 'Active recovery today.', body: 'Pelvic floor release + box breathing. 5 min. Do it.' },
    { title: 'Rest day protocol.', body: 'Reverse kegels + hip openers. Recovery work compounds.' },
    { title: '5-min recovery session.', body: 'Stretch, breathe, release. Your tissue rebuilds tonight.' },
    { title: 'Recovery is the work.', body: 'Drop into pelvic floor release + RK holds. 5 minutes.' },
    { title: 'Open The Blueprint.', body: 'Recovery Protocol today — pelvic stretches + RK holds.' },
    { title: 'Rest day. Do the work.', body: 'Hip openers + reverse kegels keep the floor supple.' },
];

function pickByDayOfWeek<T>(arr: T[], dayIndex: number): T {
    return arr[dayIndex % arr.length];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getUserLocalDayOfWeek(now: Date, timezone: string): number {
    try {
        const localStr = now.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' });
        const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return days[localStr.slice(0, 3)] ?? now.getUTCDay();
    } catch {
        return now.getUTCDay();
    }
}

function getUserLocalDateISO(now: Date, timezone: string): string {
    try {
        // Build YYYY-MM-DD in user's local timezone
        const parts = now.toLocaleDateString('en-CA', { timeZone: timezone }); // en-CA gives YYYY-MM-DD
        return parts;
    } catch {
        return now.toISOString().split('T')[0];
    }
}

Deno.serve(async () => {
    try {
        const now = new Date();
        const currentHour = now.getUTCHours();

        // Fetch active push subscriptions (bounded to prevent memory issues at scale)
        const { data: subs, error } = await supabase
            .from('push_subscriptions')
            .select('*')
            .limit(1000);

        if (error || !subs?.length) {
            return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
        }

        let sent = 0;

        for (const sub of subs) {
            try {
                const timezone = sub.timezone || 'UTC';
                const reminderTime = sub.reminder_time || '19:00';
                const [rh] = reminderTime.split(':').map(Number);

                // Convert reminder local hour → UTC hour
                const userDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
                const utcDate  = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
                const offsetHours = Math.round((userDate.getTime() - utcDate.getTime()) / 3600000);
                const reminderUTCHour = ((rh - offsetHours) + 24) % 24;

                // Only fire in the exact matching UTC hour (cron is hourly — this fires once)
                if (currentHour !== reminderUTCHour) continue;

                // Fetch user data
                const { data: userData } = await supabase
                    .from('user_data')
                    .select('session_log, schedule')
                    .eq('id', sub.user_id)
                    .single();

                if (!userData) continue;

                const sessionLog: Array<{ date: string }> = userData.session_log || [];
                const schedule: string[] = userData.schedule || [];

                // Use user's local date so "today" matches their clock, not UTC
                const localToday = getUserLocalDateISO(now, timezone);
                const trainedToday = sessionLog.some(s => s.date?.startsWith(localToday));

                // Determine today's schedule type (0=Sun … 6=Sat in user's local time)
                const localDayOfWeek = getUserLocalDayOfWeek(now, timezone);
                const todayType: string = schedule[localDayOfWeek] || 'rest';
                const isRestDay = todayType === 'rest';

                // Calculate streak — O(N sessions) by walking unique dates backward
                let streak = 0;
                const sessionDays = new Set(sessionLog.map((s: { date: string }) =>
                    getUserLocalDateISO(new Date(s.date), timezone)
                ));
                // Walk backward from today; allow today to be empty (streak from yesterday still alive)
                const cursor = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
                cursor.setHours(12, 0, 0, 0);
                for (let i = 0; i < 366; i++) {
                    const key = getUserLocalDateISO(cursor, timezone);
                    if (sessionDays.has(key)) { streak++; }
                    else if (i > 0) { break; } // allow today to not have a session yet
                    cursor.setDate(cursor.getDate() - 1);
                }

                let notification = null;

                // 1. Streak warning at a fixed 8 PM local if they haven't trained
                if (sub.streak_warn && streak >= 3 && !trainedToday) {
                    const streakUTCHour = ((20 - offsetHours) + 24) % 24;
                    if (currentHour === streakUTCHour) {
                        notification = {
                            title: `🔥 Streak at risk — ${streak} days`,
                            body: "You haven't trained today. Don't break the chain.",
                            tag: 'streak-warning',
                            renotify: true,
                        };
                    }
                }

                // 2. Daily reminder — send regardless of rest/training day;
                //    skip only if they already completed any session today.
                if (!notification && !trainedToday) {
                    if (isRestDay) {
                        const base = pickByDayOfWeek(RECOVERY_REMINDERS, localDayOfWeek);
                        notification = { ...base, tag: 'daily-reminder' };
                    } else if (streak > 0) {
                        const fn = pickByDayOfWeek(STREAK_REMINDERS, localDayOfWeek);
                        notification = { ...fn(streak), tag: 'daily-reminder' };
                    } else {
                        const base = pickByDayOfWeek(TRAINING_REMINDERS, localDayOfWeek);
                        notification = { ...base, tag: 'daily-reminder' };
                    }
                }

                if (!notification) continue;

                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    JSON.stringify(notification)
                );
                sent++;
            } catch (subErr) {
                // Subscription expired — remove it
                if ((subErr as { statusCode?: number }).statusCode === 410) {
                    await supabase.from('push_subscriptions').delete().eq('user_id', sub.user_id);
                }
                console.error(`Failed for ${sub.user_id}:`, subErr);
            }
        }

        return new Response(JSON.stringify({ sent }), { status: 200 });
    } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
    }
});
