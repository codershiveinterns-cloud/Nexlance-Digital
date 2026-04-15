// Explicit nested serverless function for /api/dashboard/projects/:id
//
// Exists because Vercel's [...slug].js catch-all returns a platform-level
// 404 (x-vercel-error: NOT_FOUND) for DELETE/PATCH on nested two-segment
// paths in some deployment configurations. A static-prefix route like
// `projects/[id].js` always wins over any catch-all in Vercel's router,
// so this file guarantees the request reaches the backend handler.
//
// All methods (GET, PATCH, DELETE, OPTIONS) are forwarded to the shared
// backend dispatcher in backend/api/dashboard.js, which already resolves
// the collection/documentId from req.url when req.query.slug is absent.
// Writing a DELETE-only wrapper here would break GET/PATCH on the same
// URL, so we delegate the full method dispatch to the existing handler.

const dashboardHandler = require('../../../backend/api/dashboard');

module.exports = async function handler(req, res) {
    try {
        return await dashboardHandler(req, res);
    } catch (error) {
        // Defensive net: if the shared handler throws synchronously (it
        // shouldn't — it has its own try/catch), return a JSON 500 rather
        // than letting Vercel serialize an HTML error page.
        if (!res.headersSent) {
            res.status(500).json({
                error: error && error.message ? error.message : 'Dashboard request failed.'
            });
        }
    }
};
