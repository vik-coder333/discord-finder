# Turning on "Log in with Discord"

Like payments, the login system is fully built — it just needs a free **Discord
application** (gives you a Client ID + Secret). Until you add these, the site
works exactly as before (anyone can add servers). Once added, **logging in is
required to add a server**, and people manage their own listings from any device.

## Step 1 — create a Discord application
1. Go to **https://discord.com/developers/applications**
2. Click **New Application**, give it a name (e.g. "DiscoverDisc"), accept terms, **Create**.
3. In the left menu click **OAuth2**.
4. Copy the **Client ID**.
5. Click **Reset Secret** (or Reveal) to get the **Client Secret** — copy it.

## Step 2 — add the redirect URLs
Still on the **OAuth2** page, under **Redirects**, click **Add Redirect** and add
BOTH of these (so login works on both addresses):
```
https://discoverdisc.onrender.com/api/auth/callback
https://discordserverfinder.com/api/auth/callback
```
(Add the second one only once your custom domain is connected.)
Click **Save Changes**.

## Step 3 — add the keys to Render
1. Render dashboard → your **discoverdisc** service → **Environment**.
2. Add two variables:
   ```
   DISCORD_CLIENT_ID      = (the Client ID)
   DISCORD_CLIENT_SECRET  = (the Client Secret)
   ```
3. (Recommended) also add, so the login redirect always uses one canonical address:
   ```
   BASE_URL = https://discordserverfinder.com
   ```
   …or `https://discoverdisc.onrender.com` if you haven't set up the domain yet.
   The `BASE_URL` you pick **must** be one of the redirect URLs from Step 2.
4. Click **Save changes** — Render redeploys automatically (~2 min).

## Step 4 — try it
- Open your site. A **"Log in with Discord"** button appears in the sidebar.
- Click it → approve on Discord → you're back, logged in (your avatar shows).
- Now "Add your server" works, and servers you add show a ⚙ Manage button —
  on **any** device you log in from.

## Notes
- Sessions are stored as secure, http-only cookies — no passwords to manage.
- Your `DISCORD_CLIENT_SECRET` is a secret: only put it in Render's dashboard
  (or local `.env`), never in GitHub or screenshots.
- Admins (with the `ADMIN_KEY`) can still moderate everything regardless of login.
