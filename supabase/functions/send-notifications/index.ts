import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
);

// ─── Hourly educational tips (indexed by local hour, 7–22) ───────────────────
// Each tip links a daily habit directly to blood flow and EQ.

const HOURLY_TIPS: Record<number, { title: string; body: string }> = {
    7:  { title: 'Coach Tee', body: "Morning. First thing — drink 500mL of water before anything else. Blood is 90% water. Dehydrated blood doesn't move well, and that shows up directly in your EQ." },
    8:  { title: 'Coach Tee', body: "How's your water intake looking? You should have 500mL in already. Hydration isn't optional — it's the first variable that affects your blood flow and your results." },
    9:  { title: 'Coach Tee', body: "Take 3 slow deep breaths right now. Belly breathing activates your parasympathetic nervous system — the same state your body needs to achieve full erections. Practice it daily." },
    10: { title: 'Coach Tee', body: "If you've been sitting for a while, your pelvic floor is probably tight. Release it consciously right now. A tight floor restricts blood flow to the genitals. Release is a skill." },
    11: { title: 'Coach Tee', body: "Check your posture. Slouching compresses the arteries that feed blood to your pelvic region. Sit tall — it's not just aesthetics, it's a direct blood flow intervention." },
    12: { title: 'Coach Tee', body: "Midday check. You should be at 1L of water by now. If you're not, drink up. Smooth muscle in your blood vessels needs water to stay flexible. Stiff vessels = weaker EQ." },
    13: { title: 'Coach Tee', body: "Get a 10-minute walk in this afternoon. Walking activates femoral artery blood flow — the same circuit that feeds the pudendal artery, which is the main supply line to your erections." },
    14: { title: 'Coach Tee', body: "Cold shower today if you can. Cold triggers vasoconstriction then vasodilation — that cycling trains your arteries to open on demand. Same mechanism as EQ. Do it." },
    15: { title: 'Coach Tee', body: "What's your stress level right now? Chronic stress raises cortisol, suppresses testosterone, and tightens blood vessels. Managing stress isn't soft — it's part of the protocol." },
    16: { title: 'Coach Tee', body: "Hydration window is closing. Most guys are 1.5-2L short by 4 PM. Drink 500mL now. You can't make it up at night — late water disrupts sleep, and sleep is when testosterone is produced." },
    17: { title: 'Coach Tee', body: "If you're training tonight, eat light now. A heavy meal redirects blood to digestion and away from the pelvic region. Let the blood stay where it needs to be." },
    18: { title: 'Coach Tee', body: "Session coming up. Remember — cold collagen tears instead of stretches. 10-minute warmup before you touch the protocol. Non-negotiable. Start earlier than you think you need to." },
    19: { title: 'Coach Tee', body: "Time to train. Warmup, protocol, pelvic floor work — all three. The guys who get results aren't the most intense, they're the most consistent. Get it done tonight." },
    20: { title: 'Coach Tee', body: "Start winding down. Testosterone peaks during deep sleep, but blue light, stress, and late eating all suppress it. Dim the screens, let the body shift into recovery mode." },
    21: { title: 'Coach Tee', body: "Screens down if you can. Blue light delays melatonin by 2-3 hours. Melatonin kicks off the hormone cascade that peaks in deep sleep — that's when your tissue remodels. Protect it." },
    22: { title: 'Coach Tee', body: "Last check of the day. Water done? Session done? Pelvic floor work done? 7-9 hours of sleep is part of the protocol. Log off and let the recovery do its job." },
};

const WAKING_HOURS = Object.keys(HOURLY_TIPS).map(Number);

function getUserLocalHour(now: Date, timezone: string): number {
    try {
        return parseInt(now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }), 10);
    } catch {
        return now.getUTCHours();
    }
}

Deno.serve(async () => {
    try {
        const now = new Date();
        const currentUTCHour = now.getUTCHours();

        const { data: subs, error } = await supabase
            .from('push_subscriptions')
            .select('*');

        if (error || !subs?.length) {
            return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
        }

        let sent = 0;

        for (const sub of subs) {
            try {
                const timezone = sub.timezone || 'UTC';
                const localHour = getUserLocalHour(now, timezone);

                // Only fire during waking hours
                if (!WAKING_HOURS.includes(localHour)) continue;

                // Deduplicate: only fire once per local hour per user
                // We use the UTC hour that corresponds to the user's local hour
                const userDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
                const utcDate  = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
                const offsetHours = Math.round((userDate.getTime() - utcDate.getTime()) / 3600000);
                const expectedUTCHour = ((localHour - offsetHours) + 24) % 24;
                if (currentUTCHour !== expectedUTCHour) continue;

                const tip = HOURLY_TIPS[localHour];

                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    JSON.stringify({ title: tip.title, body: tip.body, tag: `hourly-${localHour}` })
                );
                sent++;
            } catch (subErr) {
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
