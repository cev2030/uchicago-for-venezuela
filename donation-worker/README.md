# Donation Worker (Cloudflare)

Serverless endpoint that makes the donation form on
**uchicagoforvenezuela.com** (GitHub Pages) actually record submissions.

```
Donor → form on the site → POST this Worker
        → Worker generates code UCV-XXXX-XXXX
        → uploads screenshot + pending row to the PRIVATE repo
        → returns the code to the donor
Admin  → npm run approve -- UCV-XXXX-XXXX  → publishes to the public donor wall
```

Screenshots and donor emails go **only** to the private repo, never to the
public site. This Worker holds the GitHub token as an encrypted secret.

---

## Prerequisites (one time)

1. **Private repo** for submissions, e.g. `uchicago-for-venezuela-private`
   (create it on GitHub, set to Private).
2. **GitHub token** — a *fine-grained personal access token* with
   **Contents: Read and write** scoped to that private repo. Copy it.
3. A free **Cloudflare account**.

---

## Option A — Deploy from the Cloudflare dashboard (no local tools)

Best if you don't have Node/npm installed.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it **`ucv-donate`** → **Deploy** (accept the starter code).
3. Click **Edit code**. Delete the starter code, paste the entire contents of
   [`src/donate.js`](src/donate.js), then **Deploy**.
4. Go to the Worker → **Settings → Variables and Secrets** and add:

   | Name | Type | Value |
   |------|------|-------|
   | `GITHUB_OWNER` | Text | `cev2030` |
   | `PRIVATE_REPO` | Text | `uchicago-for-venezuela-private` |
   | `PRIVATE_BRANCH` | Text | `main` |
   | `GITHUB_TOKEN` | **Secret (Encrypt)** | *your fine-grained PAT* |

   Save / deploy after adding them.
5. Copy the Worker URL shown at the top — it looks like
   **`https://ucv-donate.<your-subdomain>.workers.dev`**.
6. **Send me that URL** and I'll wire the form to it (update
   `website/app.js` → `CONFIG.donateEndpoint` and push). Or do it yourself:
   set `donateEndpoint` to that URL and commit.

---

## Option B — Deploy with Wrangler (needs Node 18+)

```bash
npm install -g wrangler
cd donation-worker
wrangler login
wrangler secret put GITHUB_TOKEN     # paste the PAT when prompted
wrangler deploy                      # prints the workers.dev URL
```
`GITHUB_OWNER` / `PRIVATE_REPO` / `PRIVATE_BRANCH` come from `wrangler.toml`.

---

## Test it

```bash
curl -i -X POST https://ucv-donate.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","amount":5,"currency":"USD","method":"Zelle","screenshotBase64":"iVBORw0KGgo=","screenshotName":"t.png"}'
```
Expect `{"ok":true,"code":"UCV-..."}`, and a new row + image in the **private**
repo under `pending/`. (Delete that test row/image afterward.)

## Notes
- **CORS** is locked to `uchicagoforvenezuela.com`, `www.…`, and
  `localhost:8123`. Add origins in `src/donate.js` (`ALLOWED_ORIGINS`) if needed.
- Free plan allows 100,000 requests/day — far more than needed.
- Approving/rejecting donations is unchanged: see
  [`../website/scripts/approve-donation.mjs`](../website/scripts/approve-donation.mjs).
