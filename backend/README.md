Backend source now lives here.

- `backend/server.js`: local Node server for the frontend plus API routes
- `backend/api/`: request handlers
- `backend/services/`: shared Stripe and Firebase logic

Compatibility is preserved:

- `npm start` runs `backend/server.js`
- root `api/` files remain as thin wrappers for Vercel/serverless routing
- root `server.js` remains as a compatibility entrypoint for older local commands
