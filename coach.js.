export async function onRequestPost(context) {
  const { request, env } = context;
  
  // This pulls your key SAFELY from the Cloudflare vault you just set up
  const MY_SECRET_KEY = env.CLOUDE_API_KEY; 

  // Take what the user sent from the app
  const userData = await request.json();

  // We talk to Claude for the user
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": MY_SECRET_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(userData),
  });

  return response;
}
