# DiscoverDisc — Public Discord Server Directory

A directory app for browsing and discovering public Discord communities.
Sidebar layout, search, category filtering, favorites, light/dark themes,
and a **Bump** system that keeps people coming back.

## ✨ The Bump system (why people return)
Every server can be **bumped** to the top of the listing — but only once every
**2 hours**. That cooldown is the hook: server owners come back through the day
to re-bump and stay visible, which keeps the whole directory fresh and active.
The default sort is "🔥 Recently bumped", so bumping has an immediate, visible
payoff. (In the hosted version the cooldown is enforced server-side so it can't
be cheated; in standalone mode it's tracked in your browser.)

## 💎 Premium "Featured" listings (real payments)
Owners can **pay to feature** their server — pinned to the very top with a gold
highlight. Three plans, **$5 and up**:

| Plan | Price | What you get |
|------|-------|--------------|
| Featured 24 hours | **$5**  | Top placement + gold ribbon for 1 day |
| Featured 7 days   | **$15** | Top placement for a week |
| Featured 30 days  | **$40** | Top placement for a month |

Payments run through **Stripe Checkout** (the same processor used by thousands of
real businesses). Payment is verified server-side and, optionally, via Stripe
webhooks — it can't be faked from the browser. **See `server/SETUP-PAYMENTS.md`
to turn it on** (you'll need a free Stripe account; it runs in safe test mode
until you add live keys).

## 👤 Owner controls & 🛡️ admin
- When you add a server (hosted mode), you become its **owner** and can **edit or
  delete** it later — secured by a private token, so nobody else can touch your
  listing.
- An **admin panel** at `/admin.html` lets you moderate everything (feature or
  remove any server). Protected by your `ADMIN_KEY`.

There are **two ways to run it**, sharing the exact same interface:

---

## 1. Standalone (zero setup)

Just **double-click `index.html`** — it opens in your browser. No installation needed.

- Servers you add are saved **in your own browser** (only you see them).
- Favorites and light/dark theme are remembered on your device.
- The pill under the title reads **"Offline mode — saved on this device."**

Great for personal use or a quick demo.

---

## 2. Hosted (shared database) — everyone sees the same servers

This runs a small web server with a real database, so anything anyone adds is
visible to **all** visitors. The interface automatically switches to
**"Live — shared directory"** mode.

### Run it locally
You need [Node.js](https://nodejs.org) (v18+) installed.

- **Easiest:** double-click **`server/start.bat`** (Windows). First run installs
  dependencies, then it opens http://localhost:4000 automatically.
- **Or** from a terminal:
  ```
  cd server
  npm install
  npm start
  ```
  Then open http://localhost:4000

Data is stored in `server/servers.db` (SQLite). Delete that file to reset.

### Put it online (so others can reach it)
The server is a standard Node + Express app and deploys anywhere. Easiest free hosts:

**Render.com**
1. Push this `discord-finder` folder to a GitHub repo.
2. On Render → **New → Web Service** → connect the repo.
3. Settings:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Render gives you a public URL. Done — share it with anyone.

**Railway.app / Fly.io** work the same way (root `server`, start `npm start`).
The app listens on the host's `PORT` automatically.

> Note: SQLite stores data on the server's disk. On hosts with ephemeral disks,
> attach a persistent volume (or swap to Postgres) if you need data to survive
> redeploys. For small/community use, the default is fine.

---

### Deploying with payments (important)
For premium payments you need a host that stays **always-on** with a **persistent
disk** (so the database survives). **Render.com** fits and there's a ready-made
blueprint:
1. Push this `discord-finder` folder to GitHub.
2. Render → **New → Blueprint** → pick the repo (it reads `render.yaml`).
3. In the dashboard, add your secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `ADMIN_KEY`.

> Netlify is **not** suitable for the payment/database version (no always-on
> server or persistent disk). Use Render/Railway/Fly for the full app, or Netlify
> only for the static offline-mode `index.html`.

## Project layout
```
discord-finder/
├─ index.html              ← the whole app (works standalone AND hosted)
├─ premium-success.html    ← Stripe returns here after payment
├─ admin.html              ← moderation panel
├─ render.yaml             ← one-click Render deploy blueprint
├─ README.md / SECURITY.md
└─ server/
   ├─ server.js            ← Express API + Stripe + serves the frontend
   ├─ package.json
   ├─ start.bat            ← one-click launcher (Windows)
   ├─ .env.example         ← copy to .env to add keys
   └─ servers.db           ← created automatically on first run
```

## API (hosted mode)
- `GET  /api/health` · `GET /api/config`
- `GET  /api/servers` · `POST /api/servers` (returns a one-time `ownerToken`)
- `POST /api/servers/:id/bump` — free bump, 2-hour cooldown
- `PATCH/DELETE /api/servers/:id` — owner (or admin) only
- `POST /api/checkout` → Stripe Checkout · `GET /api/checkout/confirm` · `POST /api/webhook`
- `POST /api/admin/servers/:id/feature` — admin only

## Notes
- Not affiliated with Discord. Invite links lead to third-party communities.
- The 20 built-in "seed" servers are well-known public communities shown as examples;
  member/online counts on those are illustrative.
