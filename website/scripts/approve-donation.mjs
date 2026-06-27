#!/usr/bin/env node
/* ============================================================
   Admin approval tool.
   Moves a PENDING donation (in the private repo) into the PUBLIC
   donor ledger (funding-account-info/donations.csv in the public repo).

   Usage:
     GITHUB_TOKEN=xxx node scripts/approve-donation.mjs <CODE> [--reject]

   Env vars:
     GITHUB_TOKEN   - PAT with Contents read/write on BOTH repos
     GITHUB_OWNER   - e.g. "cev2030"            (default: cev2030)
     PUBLIC_REPO    - e.g. "uchicago-for-venezuela"
     PRIVATE_REPO   - e.g. "uchicago-for-venezuela-private"
     BRANCH         - default "main"
   ============================================================ */

const GH = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER || "cev2030";
const PUBLIC_REPO = process.env.PUBLIC_REPO || "uchicago-for-venezuela";
const PRIVATE_REPO = process.env.PRIVATE_REPO || "uchicago-for-venezuela-private";
const BRANCH = process.env.BRANCH || "main";

const code = process.argv[2];
const reject = process.argv.includes("--reject");

if (!TOKEN) { console.error("Set GITHUB_TOKEN."); process.exit(1); }
if (!code) { console.error("Usage: node scripts/approve-donation.mjs <CODE> [--reject]"); process.exit(1); }

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "ucv-approve",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function getFile(repo, path) {
  const res = await fetch(`${GH}/repos/${OWNER}/${repo}/contents/${path}?ref=${BRANCH}`, { headers });
  if (res.status === 404) return { sha: null, content: "" };
  if (!res.ok) throw new Error(`getFile ${repo}/${path}: ${res.status}`);
  const j = await res.json();
  return { sha: j.sha, content: Buffer.from(j.content, "base64").toString("utf8") };
}
async function putFile(repo, path, content, message, sha) {
  const body = { message, content: Buffer.from(content, "utf8").toString("base64"), branch: BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`${GH}/repos/${OWNER}/${repo}/contents/${path}`, {
    method: "PUT", headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`putFile ${repo}/${path}: ${res.status} ${await res.text()}`);
}
const cell = (v) => { const s = String(v ?? "").replace(/\r?\n/g, " ").trim(); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  const headers = (lines.shift() || "").split(",").map(h => h.trim());
  return { headers, rows: lines.map(l => splitCsvLine(l)) };
}
function splitCsvLine(line) {
  const out = []; let f = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i+1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else { if (c === '"') q = true; else if (c === ",") { out.push(f); f = ""; } else f += c; }
  }
  out.push(f); return out;
}

(async () => {
  // 1) load pending
  const pendingPath = "pending/donations_pending.csv";
  const pending = await getFile(PRIVATE_REPO, pendingPath);
  if (!pending.content) { console.error("No pending file found."); process.exit(1); }
  const { headers: ph, rows } = parseCSV(pending.content);
  const idx = Object.fromEntries(ph.map((h, i) => [h, i]));
  const match = rows.find(r => r[idx.code] === code);
  if (!match) { console.error(`Code ${code} not found in pending list.`); process.exit(1); }

  const newStatus = reject ? "rejected" : "approved";
  match[idx.status] = newStatus;

  // 2) rewrite pending file with updated status
  const rebuilt = [ph.join(","), ...rows.map(r => r.map(cell).join(","))].join("\n") + "\n";
  await putFile(PRIVATE_REPO, pendingPath, rebuilt, `Mark ${code} ${newStatus}`, pending.sha);

  if (reject) { console.log(`✓ ${code} marked rejected. Not published.`); return; }

  // 3) append public-safe row to the public ledger
  const pubPath = "funding-account-info/donations.csv";
  const pub = await getFile(PUBLIC_REPO, pubPath);
  const pubHeader = "code,date,donor_name,amount,currency,method,status\n";
  const base = pub.content && pub.content.trim() ? pub.content.replace(/\n?$/, "\n") : pubHeader;
  const date = (match[idx.timestamp] || new Date().toISOString()).slice(0, 10);
  const name = match[idx.is_anonymous] === "true" ? "Anonymous" : (match[idx.donor_name] || "Anonymous");
  const pubRow = [code, date, name, match[idx.amount], match[idx.currency], match[idx.method], "approved"]
    .map(cell).join(",") + "\n";
  await putFile(PUBLIC_REPO, pubPath, base + pubRow, `Publish approved donation ${code}`, pub.sha);

  console.log(`✓ ${code} approved and published to the public donor ledger.`);
})().catch(e => { console.error(e.message); process.exit(1); });
