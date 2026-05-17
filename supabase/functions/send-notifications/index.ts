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
    7:  { title: 'Morning EQ check.',          body: 'Morning erections are a vascular health report. Strong EQ on wake = arteries dilating properly. Track it every day.' },
    8:  { title: 'Drink water now.',            body: 'Blood is 90% water. Dehydration thickens it, raises vascular resistance, and tanks EQ directly. 500mL before anything else.' },
    9:  { title: '3 deep breaths.',             body: 'Shallow breathing keeps your nervous system in fight-or-flight. Deep belly breaths activate the parasympathetic state — the same state required for full erections.' },
    10: { title: 'Release your pelvic floor.',  body: 'A chronically tight floor restricts blood flow to the genitals. If you\'ve been sitting for 2+ hours, consciously relax it now. Release is the skill.' },
    11: { title: 'Fix your posture.',           body: 'Slouching compresses the iliac arteries that supply blood to the pelvic region. Sit tall — it\'s a direct blood flow intervention.' },
    12: { title: 'Midday hydration check.',     body: 'You should be at 1L by now. Smooth muscle in your blood vessels needs water to stay flexible. Stiff vessels mean weaker EQ.' },
    13: { title: '10-minute walk.',             body: 'Walking activates femoral artery flow. That same circuit feeds the pudendal artery — the primary supply line to your erections.' },
    14: { title: 'Cold shower today?',          body: 'Cold triggers vasoconstriction then vasodilation. That vascular cycling trains your arteries to open on demand — the same mechanism behind strong EQ.' },
    15: { title: 'Cortisol check.',             body: 'Chronic stress raises cortisol, suppresses testosterone, and tightens blood vessels. Stress management is not optional — it\'s part of the protocol.' },
    16: { title: 'Hydration window closing.',   body: 'Most guys are 1.5–2L short by 4 PM. 500mL now. You can\'t make it up at night without disrupting sleep — which kills overnight testosterone production.' },
    17: { title: 'Eat light before training.',  body: 'Heavy meals redirect blood to digestion and away from the pelvic region. If you\'re training tonight, eat something light now.' },
    18: { title: 'Warm tissue moves.',          body: 'Cold collagen tears instead of stretching. A 10-minute warmup before any session is non-negotiable. Start earlier than you think you need to.' },
    19: { title: 'Session time.',               body: 'The guys with the best results aren\'t the most intense — they\'re the most consistent. One session tonight keeps the adaptation cycle running.' },
    20: { title: 'Start winding down.',         body: 'Testosterone peaks during deep sleep. Blue light, stress, and late eating all suppress it. Begin dimming the environment now.' },
    21: { title: 'Screens down.',               body: 'Blue light delays melatonin by 2–3 hours. Melatonin triggers the hormone cascade that peaks in deep sleep. Dim everything and let it work.' },
    22: { title: 'Last call.',                  body: '7–9 hours of sleep is part of the protocol. Your tissue remodels overnight. Log off, wind down, let recovery do its job.' },
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
