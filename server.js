let handler;
try {
    handler = require('./backend/server');
} catch (error) {
    console.error('[fatal] Server startup failed:', error);
    handler = (req, res) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            error: 'Server initialization failed',
            message: error && error.message,
            stack: error && error.stack,
            missingEnv: [
                'FIREBASE_PROJECT_ID',
                'FIREBASE_CLIENT_EMAIL',
                'FIREBASE_PRIVATE_KEY',
                'RESEND_API_KEY',
                'APP_BASE_URL'
            ].filter(key => !process.env[key])
        }, null, 2));
    };
}

module.exports = handler;
