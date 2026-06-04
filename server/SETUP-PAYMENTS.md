# Turning on payments (Stripe) — step by step

The app already has a complete, real payment system built in. It's just switched
**off** until you connect your own Stripe account. Nothing here costs money while
you're in **test mode**.

## What you need
- A free **Stripe account** → https://stripe.com (sign up takes a few minutes).
- That's it. No coding.

## Step 1 — get your test keys
1. Log into Stripe.
2. Make sure the **"Test mode"** toggle (top-right) is **ON**.
3. Go to **Developers → API keys**.
4. Copy your **Secret key** — it starts with `sk_test_...`

## Step 2 — add the key to the app
1. In the `server` folder, copy `.env.example` to a new file named `.env`.
2. Open `.env` and paste your key:
   ```
   STRIPE_SECRET_KEY=sk_test_your_key_here
   ADMIN_KEY=pick-any-long-random-password
   ```
3. Save, then restart the server (close and re-run `start.bat`).

You'll know it worked: the startup line now says **`Payments: ENABLED`**, and a
gold **⭐ Feature** button appears on each server card.

## Step 3 — try a test purchase (no real money)
1. Click **⭐ Feature** on a server → pick a plan → you land on Stripe Checkout.
2. Pay with Stripe's test card:
   - Card number: **4242 4242 4242 4242**
   - Expiry: any future date · CVC: any 3 digits · ZIP: any
3. You'll be sent back and the server becomes **★ FEATURED**, pinned to the top.

## Step 4 — going live (real money)
When you're ready to charge real customers:
1. In Stripe, switch **Test mode OFF** and complete account activation (Stripe
   verifies your identity/bank for payouts).
2. Grab your **live** secret key (`sk_live_...`) and put it in `.env`.
3. (Recommended) Set up the webhook for reliability — see below.
4. Restart. You're now accepting real payments. 🎉

## Step 5 (recommended for production) — the webhook
A webhook lets Stripe notify your server the instant a payment succeeds, even if
the customer closes their browser.
1. Stripe → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://YOUR-SITE.com/api/webhook`
3. Event to send: **`checkout.session.completed`**
4. Stripe shows a **Signing secret** (`whsec_...`). Add it to `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
   ```
5. Restart.

> Even without the webhook, payments still work — the success page verifies the
> payment directly with Stripe. The webhook just makes it bulletproof.

## Safety notes
- Your `.env` file holds secrets — **never** commit it to GitHub or share it.
  (On a host like Render, you paste these into the dashboard instead of a file.)
- The app never sees or stores card numbers — Stripe handles all of that on their
  own secure checkout page. That keeps you out of scope for most PCI compliance.
