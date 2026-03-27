export async function onRequestPost(context) {
const h = {
“Access-Control-Allow-Origin”: “*”,
“Access-Control-Allow-Methods”: “POST, OPTIONS”,
“Access-Control-Allow-Headers”: “Content-Type”,
“Content-Type”: “application/json”
};
try {
const b = await context.request.json();
if (!b.userMsg) return new Response(JSON.stringify({error: “No message”}), {status: 400, headers: h});
const k = context.env.CLAUDE_API_KEY;
if (!k) return new Response(JSON.stringify({error: “Unavailable”}), {status: 500, headers: h});
const r = await fetch(“https://api.anthropic.com/v1/messages”, {
method: “POST”,
headers: {“Content-Type”: “application/json”, “x-api-key”: k, “anthropic-version”: “2023-06-01”},
body: JSON.stringify({
model: “claude-sonnet-4-20250514”,
max_tokens: 1000,
system: b.systemPrompt || “You are CoachTee. PE protocols, pelvic health, male performance. Direct, real, no markdown.”,
messages: [{role: “user”, content: b.userMsg}]
})
});
const d = await r.json();
if (!r.ok) return new Response(JSON.stringify({error: d.error ? d.error.message : “Error”}), {status: r.status, headers: h});
const t = (d.content || []).filter(x => x.type === “text”).map(x => x.text).join(””);
return new Response(JSON.stringify({text: t}), {status: 200, headers: h});
} catch(e) {
return new Response(JSON.stringify({error: e.message}), {status: 500, headers: h});
}
}
export async function onRequestOptions() {
return new Response(null, {headers: {“Access-Control-Allow-Origin”: “*”, “Access-Control-Allow-Methods”: “POST, OPTIONS”, “Access-Control-Allow-Headers”: “Content-Type”}});
}
