# UChicago For Venezuela — Landing Page

A single-page site that:

- explains the relief effort and **what happened in Venezuela** (news pulled live from [`../venezuela-earthquake-news/`](../venezuela-earthquake-news/)),
- shows **how to donate** (Zelle preferred, plus bank transfer) from [`../funding-account-info/`](../funding-account-info/),
- lets donors **register a donation** by uploading their transfer screenshot — each gets a **unique tracking code**, can be **anonymous**, and is held for **admin review** before going public,
- shows **where the money goes**: the supplies needed list and a public ledger of supplies **bought & delivered**.

Everything is one page with a top-right menu (News · Donate · Where it goes · About).

---

## Files

| File | Purpose |
|---|---|
| `index.html` / `styles.css` / `app.js` | The static site (host these anywhere) |
| `netlify/functions/donate.js` | Serverless endpoint: records a **pending** donation + screenshot to a **private** repo |
| `scripts/approve-donation.mjs` | Admin tool: approve/reject a pending donation → publishes to the public donor ledger |
| `netlify.toml` / `package.json` | Deploy config |

## How the donation flow works

```
Donor uploads screenshot
        │
        ▼
/.netlify/functions/donate   ──►  PRIVATE repo
  • generates code U4V-XXXX-XXXX     pending/donations_pending.csv  (full details)
  • status = pending                 pending/screenshots/<code>.png (private image)
        │
        ▼
Admin runs:  npm run approve -- U4V-XXXX-XXXX
        │
        ▼
PUBLIC repo  funding-account-info/donations.csv   ──►  donor wall on the site
  (code, date, name/Anonymous, amount only — never the screenshot)
```

Screenshots and emails **never** touch the public repo or the website.

---

## One-time setup

### 1. Create a private repo for submissions
Create a **private** GitHub repo, e.g. `uchicago-for-venezuela-private`. Pending
donations and screenshots land here for your eyes only.

### 2. Create a GitHub token
Create a **fine-grained personal access token** with **Contents: Read and write**
on both `uchicago-for-venezuela` (public) and `uchicago-for-venezuela-private`.

### 3. Deploy to Netlify
- New site → connect this repo (or drag-drop the `website/` folder).
- Set **base directory** to `website` if you connect the whole repo.
- Add environment variables (Site settings → Environment variables):

  | Key | Value |
  |---|---|
  | `GITHUB_TOKEN` | your fine-grained PAT |
  | `GITHUB_OWNER` | `cev2030` |
  | `PRIVATE_REPO` | `uchicago-for-venezuela-private` |
  | `PRIVATE_BRANCH` | `main` (optional) |

- Deploy, then point your custom domain at the Netlify site.

> Prefer **Vercel**? The same `donate.js` logic works as a Vercel Function with
> minor signature tweaks (export a `(req, res)` handler). Ask and it can be ported.

### 4. Approve donations (admin)
On your machine, with the token exported:

```bash
cd website
GITHUB_TOKEN=ghp_xxx PUBLIC_REPO=uchicago-for-venezuela PRIVATE_REPO=uchicago-for-venezuela-private \
  npm run approve -- U4V-XXXX-XXXX          # publish to donor wall
# or
  npm run approve -- U4V-XXXX-XXXX --reject  # mark rejected, keep private
```

---

## Hosting on GitHub Pages (uchicagoforvenezuela.com)

The repo includes a workflow (`.github/workflows/pages.yml`) that publishes the
`website/` folder to GitHub Pages on every push to `main`, and a `CNAME` file
pinning the custom domain.

> ⚠️ **Important:** GitHub Pages serves **static files only** — it **cannot run
> the donation serverless function** (`netlify/functions/donate.js`). The page,
> news, supplies, and donor wall all work on Pages, but **the donation upload
> form's Submit needs a backend hosted elsewhere.** The chosen solution is a
> **Cloudflare Worker** — see [`../donation-worker/README.md`](../donation-worker/README.md)
> for deploy steps. Once deployed, set `CONFIG.donateEndpoint` in `app.js` to the
> Worker URL and push.
> Until then, the form shows the bank/Zelle info (what most donors use anyway).

### One-time GitHub setup
1. Push to `main` (the workflow runs automatically).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Repo **Settings → Pages → Custom domain**: confirm `uchicagoforvenezuela.com`
   is set (the `CNAME` file pre-fills it), then tick **Enforce HTTPS** once the
   certificate is issued (can take a few minutes to an hour).

### Porkbun DNS records
In Porkbun → your domain → **DNS**, add these (delete any conflicting default
A/ALIAS records first):

| Type | Host | Answer / Value |
|------|------|----------------|
| A | (blank / `@`) | `185.199.108.153` |
| A | (blank / `@`) | `185.199.109.153` |
| A | (blank / `@`) | `185.199.110.153` |
| A | (blank / `@`) | `185.199.111.153` |
| AAAA | (blank / `@`) | `2606:50c0:8000::153` |
| AAAA | (blank / `@`) | `2606:50c0:8001::153` |
| AAAA | (blank / `@`) | `2606:50c0:8002::153` |
| AAAA | (blank / `@`) | `2606:50c0:8003::153` |
| CNAME | `www` | `cev2030.github.io.` |

DNS can take 10 minutes to a few hours to propagate. The site will then be live
at `https://uchicagoforvenezuela.com`.

---

## Keeping content fresh
The page reads these CSVs **live** from the public repo `main` branch — just edit
the CSVs and the site updates on next load:

- News → `venezuela-earthquake-news/venezuela_earthquake_news.csv`
- Supplies needed → `supplies-needed/supplies_needed.csv`
- Supplies bought/delivered → `supplies-needed/supplies_bought.csv`
- Donor wall → `funding-account-info/donations.csv`

## Local preview
It's plain static files — open `index.html` directly, or:
```bash
cd website && python3 -m http.server 8080
```
The donation form needs the deployed serverless function to actually submit; the
rest of the page (news, supplies, donors) works locally because it reads the
public CSVs over HTTPS.

## TODO before launch
- [ ] Fill in the **EIN** in `../funding-account-info/README.md` (and add it to the About section if you want it on the page).
- [ ] Create the private repo + token and set Netlify env vars.
- [ ] Confirm the org/fiscal-sponsor relationship between "UChicago For Venezuela" and **1001 Ideas, INC**.
