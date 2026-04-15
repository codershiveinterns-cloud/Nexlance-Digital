// Explicit two-segment route: /api/dashboard/<collection>/<id>
// Exists alongside the [...slug].js catch-all to guarantee routing on
// Vercel even when platform-level path resolution misses catch-alls
// for DELETE/PATCH on nested IDs.
module.exports = require('../../../backend/api/dashboard');
