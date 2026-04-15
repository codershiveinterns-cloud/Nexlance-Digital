// Explicit nested route: /api/dashboard/team_members/:id
// Static-prefix routes always win over the [...slug] catch-all in Vercel's
// router, so this guarantees DELETE/PATCH/GET by ID reach the backend handler
// even when Vercel's catch-all resolution misses nested paths.
module.exports = require('../../../backend/api/dashboard');
