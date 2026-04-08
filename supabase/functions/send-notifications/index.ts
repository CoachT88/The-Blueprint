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

Deno.serve(async () => {
    try {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const currentMinute = now.getUTCMinutes();
        const todayISO = now.toISOString().split('T')[0];

        // Fetch all active push subscriptions
        const { data: subs, error } = await supabase
            .from('push_subscriptions')
            .select('*');

        if (error || !subs?.length) {
            return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
        }

        let sent = 0;

        for (const sub of subs) {
            try {
                // Convert stored reminder time to UTC hour using timezone
                const reminderTime = sub.reminder_time || '19:00';
                const [rh, rm] = reminderTime.split(':').map(Number);

                // Get UTC offset for user's timezone
                const userDate = new Date(now.toLocaleString('en-US', { timeZone: sub.timezone || 'UTC' }));
                const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
                const offsetHours = Math.round((userDate.getTime() - utcDate.getTime()) / 3600000);
                const reminderUTCHour = ((rh - offsetHours) + 24) % 24;

                // Only send if current UTC hour matches the reminder hour (±window of 1 hour)
                if (Math.abs(currentHour - reminderUTCHour) > 1) continue;

                // Fetch user's session log to check if they trained today
                const { data: userData } = await supabase
                    .from('user_data')
                    .select('session_log, total_xp')
                    .eq('id', sub.user_id)
                    .single();

                if (!userData) continue;

                const sessionLog: Array<{ date: string }> = userData.session_log || [];
                const trainedToday = sessionLog.some(s => s.date?.startsWith(todayISO));

                // Calculate current streak
                let streak = 0;
                const days = new Set(sessionLog.map((s: { date: string }) => s.date?.split('T')[0]));
                for (let i = 0; i < 365; i++) {
                    const d = new Date(now);
                    d.setDate(d.getDate() - i);
                    const key = d.toISOString().split('T')[0];
                    if (days.has(key)) { streak++; }
                    else if (i > 0) { break; }
                }

                let notification = null;

                // Streak warning — send at 20:00 local if they have a streak and haven't trained
                if (sub.streak_warn && streak >= 3 && !trainedToday) {
                    const streakUTCHour = ((20 - offsetHours) + 24) % 24;
                    if (Math.abs(currentHour - streakUTCHour) <= 1) {
                        notification = {
                            title: `🔥 Streak at risk — ${streak} days`,
                            body: "You haven't trained today. Don't break the streak.",
                            tag: 'streak-warning',
                            renotify: true,
                        };
                    }
                }

                // Daily reminder — if not trained and matches reminder time
                if (!notification && !trainedToday && Math.abs(currentHour - reminderUTCHour) <= 1) {
                    notification = {
                        title: 'The Blueprint — Time to train',
                        body: streak > 0
                            ? `Day ${streak + 1} streak. Open the app and get it done.`
                            : "Your protocol is waiting. Open the app.",
                        tag: 'daily-reminder',
                    };
                }

                if (!notification) continue;

                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    JSON.stringify(notification)
                );
                sent++;
            } catch (subErr) {
                // Subscription may be expired — clean it up
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
