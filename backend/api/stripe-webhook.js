const { handleStripeWebhookEvent, verifyStripeWebhookSignature } = require('../services/payments');

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 1e6) reject(new Error('Request body too large.'));
        });
        req.on('end', () => resolve(raw));
        req.on('error', reject);
    });
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Stripe-Signature');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const rawBody = await readRawBody(req);
        verifyStripeWebhookSignature(rawBody, req.headers['stripe-signature']);
        const event = JSON.parse(rawBody);
        await handleStripeWebhookEvent(event);
        res.status(200).json({ received: true });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Stripe webhook handling failed.' });
    }
};
