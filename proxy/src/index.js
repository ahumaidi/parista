const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 500;
const PROMPT = "Inspect this coffee bag. Return ONLY valid JSON with these keys: roast (very light|light|medium-light|medium|medium-dark|dark|unknown), process (washed|natural|honey|wet-hulled|anaerobic|unknown), decaf (none|EA|Swiss Water|CO2|unknown), condition (normal|oily|defects|unknown), origin (string), variety (string), roastDate (raw string). Do not infer unseen facts.";

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

async function todayCount(env) {
  const key = `scans:${new Date().toISOString().slice(0, 10)}`;
  const raw = await env.QUOTA.get(key);
  return { key, count: raw ? parseInt(raw, 10) : 0 };
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }

    const origin = request.headers.get("Origin");
    if (origin !== env.ALLOWED_ORIGIN) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers });
    }

    const limit = parseInt(env.DAILY_SCAN_LIMIT, 10);
    const { key, count } = await todayCount(env);
    if (count >= limit) {
      return new Response(JSON.stringify({ error: "Daily scan limit reached. Try again tomorrow." }), { status: 429, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
    }
    const { image, mediaType } = body || {};
    if (!image || typeof image !== "string") {
      return new Response(JSON.stringify({ error: "Missing image" }), { status: 400, headers });
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: "Upstream API error", detail: errText }), { status: 502, headers });
    }

    await env.QUOTA.put(key, String(count + 1), { expirationTtl: 60 * 60 * 48 });

    const data = await anthropicRes.json();
    return new Response(JSON.stringify(data), { status: 200, headers: { ...headers, "content-type": "application/json" } });
  },
};
