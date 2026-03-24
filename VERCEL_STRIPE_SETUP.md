# Vercel + Stripe Setup

Backend source is organized under [`backend/`](/d:/nexlance/backend), but Vercel should continue using the root [`api/`](/d:/nexlance/api) directory. Those root API files now forward to the shared backend modules so local development and deployment use the same logic.

This project is now wired for:

- static pages on Vercel
- Vercel API functions under `api/` 
- Stripe PaymentIntent creation
- server-side business plan confirmation
- Stripe webhook verification

## 1. Vercel environment variables

Add these in Vercel Project Settings -> Environment Variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Use `.env.example` as the format reference.

## 2. FIREBASE_PRIVATE_KEY format

In Vercel, paste the full private key as a single value with escaped newlines:

```text
-----BEGIN PRIVATE KEY-----\nABC...\nDEF...\nGHI...\n-----END PRIVATE KEY-----\n
```

Do not paste it as multiple visual lines unless you know Vercel is preserving them correctly.

## 3. Firebase service account values

Get them from Firebase / Google Cloud service account JSON:

- `project_id` -> `FIREBASE_PROJECT_ID`
- `client_email` -> `FIREBASE_CLIENT_EMAIL`
- `private_key` -> `FIREBASE_PRIVATE_KEY`

The service account must have permission to update Firestore `users` documents.

## 4. Stripe webhook

In Stripe Dashboard:

1. Go to Developers -> Webhooks
2. Add endpoint
3. Endpoint URL:

```text
https://YOUR-DOMAIN.vercel.app/api/stripe-webhook
```

4. Listen for this event:

```text
payment_intent.succeeded
```

5. Copy the webhook signing secret and save it in Vercel as:

```text
STRIPE_WEBHOOK_SECRET
```

## 5. Stripe payment keys

For testing:

- use `sk_test_...`
- use `pk_test_...`
- use a test webhook secret from the Stripe test environment

For production:

- switch to live keys only when testing is complete

## 6. Business upgrade flow

The secure flow is now:

1. User logs into an account
2. User pays for Business
3. Stripe payment succeeds
4. Server verifies the PaymentIntent
5. Server updates the matching Firebase user by email
6. User gets Business access with `planStartedAt` and `planEndsAt`

## 7. End-to-end test

After deploying to Vercel:

1. Open:

```text
https://YOUR-DOMAIN.vercel.app/api/payment-config
```

It should return JSON.

2. Create a test account on the site.

3. Go to:

```text
https://YOUR-DOMAIN.vercel.app/pricing.html
```

4. Buy Business with Stripe test card:

```text
4242 4242 4242 4242
```

Use any future expiry, any CVC, any postal code.

5. Confirm:

- checkout succeeds
- account is redirected to dashboard
- Business-only pages unlock
- the same account keeps the upgrade after logout/login

## 8. Expiry test

To test expiry:

1. Open the user record in Firestore
2. Set `planEndsAt` to a past ISO timestamp
3. Refresh the site while logged into that account

Expected result:

- Business access is removed
- user falls back to Individual

## 9. Important note

This setup assumes Firestore contains one `users` document per signed-in account with a matching `email` field.
