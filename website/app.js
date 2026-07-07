/* ============================================================
   UChicago For Venezuela — front-end logic
   - Loads news / supplies / purchases / donors from the repo CSVs
   - Handles the donation registration form
   ============================================================ */

const CONFIG = {
  // Single source of truth: the public GitHub repo's raw CSVs.
  rawBase: "https://raw.githubusercontent.com/cev2030/uchicago-for-venezuela/main/",
  newsCsv: "venezuela-earthquake-news/venezuela_earthquake_news.csv",
  suppliesCsv: "supplies-needed/supplies_needed.csv",
  boughtCsv: "supplies-needed/supplies_bought.csv",
  donationsCsv: "funding-account-info/donations.csv",
  // Serverless endpoint that records a pending donation (Cloudflare Worker; see donation-worker/)
  donateEndpoint: "https://u4v-donate.cev-d87.workers.dev/",
  maxUploadBytes: 5 * 1024 * 1024,
  // Only these articles are shown on the landing page (in this order).
  // The full dataset still lives in the news CSV.
  featuredNews: [
    "https://www.cnn.com/2026/06/28/world/live-news/venezuela-earthquake-hnk",
    "https://www.nbcnews.com/world/venezuela/venezuela-earthquake-latest-death-toll-missing-rescues-la-guaira-rcna352179",
    "https://www.foxnews.com/video/6399719200112",
  ],
};

/* ---------- tiny CSV parser (handles quoted fields) ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(v => v && v.trim() !== ""))
    .map(r => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] || "").trim()])));
}

async function fetchCSV(path) {
  const res = await fetch(CONFIG.rawBase + path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return parseCSV(await res.text());
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

/* ---------- NEWS ---------- */
async function loadNews() {
  const el = document.getElementById("newsGrid");
  try {
    const all = await fetchCSV(CONFIG.newsCsv);
    // Keep only the featured articles, in the configured order.
    const rows = CONFIG.featuredNews
      .map(url => all.find(r => r.url === url))
      .filter(Boolean);
    const list = rows.length ? rows : all;
    if (!list.length) { el.innerHTML = `<p class="empty">No articles yet.</p>`; return; }
    el.innerHTML = list.map(r => `
      <article class="news-card">
        <span class="src">${esc(r.source)}</span>
        <a class="title" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        <a class="go" href="${esc(r.url)}" target="_blank" rel="noopener">Read article →</a>
      </article>`).join("");
  } catch (e) {
    el.innerHTML = `<p class="empty">Couldn't load the news feed right now.
      View it <a href="https://github.com/cev2030/uchicago-for-venezuela/tree/main/venezuela-earthquake-news" target="_blank" rel="noopener">on GitHub</a>.</p>`;
  }
}

/* ---------- SUPPLIES NEEDED ---------- */
async function loadSupplies() {
  const el = document.getElementById("suppliesTable");
  try {
    const rows = await fetchCSV(CONFIG.suppliesCsv);
    if (!rows.length) { el.innerHTML = `<p class="empty">No supplies listed yet.</p>`; return; }
    const body = rows.map(r => `
      <tr>
        <td class="cat">${esc(r.category)}</td>
        <td>${esc(r.item_en)}</td>
        <td>${esc(r.unit)}</td>
        <td class="num">$${esc(r.est_unit_cost_usd)}</td>
      </tr>`).join("");
    el.innerHTML = `
      <table class="data">
        <thead><tr><th>Category</th><th>Item</th><th>Unit</th><th class="num">Est. cost (USD)</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<p class="empty">Couldn't load the supplies list.
      View it <a href="https://github.com/cev2030/uchicago-for-venezuela/blob/main/supplies-needed/supplies_needed.csv" target="_blank" rel="noopener">on GitHub</a>.</p>`;
  }
}

/* ---------- SUPPLIES BOUGHT / DELIVERED ---------- */
function statusPill(status) {
  const s = (status || "").toLowerCase();
  let cls = "status-planned";
  if (s.includes("deliver")) cls = "status-delivered";
  else if (s.includes("purchas") || s.includes("transit") || s.includes("bought")) cls = "status-purchased";
  return `<span class="status-pill ${cls}">${esc(status || "Planned")}</span>`;
}
async function loadBought() {
  const el = document.getElementById("boughtTable");
  try {
    const rows = await fetchCSV(CONFIG.boughtCsv);
    if (!rows.length) {
      el.innerHTML = `<p class="empty">No purchases recorded yet — this ledger fills in as supplies are bought and delivered.</p>`;
      return;
    }
    const body = rows.map(r => `
      <tr>
        <td>${esc(r.date)}</td>
        <td>${esc(r.item_en)}</td>
        <td class="num">${esc(r.quantity)}</td>
        <td class="num">$${esc(r.total_cost_usd)}</td>
        <td>${statusPill(r.status)}</td>
        <td>${r.delivered_to ? `<span class="status-pill status-delivery">${esc(r.delivered_to)}</span>` : ""}</td>
      </tr>`).join("");
    el.innerHTML = `
      <table class="data">
        <thead><tr><th>Date</th><th>Item</th><th class="num">Qty</th><th class="num">Total</th><th>Status</th><th>Delivered to</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<p class="empty">Couldn't load the purchases ledger right now.</p>`;
  }
}

/* ---------- DONOR WALL ---------- */
async function loadDonors() {
  const el = document.getElementById("donorWall");
  try {
    const rows = await fetchCSV(CONFIG.donationsCsv);
    const approved = rows.filter(r => (r.status || "").toLowerCase() === "approved");
    if (!approved.length) {
      el.innerHTML = `<p class="empty">Be the first — your donation could appear here.</p>`;
      return;
    }
    el.innerHTML = approved.slice(-60).reverse().map(r => {
      const name = r.donor_name && r.donor_name.trim() ? r.donor_name : "Anonymous";
      const amt = r.amount ? `<span class="amt">${esc(r.currency || "USD")} ${esc(r.amount)}</span>` : "";
      return `<span class="donor-chip"><strong>${esc(name)}</strong> ${amt}</span>`;
    }).join("");
  } catch (e) {
    el.innerHTML = `<p class="empty">Donor list will appear here.</p>`;
  }
}

/* ---------- DONATION FORM ---------- */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]); // strip data: prefix
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function initForm() {
  const form = document.getElementById("donationForm");
  const status = document.getElementById("formStatus");
  const btn = document.getElementById("submitBtn");
  const anon = document.getElementById("anonymous");
  const nameInput = document.getElementById("donorName");

  anon.addEventListener("change", () => {
    nameInput.disabled = anon.checked;
    if (anon.checked) nameInput.value = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "form-status";
    status.textContent = "";

    const amount = parseFloat(document.getElementById("amount").value);
    const file = document.getElementById("screenshot").files[0];
    const isAnon = anon.checked;
    const name = nameInput.value.trim();

    if (!isAnon && !name) { return fail("Please enter your name, or check “anonymous.”"); }
    if (!amount || amount <= 0) { return fail("Please enter a valid amount."); }
    if (!file) { return fail("Please attach your transfer screenshot."); }
    if (file.size > CONFIG.maxUploadBytes) { return fail("Screenshot is larger than 5 MB. Please upload a smaller image."); }

    btn.disabled = true;
    status.textContent = "Submitting…";

    try {
      const screenshotBase64 = await fileToBase64(file);
      const payload = {
        name: isAnon ? "" : name,
        anonymous: isAnon,
        amount: amount,
        currency: document.getElementById("currency").value,
        method: document.getElementById("method").value,
        email: document.getElementById("email").value.trim(),
        screenshotBase64,
        screenshotName: file.name,
      };

      const res = await fetch(CONFIG.donateEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Submission failed.");

      status.className = "form-status ok";
      status.innerHTML = `Thank you! Your donation is recorded for verification. ` +
        `Your tracking code is <span class="code">${esc(data.code)}</span> — keep it for your records. ` +
        `It will appear on the donor wall once reviewed.`;
      form.reset();
      nameInput.disabled = false;
    } catch (err) {
      fail(err.message || "Something went wrong. Please try again or email finanzasmiliun@gmail.com.");
    } finally {
      btn.disabled = false;
    }
  });

  function fail(msg) {
    status.className = "form-status err";
    status.textContent = msg;
    btn.disabled = false;
    return false;
  }
}

/* ---------- copy buttons ---------- */
function initCopy() {
  document.querySelectorAll(".copybtn").forEach(b => {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        const t = b.textContent; b.textContent = "Copied!";
        setTimeout(() => (b.textContent = t), 1500);
      } catch { /* clipboard unavailable */ }
    });
  });
}

/* ---------- nav scroll state + close menu on click ---------- */
function initNav() {
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 30);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  const toggle = document.getElementById("navToggle");
  document.querySelectorAll(".nav__links a").forEach(a =>
    a.addEventListener("click", () => { toggle.checked = false; }));
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initCopy();
  initForm();
  loadNews();
  loadSupplies();
  loadBought();
  loadDonors();
});
