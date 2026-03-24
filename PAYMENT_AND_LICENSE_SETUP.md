# Payment And License Setup

## Stack

- Frontend: static HTML + vanilla JavaScript
- Backend: Node.js HTTP server in `backend/server.js`
- Payment providers: Stripe Checkout and Polar Checkout
- License source: `template_license_key.txt`
- Protected delivery: signed temporary token + backend ZIP download route

## What Was Added

- `POST /api/template-access-start`
  Starts Stripe or Polar checkout, or validates a license key.
- `POST /api/template-access-complete`
  Verifies the user returned from Stripe or Polar with a successful payment.
- `GET /api/template-download?token=...`
  Builds and returns a ZIP only when the signed token is valid.
- `backend/services/template-access.js`
  Shared logic for checkout creation, payment verification, license redemption, transaction logging, token signing, and ZIP generation.
- `template-access.js`
  Frontend controller for the new payment/license form.
- `template_license_key.txt`
  Primary local license-key source.

## Environment Variables

Add these to `.env`:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

POLAR_ACCESS_TOKEN=polar_oat_...
POLAR_TEMPLATE_PRODUCT_ID=your_polar_product_id
POLAR_API_BASE_URL=https://api.polar.sh

TEMPLATE_DOWNLOAD_TOKEN_SECRET=replace_with_a_long_random_secret
TEMPLATE_DOWNLOAD_TOKEN_TTL_MS=900000
```

## License File Format

The server validates against `template_license_key.txt`.

```txt
template_id | license_key | status | issued_to_email | used_by_email | created_at | used_at
startup-landing-template | STARTU-N5F9-J3X8 | active |  |  | 2026-03-16T00:00:00.000Z |
```

Rules:

- `active` keys can be redeemed.
- On first successful use, the key is marked `used`.
- A `used` key still works for the same email that redeemed it.
- The key must match the selected template.

## Frontend Flow

1. User fills in name and email.
2. User either:
   - selects `Stripe` or `Polar`, or
   - enters a license key.
3. `template-access.js` submits to `/api/template-access-start`.
4. If payment was chosen:
   - Stripe or Polar returns a redirect URL.
   - browser leaves the site for checkout.
5. If a license key was entered:
   - the server validates it immediately,
   - the server returns a protected download URL,
   - download starts without payment.
6. After Stripe or Polar success:
   - the browser returns to `index.html`,
   - frontend calls `/api/template-access-complete`,
   - backend verifies the completed payment,
   - backend issues a short-lived signed token,
   - download starts.

## Backend Flow

### Start checkout

`/api/template-access-start`

- validates `name`, `email`, and `templateId`
- if `licenseKey` exists:
  - loads and validates the key from `template_license_key.txt`
  - marks it used
  - stores a transaction record
  - returns a signed download URL
- otherwise:
  - creates a Stripe or Polar checkout session
  - stores a pending transaction record
  - returns the gateway redirect URL

### Complete checkout

`/api/template-access-complete`

- Stripe: retrieves the Checkout Session and confirms `payment_status === paid`
- Polar: retrieves the Checkout Session and confirms `status === succeeded`
- stores/updates the successful transaction
- creates a signed short-lived download token
- returns `/api/template-download?token=...`

### Protected download

`/api/template-download`

- verifies the HMAC-signed token
- rejects expired or tampered tokens
- collects the template HTML, CSS, JS, and referenced local image assets
- builds a ZIP on the server
- returns it as an attachment

## Transaction Storage

Transactions are stored in:

`backend/data/template-access-transactions.json`

Stored fields include:

- provider
- status
- amount
- currency
- template ID
- customer name
- customer email
- metadata

## Security Best Practices

- Keep `STRIPE_SECRET_KEY` and `POLAR_ACCESS_TOKEN` only on the server.
- Never trust the frontend for successful payment state.
- Always verify Stripe/Polar payment completion server-side before generating download access.
- Use a strong `TEMPLATE_DOWNLOAD_TOKEN_SECRET`.
- Keep download tokens short-lived.
- Do not expose raw license files from the public web root.
- Normalize and validate `templateId`, email, and license-key input.
- Use HTTPS in production.
- Rotate license keys and secrets if they are leaked.
- If you move beyond local files, store license keys and transactions in a database with audit history.

## Example Request Payloads

Start payment:

```json
{
  "name": "Ava Hart",
  "email": "ava@example.com",
  "paymentMethod": "stripe",
  "licenseKey": "",
  "templateId": "startup-landing-template",
  "siteBaseUrl": "http://localhost:4242"
}
```

Start with license key:

```json
{
  "name": "Ava Hart",
  "email": "ava@example.com",
  "paymentMethod": "",
  "licenseKey": "STARTU-N5F9-J3X8",
  "templateId": "startup-landing-template",
  "siteBaseUrl": "http://localhost:4242"
}
```

Complete Stripe:

```json
{
  "provider": "stripe",
  "sessionId": "cs_test_123",
  "templateId": "startup-landing-template"
}
```

Complete Polar:

```json
{
  "provider": "polar",
  "checkoutId": "chk_123",
  "templateId": "startup-landing-template"
}
```
