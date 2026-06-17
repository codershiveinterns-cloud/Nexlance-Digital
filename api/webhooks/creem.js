const crypto = require('crypto');
const { handleCreemWebhookEvent } = require('../../backend/services/payments'); // Note: handleCreemWebhookEvent must be implemented in payments.js

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const payload = JSON.stringify(req.body);
        const signature = req.headers['x-creem-signature']; 

        const secret = process.env.CREEM_WEBHOOK_SECRET;
        if (!secret) throw new Error('Missing webhook secret');
        
        const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        
        if (signature !== expectedSignature) {
            throw new Error('Invalid signature');
        }

        // Pass the event to the payment service to fulfill the purchase
        if (typeof handleCreemWebhookEvent === 'function') {
            await handleCreemWebhookEvent(req.body);
        }
        
        res.status(200).json({ received: true });
    } catch (error) {
        console.error('Creem Webhook Error:', error);
        res.status(400).json({ error: 'Webhook verification failed' });
    }
};
