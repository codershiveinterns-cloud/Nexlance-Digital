const RESEND_API_BASE_URL = 'https://api.resend.com';

function normalizeEnvironment() {
    return String(process.env.NODE_ENV || 'development').trim().toLowerCase();
}

function isProductionEnvironment(environment = normalizeEnvironment()) {
    return environment === 'production';
}

function isValidEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeRecipients(to) {
    const recipients = (Array.isArray(to) ? to : [to])
        .map(entry => String(entry || '').trim())
        .filter(Boolean);

    if (!recipients.length) {
        throw new Error('Email recipient is required.');
    }

    const invalidRecipient = recipients.find(recipient => !isValidEmailAddress(recipient));
    if (invalidRecipient) {
        throw new Error(`Invalid email recipient: ${invalidRecipient}`);
    }

    return recipients;
}

function redactApiKey(apiKey) {
    const value = String(apiKey || '').trim();
    if (!value) return '(missing)';
    if (value.length <= 8) return `${value.slice(0, 2)}***`;
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function buildEmailConfig() {
    const environment = normalizeEnvironment();
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const productionFrom = String(process.env.RESEND_FROM_EMAIL || '').trim();
    const developmentFrom = String(process.env.RESEND_DEV_FROM_EMAIL || '').trim();
    const from = isProductionEnvironment(environment)
        ? productionFrom
        : (developmentFrom || productionFrom);
    const replyTo = String(process.env.RESEND_REPLY_TO || '').trim();
    const devRecipient = String(process.env.RESEND_DEV_TO_EMAIL || '').trim();
    const apiBaseUrl = String(process.env.RESEND_API_BASE_URL || RESEND_API_BASE_URL).trim().replace(/\/+$/, '');

    if (!apiKey) {
        throw new Error('Missing RESEND_API_KEY environment variable.');
    }

    if (!from) {
        throw new Error(
            isProductionEnvironment(environment)
                ? 'Missing RESEND_FROM_EMAIL environment variable.'
                : 'Missing RESEND_FROM_EMAIL or RESEND_DEV_FROM_EMAIL environment variable.'
        );
    }

    if (replyTo && !isValidEmailAddress(replyTo)) {
        throw new Error('RESEND_REPLY_TO must be a valid email address.');
    }

    if (devRecipient && !isValidEmailAddress(devRecipient)) {
        throw new Error('RESEND_DEV_TO_EMAIL must be a valid email address.');
    }

    return {
        environment,
        apiKey,
        from,
        replyTo,
        devRecipient: isProductionEnvironment(environment) ? '' : devRecipient,
        apiBaseUrl
    };
}

async function readResponseJson(response) {
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

async function sendEmailWithResend({ to, subject, html, text }) {
    const config = buildEmailConfig();
    const requestedRecipients = normalizeRecipients(to);
    const recipients = config.devRecipient ? [config.devRecipient] : requestedRecipients;
    const payload = {
        from: config.from,
        to: recipients,
        subject: String(subject || '').trim(),
        html: String(html || '').trim(),
        text: String(text || '').trim()
    };

    if (!payload.subject) {
        throw new Error('Email subject is required.');
    }

    if (!payload.html && !payload.text) {
        throw new Error('Email content is required.');
    }

    if (config.replyTo) {
        payload.reply_to = config.replyTo;
    }

    console.info('[email] Sending message with Resend.', {
        environment: config.environment,
        from: config.from,
        to: recipients,
        requestedRecipients: config.devRecipient ? requestedRecipients : undefined,
        reroutedToDevInbox: Boolean(config.devRecipient),
        apiBaseUrl: config.apiBaseUrl,
        apiKeyPreview: redactApiKey(config.apiKey)
    });

    const response = await fetch(`${config.apiBaseUrl}/emails`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await readResponseJson(response);
    if (!response.ok) {
        const errorMessage = data && (data.message || data.error)
            ? String(data.message || data.error)
            : 'Resend could not send the email.';
        const error = new Error(`Resend request failed (${response.status}): ${errorMessage}`);
        error.statusCode = response.status;
        error.response = data;
        error.emailDiagnostics = {
            environment: config.environment,
            from: config.from,
            to: recipients,
            requestedRecipients,
            reroutedToDevInbox: Boolean(config.devRecipient)
        };
        console.error('[email] Resend request failed.', {
            statusCode: response.status,
            error: errorMessage,
            diagnostics: error.emailDiagnostics,
            response: data
        });
        throw error;
    }

    console.info('[email] Resend accepted message.', {
        environment: config.environment,
        emailId: data && data.id ? data.id : '',
        to: recipients,
        reroutedToDevInbox: Boolean(config.devRecipient)
    });

    return {
        ...(data || {}),
        requestedRecipients,
        deliveredRecipients: recipients,
        reroutedToDevInbox: Boolean(config.devRecipient)
    };
}

module.exports = {
    buildEmailConfig,
    sendEmailWithResend
};
