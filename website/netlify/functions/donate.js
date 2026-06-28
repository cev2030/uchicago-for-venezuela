/* ============================================================
   Serverless function: record a PENDING donation.
   - Generates a unique tracking code
   - Uploads the screenshot to a PRIVATE repo  (never the public site)
   - Appends a row to a pending CSV in that PRIVATE repo
   Public donations.csv is only updated later, after admin review
   (see scripts/approve-donation.mjs).

   Required environment variables (set in Netlify dashboard):
     GITHUB_TOKEN   - fine-grained PAT with Contents: read & write on the private repo
     GITHUB_OWNER   - e.g. "cev2030"
     PRIVATE_REPO   - e.g. "uchicago-for-venezuela-private"
     PRIVATE_BRANCH - optional, defaults to "main"
   ============================================================ */

const GH = "https://api.github.com";

const env = (k, d) => process.env[k] || d;

function ghHeaders() {
  return {
    Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "u4v-donate-fn",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function repoPath() {
  return `${env("GITHUB_OWNER")}/${env("PRIVATE_REPO")}`;
}
const BRANCH = () => env("PRIVATE_BRANCH", "main");

async function getFile(path) {
  const url = `${GH}/repos/${repoPath()}/contents/${path}?ref=${BRANCH()}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return { sha: null, content: "" };
  if (!res.ok) throw new Error(`getFile ${path}: ${res.status}`);
  const json = await res.json();
  return { sha: json.sha, content: Buffer.from(json.content, "base64").toString("utf8") };
}

async function putFile(path, contentBuf, message, sha) {
  const url = `${GH}/repos/${repoPath()}/contents/${path}`;
  const body = {
    message,
    content: Buffer.isBuffer(contentBuf) ? contentBuf.toString("base64") : Buffer.from(contentBuf, "utf8").toString("base64"),
    branch: BRANCH(),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`putFile ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function genCode() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `U4V-${t}-${r}`;
}

function csvCell(v) {
  const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  if (!env("GITHUB_TOKEN") || !env("GITHUB_OWNER") || !env("PRIVATE_REPO")) {
    return json(500, { ok: false, error: "Server not configured. Missing GitHub environment variables." });
  }

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return json(400, { ok: false, error: "Invalid request body." }); }

  const amount = parseFloat(data.amount);
  const anonymous = !!data.anonymous;
  const name = anonymous ? "Anonymous" : String(data.name || "").trim();
  const currency = String(data.currency || "USD").slice(0, 8);
  const method = String(data.method || "").slice(0, 32);
  const email = String(data.email || "").slice(0, 120);

  if (!amount || amount <= 0) return json(400, { ok: false, error: "Invalid amount." });
  if (!anonymous && !name) return json(400, { ok: false, error: "Name required (or mark anonymous)." });
  if (!data.screenshotBase64) return json(400, { ok: false, error: "Screenshot is required." });

  // size guard (~5MB after base64 ~ 6.8MB string)
  if (data.screenshotBase64.length > 7_000_000) return json(413, { ok: false, error: "Screenshot too large." });

  const code = genCode();
  const now = new Date().toISOString();
  const ext = (data.screenshotName || "png").split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "png";

  try {
    // 1) upload screenshot (private repo)
    await putFile(
      `pending/screenshots/${code}.${ext}`,
      Buffer.from(data.screenshotBase64, "base64"),
      `Donation screenshot ${code}`
    );

    // 2) append pending row (private repo) with a small retry on sha conflict
    const path = "pending/donations_pending.csv";
    const header = "code,timestamp,donor_name,is_anonymous,amount,currency,method,email,screenshot_file,status\n";
    const newRow = [code, now, name, anonymous, amount, currency, method, email, `${code}.${ext}`, "pending"]
      .map(csvCell).join(",") + "\n";

    let attempts = 0;
    while (true) {
      const { sha, content } = await getFile(path);
      const base = content && content.trim() ? content.replace(/\n?$/, "\n") : header;
      try {
        await putFile(path, base + newRow, `Pending donation ${code}`, sha);
        break;
      } catch (err) {
        if (++attempts >= 3) throw err;
      }
    }

    return json(200, { ok: true, code });
  } catch (err) {
    return json(500, { ok: false, error: "Could not record donation. Please try again or email finanzasmiliun@gmail.com." });
  }
};
