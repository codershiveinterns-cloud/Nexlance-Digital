const { retrieveStripePaymentIntent, buildPlanRecordFromPaymentIntent } = require('../services/payments');
const { updateUserPlanByEmail } = require('../services/firebase-service');

function normalizeBody(body) {
    if (!body) return {};
    if (typeof body === 'string') {
        try {
            return JSON.parse(body);
        } catch (error) {
            throw new Error('Invalid JSON body.');
        }
    }
    return body;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
        const body = normalizeBody(req.body);
        const paymentIntent = await retrieveStripePaymentIntent(body.paymentIntentId);
        const metadata = paymentIntent.metadata || {};
        const userEmail = String(metadata.user_email || body.userEmail || '').trim().toLowerCase();

        if (!userEmail) {
            throw new Error('User email is missing from the Stripe payment metadata.');
        }

        const planRecord = buildPlanRecordFromPaymentIntent(paymentIntent);
        await updateUserPlanByEmail(userEmail, planRecord);

        res.status(200).json({ ok: true, plan: planRecord });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Business upgrade could not be confirmed.' });
    }
};
