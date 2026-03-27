export async function onRequestPost(context) {
// CORS headers — allow requests from your Pages domain
const headers = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘POST, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
‘Content-Type’: ‘application/json’,
};

```
try {
    const { userMsg, systemPrompt } = await context.request.json();

    if (!userMsg) {
        return new Response(JSON.stringify({ error: 'No message provided' }), { status: 400, headers });
    }

    // Get key from Cloudflare secret (CLAUDE_API_KEY)
    const apiKey = context.env.CLAUDE_API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 500, headers });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            system: systemPrompt || 'You are CoachTee — a real one. You know PE protocols, pelvic health, and male performance inside out. Talk like a knowledgeable friend, not a textbook. Keep it relaxed, direct, and real. No markdown, no bullet points, no fluff. 2-4 sentences unless they really need more.',
            messages: [{ role: 'user', content: userMsg }]
        })
    });

    const data = await response.json();

    if (!response.ok) {
        return new Response(JSON.stringify({ error: data.error?.message || 'Claude error' }), { status: response.status, headers });
    }

    const text = data.content?.map(b => b.type === 'text' ? b.text : '').join('') || '';
    return new Response(JSON.stringify({ text }), { status: 200, headers });

} catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
}
```

}

// Handle preflight OPTIONS request
export async function onRequestOptions() {
return new Response(null, {
headers: {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘POST, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
}
});
}
