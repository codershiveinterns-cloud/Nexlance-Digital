# Firebase Backend Setup

Backend source now lives under [`backend/`](/d:/nexlance/backend). The local Node server is [`backend/server.js`](/d:/nexlance/backend/server.js), while the root [`api/`](/d:/nexlance/api) files are thin compatibility wrappers for Vercel/serverless routing.

This project uses Firebase for:

- frontend login/signup with Firebase Auth
- frontend user records in Firestore
- backend plan upgrades after Stripe payment

## 1. Create Firebase project

In Firebase Console:

1. Create a new project
2. Add a Web App
3. Copy the Web App config

You will get values like:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
  measurementId: "..." 
};
```

## 2. Put Firebase web config in the frontend

Open [`supabase-config.js`](/d:/nexlance/supabase-config.js) and replace the current `firebaseConfig` object with your own Firebase project's values.

That connects your frontend to Firebase Auth + Firestore.

## 3. Enable Firebase Authentication

In Firebase Console:

1. Go to Authentication
2. Click Get Started
3. Enable `Email/Password`

This is required for:

- create account
- login
- password reset flow

## 4. Enable Firestore Database

In Firebase Console:

1. Go to Firestore Database
2. Create database
3. Start in production mode or test mode depending on your stage

Your app stores user records in a `users` collection.

## 5. Create service account for backend

In Firebase Console / Google Cloud:

1. Project Settings
2. Service Accounts
3. Generate new private key

From the downloaded JSON file, use:

- `project_id` -> `FIREBASE_PROJECT_ID`
- `client_email` -> `FIREBASE_CLIENT_EMAIL`
- `private_key` -> `FIREBASE_PRIVATE_KEY`

These go into Vercel env vars and are used by the backend to update paid plans after Stripe payment.

## 6. Required backend env vars

Set these in Vercel:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## 7. Firestore document expectation

When a user signs up, the frontend creates a Firestore `users` document that includes at least:

- `email`
- `name`
- `planCode`
- `planStatus`
- `currentPlan`

The backend payment confirmation looks up the user by `email` and updates their plan after verified Stripe payment.

## 8. Stripe + Firebase link

The secure Business upgrade flow is:

1. User signs up with Firebase
2. Firestore `users` document is created
3. User pays with Stripe
4. Server verifies Stripe payment
5. Server finds Firestore user by email
6. Server writes:
   - `planCode`
   - `planStatus`
   - `planPaid`
   - `planStartedAt`
   - `planEndsAt`
   - `planBillingCycle`

## 9. Minimum deployment checklist

Before production, make sure:

- Firebase Auth Email/Password is enabled
- Firestore is enabled
- `users` collection is being created on signup
- Stripe env vars are set
- Firebase service account env vars are set
- Stripe webhook is configured
- `npm start` is serving from [`backend/server.js`](/d:/nexlance/backend/server.js) for local development
