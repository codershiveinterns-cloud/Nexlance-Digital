function assertResendConfig() {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const from = String(process.env.RESEND_FROM_EMAIL || '').trim();

    if (!apiKey) {
        throw new Error('Missing RESEND_API_KEY environment variable.');
    }

    if (!from) {
        throw new Error('Missing RESEND_FROM_EMAIL environment variable.');
    }

    return {
        apiKey,
        from
    };
}

async function sendEmailWithResend({ to, subject, html, text }) {
    const config = assertResendConfig();
    const recipients = Array.isArray(to) ? to : [to];

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: config.from,
            to: recipients,
            subject: String(subject || '').trim(),
            html: String(html || '').trim(),
            text: String(text || '').trim()
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error((data && data.message) || 'Resend could not send the email.');
    }

    return data;
}

module.exports = {
    sendEmailWithResend
};
