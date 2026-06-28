/* ============================================================
   Cloudflare Worker: record a PENDING donation.
   Mirrors the original Netlify function, adapted for Workers
   (module syntax, Web APIs instead of Node Buffer).

   - Generates a unique tracking code (UCV-XXXX-XXXX)
   - Uploads the screenshot to a PRIVATE repo (never the public site)
   - Appends a row to a pending CSV in that PRIVATE repo (status: pending)
   The public donations.csv is only updated later by the admin
   approval script (website/scripts/approve-donation.mjs).

   Environment (set in the Cloudflare dashboard or wrangler):
     GITHUB_TOKEN   - SECRET: fine-grained PAT, Contents read/write on the private repo
     GITHUB_OWNER   - e.g. "cev2030"            (plain var)
     PRIVATE_REPO   - e.g. "uchicago-for-venezuela-private"  (plain var)
     PRIVATE_BRANCH - optional, defaults to "main"           (plain var)
   ============================================================ */

const GH = "https://api.github.com";

// Browser origins allowed to call this Worker.
const ALLOWED_ORIGINS = [
  "https://uchicagoforvenezuela.com",
  "https://www.uchicagoforvenezuela.com",
  "http://localhost:8123",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

// UTF-8 <-> base64 helpers (Workers have btoa/atob but they are latin1-only)
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function genCode() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `UCV-${t}-${r}`;
}

function csvCell(v) {
  const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ucv-donate-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
const repoPath = (env) => `${env.GITHUB_OWNER}/${env.PRIVATE_REPO}`;
const branch = (env) => env.PRIVATE_BRANCH || "main";

async function getFile(env, path) {
  const url = `${GH}/repos/${repoPath(env)}/contents/${path}?ref=${branch(env)}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return { sha: null, content: "" };
  if (!res.ok) throw new Error(`getFile ${path}: ${res.status}`);
  const j = await res.json();
  return { sha: j.sha, content: base64ToUtf8(j.content) };
}

async function putFile(env, path, base64Content, message, sha) {
  const body = { message, content: base64Content, branch: branch(env) };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH}/repos/${repoPath(env)}/contents/${path}`, {
    method: "PUT",
    headers: ghHeaders(env),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`putFile ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST")
      return json({ ok: false, error: "Method not allowed" }, 405, origin);

    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.PRIVATE_REPO)
      return json({ ok: false, error: "Server not configured." }, 500, origin);

    let data;
    try { data = await request.json(); }
    catch { return json({ ok: false, error: "Invalid request body." }, 400, origin); }

    const amount = parseFloat(data.amount);
    const anonymous = !!data.anonymous;
    const name = anonymous ? "Anonymous" : String(data.name || "").trim();
    const currency = String(data.currency || "USD").slice(0, 8);
    const method = String(data.method || "").slice(0, 32);
    const email = String(data.email || "").slice(0, 120);

    if (!amount || amount <= 0) return json({ ok: false, error: "Invalid amount." }, 400, origin);
    if (!anonymous && !name) return json({ ok: false, error: "Name required (or mark anonymous)." }, 400, origin);
    if (!data.screenshotBase64) return json({ ok: false, error: "Screenshot is required." }, 400, origin);
    if (data.screenshotBase64.length > 7_000_000) return json({ ok: false, error: "Screenshot too large." }, 413, origin);

    const code = genCode();
    const now = new Date().toISOString();
    const ext = (data.screenshotName || "png").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "png";

    try {
      // 1) screenshot -> private repo (browser already sent base64 of the raw bytes)
      await putFile(env, `pending/screenshots/${code}.${ext}`, data.screenshotBase64, `Donation screenshot ${code}`);

      // 2) append pending row -> private repo (retry on sha conflict)
      const path = "pending/donations_pending.csv";
      const header = "code,timestamp,donor_name,is_anonymous,amount,currency,method,email,screenshot_file,status\n";
      const newRow = [code, now, name, anonymous, amount, currency, method, email, `${code}.${ext}`, "pending"]
        .map(csvCell).join(",") + "\n";

      let attempts = 0;
      while (true) {
        const { sha, content } = await getFile(env, path);
        const base = content && content.trim() ? content.replace(/\n?$/, "\n") : header;
        try {
          await putFile(env, path, utf8ToBase64(base + newRow), `Pending donation ${code}`, sha);
          break;
        } catch (err) {
          if (++attempts >= 3) throw err;
        }
      }

      return json({ ok: true, code }, 200, origin);
    } catch (err) {
      return json({ ok: false, error: "Could not record donation. Please try again or email 1001ideasvenezuela@gmail.com." }, 500, origin);
    }
  },
};
