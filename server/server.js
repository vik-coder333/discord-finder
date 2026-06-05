import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import Stripe from "stripe";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

// Safety net: never let a stray async error crash the whole server process.
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Stripe is optional — the site works fully without it; premium just turns off.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Discord login is optional too. When configured, logging in is required to add
// a server. When not configured, the site falls back to anonymous adds.
const DISCORD = { clientId: process.env.DISCORD_CLIENT_ID || "", clientSecret: process.env.DISCORD_CLIENT_SECRET || "" };
const discordEnabled = !!(DISCORD.clientId && DISCORD.clientSecret);
function baseUrl(req) { return process.env.BASE_URL || `${req.protocol}://${req.get("host")}`; }

const COOLDOWN = 2 * 60 * 60 * 1000; // free bump cooldown: 2 hours
const DAY = 24 * 60 * 60 * 1000;

// Paid "Featured" plans — $5 and up. price is in cents.
const TIERS = [
  { id: "feature24", label: "Featured for 24 hours", price: 500, days: 1 },
  { id: "feature7", label: "Featured for 7 days", price: 1500, days: 7 },
  { id: "feature30", label: "Featured for 30 days", price: 4000, days: 30 },
];

/* ---------------- Database ---------------- */
// DB_PATH lets hosts point the database at a persistent disk (see render.yaml).
const dbPath = process.env.DB_PATH || join(__dirname, "servers.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    invite       TEXT NOT NULL UNIQUE,
    desc         TEXT DEFAULT '',
    cat          TEXT DEFAULT 'Community',
    tags         TEXT DEFAULT '[]',
    color        TEXT DEFAULT '#7c5cff',
    members      INTEGER DEFAULT 0,
    online       INTEGER DEFAULT 0,
    created      INTEGER NOT NULL,
    bumpedAt     INTEGER,
    bumps        INTEGER DEFAULT 0,
    featuredUntil INTEGER DEFAULT 0,
    ownerToken   TEXT
  );
  CREATE TABLE IF NOT EXISTS payments (
    session_id TEXT PRIMARY KEY,
    serverId   INTEGER,
    tier       TEXT,
    created    INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token    TEXT PRIMARY KEY,
    userId   TEXT,
    username TEXT,
    avatar   TEXT,
    created  INTEGER
  );
`);

// Migrations for databases created by earlier versions.
const cols = db.prepare("PRAGMA table_info(servers)").all().map((c) => c.name);
const addCol = (name, def) => { if (!cols.includes(name)) db.exec(`ALTER TABLE servers ADD COLUMN ${name} ${def}`); };
addCol("bumpedAt", "INTEGER");
addCol("bumps", "INTEGER DEFAULT 0");
addCol("featuredUntil", "INTEGER DEFAULT 0");
addCol("ownerToken", "TEXT");
addCol("ownerUserId", "TEXT");

const CATEGORIES = ["Gaming","Music","Art & Design","Tech","Anime","Study","Crypto","Community","Sports"];

function rowToServer(r) {
  return {
    id: "api:" + r.id,
    name: r.name,
    invite: r.invite,
    desc: r.desc,
    cat: r.cat,
    tags: JSON.parse(r.tags || "[]"),
    color: r.color,
    members: r.members,
    online: r.online,
    added: r.created,
    bumpedAt: r.bumpedAt || r.created,
    bumps: r.bumps || 0,
    featuredUntil: r.featuredUntil || 0,
    ownerId: r.ownerUserId || null,
    user: true,
  };
}

/* ---------------- Sessions / Discord auth helpers ---------------- */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const t = parseCookies(req).dd_session;
  if (!t) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE token = ?").get(t);
  return s ? { id: s.userId, username: s.username, avatar: s.avatar } : null;
}
function isSecure(req) { return req.protocol === "https" || req.headers["x-forwarded-proto"] === "https"; }
function setCookie(res, req, name, value, maxAge) {
  res.append("Set-Cookie", `${name}=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${isSecure(req) ? "; Secure" : ""}`);
}

function safeInvite(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  let m =
    s.match(/^discord\.gg\/([A-Za-z0-9-]{2,32})\/?$/i) ||
    s.match(/^discord(?:app)?\.com\/invite\/([A-Za-z0-9-]{2,32})\/?$/i);
  let code = m ? m[1] : /^[A-Za-z0-9-]{2,32}$/.test(s) ? s : null;
  return code ? "https://discord.gg/" + code : null;
}

function sanitizeFields(b) {
  const out = {};
  if (b.name !== undefined) out.name = String(b.name).trim().slice(0, 60);
  if (b.desc !== undefined) out.desc = String(b.desc).slice(0, 200);
  if (b.cat !== undefined) out.cat = CATEGORIES.includes(b.cat) ? b.cat : "Community";
  if (b.tags !== undefined)
    out.tags = Array.isArray(b.tags)
      ? b.tags.map((t) => String(t).replace(/[^A-Za-z0-9 -]/g, "").slice(0, 24)).filter(Boolean).slice(0, 6)
      : [];
  if (b.color !== undefined) out.color = /^#[0-9a-f]{3,8}$/i.test(b.color || "") ? b.color : "#7c5cff";
  return out;
}

// Grant featured time. Idempotent per Stripe session.
function grantFeature(serverId, tierId, sessionId) {
  const tier = TIERS.find((t) => t.id === tierId);
  if (!tier) return false;
  if (sessionId && db.prepare("SELECT 1 FROM payments WHERE session_id = ?").get(sessionId)) return true; // already granted
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(serverId);
  if (!row) return false;
  const now = Date.now();
  const until = Math.max(now, row.featuredUntil || 0) + tier.days * DAY;
  db.prepare("UPDATE servers SET featuredUntil = ?, bumpedAt = ? WHERE id = ?").run(until, now, serverId);
  if (sessionId)
    db.prepare("INSERT OR IGNORE INTO payments (session_id, serverId, tier, created) VALUES (?,?,?,?)").run(sessionId, serverId, tierId, now);
  return true;
}

/* ---------------- App ---------------- */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
        connectSrc: ["'self'"],
        formAction: ["'self'", "https://checkout.stripe.com"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Stripe webhook needs the RAW body, so it is registered BEFORE express.json().
app.post("/api/webhook", express.raw({ type: "*/*" }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    grantFeature(parseInt(s.metadata?.serverId, 10), s.metadata?.tier, s.id);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: "8kb" }));
app.use("/api/", rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You're doing that too quickly. Please wait a few minutes." },
});

/* ---------------- Public API ---------------- */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/config", (_req, res) =>
  res.json({
    payments: !!stripe,
    tiers: TIERS.map(({ id, label, price, days }) => ({ id, label, price, days })),
    discord: discordEnabled,
    loginRequired: discordEnabled,
  })
);

/* ---------------- Discord OAuth ---------------- */
app.get("/api/auth/me", (req, res) => res.json(currentUser(req)));

app.get("/api/auth/login", (req, res) => {
  if (!discordEnabled) return res.status(400).send("Discord login isn't set up on this site.");
  const state = crypto.randomBytes(16).toString("hex");
  setCookie(res, req, "dd_oauth_state", state, 600);
  const redirect = encodeURIComponent(baseUrl(req) + "/api/auth/callback");
  res.redirect(
    `https://discord.com/api/oauth2/authorize?client_id=${DISCORD.clientId}&redirect_uri=${redirect}&response_type=code&scope=identify&state=${state}`
  );
});

app.get("/api/auth/callback", async (req, res) => {
  if (!discordEnabled) return res.redirect("/");
  const { code, state } = req.query;
  if (!code || !state || state !== parseCookies(req).dd_oauth_state) return res.redirect("/?login=failed");
  try {
    const body = new URLSearchParams({
      client_id: DISCORD.clientId,
      client_secret: DISCORD.clientSecret,
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: baseUrl(req) + "/api/auth/callback",
    });
    const tokRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tok = await tokRes.json();
    if (!tok.access_token) throw new Error("token exchange failed");
    const u = await (await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    if (!u.id) throw new Error("user fetch failed");
    const token = crypto.randomBytes(24).toString("hex");
    db.prepare("INSERT INTO sessions (token, userId, username, avatar, created) VALUES (?,?,?,?,?)").run(
      token, u.id, u.global_name || u.username || "Discord user", u.avatar || "", Date.now()
    );
    setCookie(res, req, "dd_session", token, 60 * 60 * 24 * 30);
    res.redirect("/");
  } catch (e) {
    console.error("[auth]", e);
    res.redirect("/?login=failed");
  }
});

app.post("/api/auth/logout", (req, res) => {
  const t = parseCookies(req).dd_session;
  if (t) db.prepare("DELETE FROM sessions WHERE token = ?").run(t);
  res.append("Set-Cookie", `dd_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});

app.get("/api/servers", (_req, res) => {
  const rows = db.prepare("SELECT * FROM servers ORDER BY created DESC LIMIT 2000").all();
  res.json(rows.map(rowToServer));
});

app.post("/api/servers", writeLimiter, (req, res) => {
  const user = currentUser(req);
  if (discordEnabled && !user) return res.status(401).json({ error: "Please log in with Discord to add a server." });
  const b = req.body || {};
  const f = sanitizeFields(b);
  if (!f.name || f.name.length < 2) return res.status(400).json({ error: "Please enter a valid server name." });
  const invite = safeInvite(b.invite);
  if (!invite) return res.status(400).json({ error: "Please enter a valid Discord invite (e.g. discord.gg/yourcode)." });
  if (db.prepare("SELECT 1 FROM servers WHERE invite = ?").get(invite))
    return res.status(409).json({ error: "That server is already listed." });

  const now = Date.now();
  const ownerToken = crypto.randomBytes(24).toString("hex");
  try {
    const info = db
      .prepare(
        `INSERT INTO servers (name, invite, desc, cat, tags, color, members, online, created, bumpedAt, bumps, featuredUntil, ownerToken, ownerUserId)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, 0, ?, ?)`
      )
      .run(f.name, invite, f.desc || "", f.cat || "Community", JSON.stringify(f.tags || []), f.color || "#7c5cff", now, now, ownerToken, user ? user.id : null);
    const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(info.lastInsertRowid);
    // ownerToken is returned ONCE here so the adder can manage their listing.
    res.status(201).json({ ...rowToServer(row), ownerToken });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return res.status(409).json({ error: "That server is already listed." });
    console.error(e);
    res.status(500).json({ error: "Something went wrong saving that server." });
  }
});

app.post("/api/servers/:id/bump", writeLimiter, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid server." });
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Server not found." });
  const now = Date.now();
  const last = row.bumpedAt || 0;
  if (now - last < COOLDOWN) {
    const mins = Math.ceil((COOLDOWN - (now - last)) / 60000);
    return res.status(429).json({ error: `Already bumped — try again in about ${mins} min.`, retryAfter: COOLDOWN - (now - last) });
  }
  db.prepare("UPDATE servers SET bumpedAt = ?, bumps = bumps + 1 WHERE id = ?").run(now, id);
  res.json(rowToServer(db.prepare("SELECT * FROM servers WHERE id = ?").get(id)));
});

/* ---------------- Ownership (edit / delete) ---------------- */
function authLevel(req, row) {
  const adm = req.headers["x-admin-key"];
  if (ADMIN_KEY && adm === ADMIN_KEY) return "admin";
  const user = currentUser(req);
  if (user && row.ownerUserId && row.ownerUserId === user.id) return "owner";
  const tok = req.headers["x-owner-token"];
  if (tok && row.ownerToken) {
    const a = Buffer.from(String(tok));
    const b = Buffer.from(row.ownerToken);
    // timingSafeEqual throws on length mismatch, so guard the length first.
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return "owner";
  }
  return null;
}

app.patch("/api/servers/:id", writeLimiter, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Server not found." });
  if (!authLevel(req, row)) return res.status(403).json({ error: "You don't have permission to edit this server." });

  const f = sanitizeFields(req.body || {});
  if (f.name !== undefined && f.name.length < 2) return res.status(400).json({ error: "Invalid name." });
  let invite = row.invite;
  if (req.body?.invite) {
    const v = safeInvite(req.body.invite);
    if (!v) return res.status(400).json({ error: "Invalid Discord invite." });
    invite = v;
  }
  db.prepare("UPDATE servers SET name=?, desc=?, cat=?, tags=?, color=?, invite=? WHERE id=?").run(
    f.name ?? row.name,
    f.desc ?? row.desc,
    f.cat ?? row.cat,
    JSON.stringify(f.tags ?? JSON.parse(row.tags || "[]")),
    f.color ?? row.color,
    invite,
    id
  );
  res.json(rowToServer(db.prepare("SELECT * FROM servers WHERE id = ?").get(id)));
});

app.delete("/api/servers/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Server not found." });
  if (!authLevel(req, row)) return res.status(403).json({ error: "You don't have permission to delete this server." });
  db.prepare("DELETE FROM servers WHERE id = ?").run(id);
  res.json({ ok: true });
});

/* ---------------- Payments (Stripe Checkout) ---------------- */
app.post("/api/checkout", writeLimiter, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: "Payments aren't set up on this site yet." });
  const serverId = parseInt(req.body?.serverId, 10);
  const tier = TIERS.find((t) => t.id === req.body?.tier);
  if (!tier) return res.status(400).json({ error: "Invalid plan." });
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(serverId);
  if (!row) return res.status(404).json({ error: "Server not found." });

  const origin = req.headers.origin || `${req.protocol}://${req.get("host")}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: tier.price,
            product_data: { name: `${tier.label} — ${row.name}`, description: "Premium featured placement on DiscoverDisc" },
          },
          quantity: 1,
        },
      ],
      metadata: { serverId: String(serverId), tier: tier.id },
      success_url: `${origin}/premium-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Couldn't start checkout. Try again." });
  }
});

// Verify a completed checkout server-side and grant the feature (idempotent).
// Lets the success page confirm payment without relying on webhooks in dev.
app.get("/api/checkout/confirm", async (req, res) => {
  if (!stripe) return res.status(400).json({ error: "Payments not configured." });
  const sid = String(req.query.session_id || "");
  if (!sid) return res.status(400).json({ error: "Missing session." });
  try {
    const s = await stripe.checkout.sessions.retrieve(sid);
    if (s.payment_status === "paid") {
      grantFeature(parseInt(s.metadata?.serverId, 10), s.metadata?.tier, s.id);
      return res.json({ ok: true });
    }
    res.json({ ok: false, status: s.payment_status });
  } catch (e) {
    res.status(400).json({ error: "Could not verify that payment." });
  }
});

/* ---------------- Admin / moderation ---------------- */
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: "Admin is not configured on this server." });
  if (req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "Invalid admin key." });
  next();
}
// Comp a server as featured without payment (moderation / promos).
app.post("/api/admin/servers/:id/feature", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const days = Math.max(1, Math.min(365, parseInt(req.body?.days, 10) || 1));
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Server not found." });
  const now = Date.now();
  const until = Math.max(now, row.featuredUntil || 0) + days * DAY;
  db.prepare("UPDATE servers SET featuredUntil = ?, bumpedAt = ? WHERE id = ?").run(until, now, id);
  res.json(rowToServer(db.prepare("SELECT * FROM servers WHERE id = ?").get(id)));
});

/* ---------------- Static frontend ---------------- */
app.use(express.static(join(__dirname, "..")));

app.listen(PORT, () => {
  console.log(`\n  DiscoverDisc running →  http://localhost:${PORT}`);
  console.log(`  Payments: ${stripe ? "ENABLED" : "disabled"}   Admin: ${ADMIN_KEY ? "enabled" : "disabled"}   Discord login: ${discordEnabled ? "ENABLED" : "disabled"}\n`);
});
