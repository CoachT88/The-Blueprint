// Coach Tee - the app's AI coach, proxied so the Anthropic key never reaches
// a browser.
//
// Required secrets (Cloudflare Pages -> Settings -> Variables and Secrets):
//   ANTHROPIC_API_KEY - Anthropic console -> API keys
//   SUPABASE_URL      - your Supabase project URL
//   SUPABASE_ANON_KEY - Supabase -> Project Settings -> API -> anon/public
//
// This endpoint spends money on every call, so two things guard it: the
// caller has to be signed in, and the system prompt is chosen here rather
// than sent by the caller.
//
// The previous version had neither. It forwarded whatever system prompt the
// request supplied, with no authentication and Access-Control-Allow-Origin
// set to *, which made it a free general-purpose model that any page on the
// internet could drive and this account paid for.

/* The prompts live on the server and the client picks one by name. That is
   the whole difference between a coaching endpoint and an open model: a
   stranger can still reach this, but the only thing they can make it do is
   coach them about pelvic-floor training.

   Text moved verbatim from the client, so answers do not change. */
const SYSTEM_PROMPTS = {
  coach: "You are Coach Tee, a men's sexual health and performance specialist with deep expertise in pelvic floor physiology, tissue conditioning, blood flow optimization, hormonal health, and PE protocols. You speak with authority and precision backed by research and clinical understanding. You are direct, confident, and never hedge unnecessarily.\n\nCRITICAL RULES you follow on every single response:\n- NEVER use em dashes (-- or the character) under any circumstances. Use commas, periods, or colons instead.\n- No markdown formatting. No bullet points. No asterisks. No headers.\n- Write in clear prose paragraphs. Plain text only.\n- Never start with a filler phrase like \"Great question\" or \"Sure!\"\n- Always give a thorough, complete answer. If a topic has nuance, address the nuance directly. Do not oversimplify.\n\nMEDICAL ACCURACY REQUIREMENTS:\n- Kegel exercises are NOT universally beneficial. Men with a hypertonic (chronically tight or overactive) pelvic floor will often make their symptoms WORSE by doing kegels. The correct intervention for a hypertonic pelvic floor is reverse kegels, myofascial release, hip openers, and diaphragmatic breathing, not additional contraction work. Always ask or assess context before recommending kegels. If a man reports symptoms like urgency, premature ejaculation tied to tension, pelvic pain, or difficulty relaxing, suspect hypertonic floor and recommend release work over contractions.\n- Blood flow to erectile tissue depends on endothelial nitric oxide synthase (eNOS) activity, which is stimulated by physical deconditioning recovery, adequate sleep (testosterone peaks during REM), hydration, and vascular health. Chronic restriction, dehydration, and poor sleep all degrade EQ over time.\n- Length gains in PE typically precede girth gains. Early progress often reflects decompression and connective tissue elongation. Girth requires advanced techniques like clamping and Uli and responds more slowly. Never suggest girth comes faster or easier than length.\n- When discussing stamina and ejaculatory control, distinguish between psychological (performance anxiety, mental arousal spike) and physiological (hypertonic pelvic floor, pudendal nerve hypersensitivity) causes. Treatment differs significantly.\n- Testosterone optimization is downstream of sleep quality, body fat percentage, zinc and magnesium sufficiency, and chronic stress reduction. Supplementation without addressing these is largely ineffective.\n\nRESPONSE STYLE:\n- Be thorough. If a question has layers, address the layers. A 4 to 6 sentence response is often appropriate. Longer if the topic demands it.\n- Be specific. Cite mechanisms, not just conclusions. \"Nitric oxide dilates the smooth muscle of the corpus cavernosum\" is better than \"good blood flow helps erections.\"\n- Speak like a knowledgeable coach who has studied this deeply and worked with real men, not like a disclaimer-heavy medical chatbot.\n- Never say \"consult a doctor\" as a cop-out. You can note when something warrants professional evaluation, but still give a substantive answer.\n- The user is an adult who wants real information. Give it to them.",
  recovery: "You are a tissue expansion recovery analyst. The user will describe how their session felt, including EQ, pump, fatigue, and sensations. Give exactly 2 sentences: one assessing their recovery status, one actionable recommendation for their next session. No markdown. No em dashes. Be direct and specific.",
};

/* A member's own numbers get appended to the prompt so Coach Tee answers as
   someone who knows them. Both caps exist because every character here is
   billed to this account. */
const MAX_USER_MSG = 4000;
const MAX_CONTEXT = 4000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* Confirms the caller is signed in by asking Supabase who the token belongs
   to. This endpoint then trusts exactly the session the rest of the app
   already trusts, rather than inventing a second idea of who a user is. */
async function isSignedIn(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const res = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  /* Names the missing variable in the log. The browser is told nothing
     beyond "unavailable", because a stranger has no business learning which
     of our secrets is absent, but whoever is looking at the logs needs to
     know which one to go and set. Verifying a session made SUPABASE_ANON_KEY
     newly required here, and a Worker configured before that change has
     every other secret it needs and still refuses every request. */
  const missing = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    console.error('coach-tee: not configured, missing ' + missing.join(', '));
    return json({ error: { message: 'Coach Tee is unavailable right now.' } }, 503);
  }

  if (!(await isSignedIn(request, env))) {
    return json({ error: { message: 'Sign in to talk to Coach Tee.' } }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: { message: 'Bad request.' } }, 400);
  }

  const system = SYSTEM_PROMPTS[payload.mode];
  if (!system) return json({ error: { message: 'Unknown request.' } }, 400);

  const userMsg = String(payload.userMsg || '').slice(0, MAX_USER_MSG);
  if (!userMsg.trim()) return json({ error: { message: 'Nothing to send.' } }, 400);

  const context = String(payload.context || '').slice(0, MAX_CONTEXT);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: context ? system + '\n\n' + context : system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      /* The upstream body is not echoed back: it can carry account detail,
         and a browser has no use for it either way. */
      console.error('coach-tee: non-JSON response from Anthropic, status', res.status);
      data = { error: { message: 'Coach Tee could not answer that one.' } };
    }
    return json(data, res.status);
  } catch (e) {
    console.error('coach-tee: upstream request failed -', e.message);
    return json({ error: { message: 'Coach Tee could not answer that one.' } }, 502);
  }
}

/* Same-origin only now. A same-origin fetch sends no preflight, so the app
   never reaches this handler; it exists to tell other sites no. */
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
