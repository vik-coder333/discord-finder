# Security — discordserverfinder.com

Security is layered. Here's what's handled in the app code, and what **you**
need to do at the hosting/domain level.

## ✅ Done in the app code (server/server.js)

| Protection | What it stops |
|------------|---------------|
| **Parameterized SQL queries** | SQL injection (attackers reading/wiping your database) |
| **Strict invite validation** | The directory being used to spread phishing / `javascript:` / malware links. Only real `discord.gg` invites are accepted. |
| **Invite verification (Discord API)** | Dead or made-up invites — new listings are checked against Discord's public API before being accepted. |
| **Output escaping (frontend)** | Stored XSS — a malicious server name/description can't run code in visitors' browsers |
| **Content-Security-Policy** | Injected/external scripts from running on your page |
| **Rate limiting** | Spam floods — max 25 writes (add/edit/delete/bump/report) per 10 min, 120 API calls per min, per visitor |
| **Duplicate blocking** | The same server being posted hundreds of times |
| **Request size limit (8 KB)** | Oversized-payload abuse |
| **X-Frame-Options / frame-ancestors** | Clickjacking (your site embedded in a scam frame) |
| **X-Content-Type-Options: nosniff** | MIME-type confusion attacks |
| **HSTS header** | Forcing browsers to always use HTTPS |
| **x-powered-by removed** | Hides the server tech from attackers |
| **Owner tokens (constant-time compare)** | Stops one user editing/deleting another's listing, and resists timing attacks |
| **Session expiry (30 days)** | Stale Discord-login sessions can't be replayed forever; expired ones are pruned from the database |
| **Admin key on moderation routes** | Only you can feature/remove servers site-wide or view visitor reports |
| **Report system** | Visitors can flag scam/spam listings for your review in the admin panel instead of them lingering unnoticed |
| **Stripe Checkout (off-site)** | Card data never touches your server — Stripe handles it, keeping you out of PCI scope |
| **Server-side payment verification + webhook signatures** | A "featured" upgrade can't be faked from the browser; webhook events are signature-checked |

## 🔲 You must do these (can't be done in code)

1. **HTTPS / SSL** — turn it on at your host. It's **free and automatic** on
   Netlify, Render, Railway, Vercel, and Cloudflare. This encrypts all traffic.
   (The HSTS header above only takes effect once HTTPS is on.)

2. **DDoS / traffic-flood protection** — put the site behind **Cloudflare**
   (free plan). Point your domain's DNS at Cloudflare; it absorbs floods and
   adds another layer of HTTPS + caching.

3. **Lock down your accounts** — this is how most sites *actually* get hijacked:
   - Turn on **2-factor authentication (2FA)** on your domain registrar
     (where you bought discordserverfinder.com) **and** your host.
   - Enable **registrar/domain lock** so the domain can't be transferred away.
   - Use a strong, unique password (a password manager helps).

4. **Keep dependencies updated** — every so often, run `npm audit fix` inside
   the `server/` folder to patch any newly-discovered library vulnerabilities.

5. **Protect your secret keys** — your Stripe secret key and `ADMIN_KEY` live in
   `server/.env` (local) or your host's dashboard (production). **Never** commit
   `.env` to GitHub or paste keys into chats/screenshots. If a key leaks, roll it
   in the Stripe dashboard immediately.

6. **Back up the database** — copy `server/servers.db` somewhere safe
   periodically (or use a host with managed backups) so you don't lose the list.

## Notes / honest limits
- This is hardened for a normal public community directory. It is **not**
  storing passwords or card data — which keeps the risk surface small. The only
  personal data kept is the Discord id/username of people who log in.
- All destructive actions are authenticated: owners can only touch their own
  listing (owner token or Discord login), and site-wide moderation (delete,
  feature, reports) requires the `ADMIN_KEY`.
- No software is "100% unhackable." Layers + keeping things updated + account
  2FA is what real-world security looks like.
