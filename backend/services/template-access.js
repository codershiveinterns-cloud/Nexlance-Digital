const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DEFAULT_CURRENCY } = require('../../billing-catalog.js');
const { completeHostedCheckout, createHostedCheckout } = require('./payments');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'backend', 'data');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'template-access-transactions.json');
const PRIMARY_LICENSE_FILE = path.join(PROJECT_ROOT, 'template_license_key.txt');

const TEMPLATE_DOWNLOAD_SECRET = process.env.TEMPLATE_DOWNLOAD_TOKEN_SECRET
    || process.env.ADMIN_SESSION_SECRET
    || 'replace-this-template-download-secret';
const TEMPLATE_DOWNLOAD_TOKEN_TTL_MS = Number(process.env.TEMPLATE_DOWNLOAD_TOKEN_TTL_MS || 15 * 60 * 1000);

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN || '';
const POLAR_API_BASE_URL = String(process.env.POLAR_API_BASE_URL || '').trim().replace(/\/+$/, '')
    || 'https://api.polar.sh';
const POLAR_TEMPLATE_PRODUCT_ID = process.env.POLAR_TEMPLATE_PRODUCT_ID || '';

const TEMPLATE_PRICE = {
    amount: 19900,
    currency: String(DEFAULT_CURRENCY || 'gbp').trim().toLowerCase() || 'gbp'
};

const TEMPLATE_CATALOG = {
    'cafe-bakery-template': {
        id: 'cafe-bakery-template',
        name: 'Cafe Bakery',
        files: ['cafe-bakery-template.html', 'cafe-bakery-template.css', 'cafe-bakery-template.js']
    },
    'digital-marketing-template': {
        id: 'digital-marketing-template',
        name: 'Digital Marketing',
        files: ['digital-marketing-template.html', 'digital-marketing-template.css', 'digital-marketing-template.js']
    },
    'fashion-store-template': {
        id: 'fashion-store-template',
        name: 'Fashion Store',
        files: ['fashion-store-template.html', 'fashion-store-template.css', 'fashion-store-template.js']
    },
    'fine-dining-template': {
        id: 'fine-dining-template',
        name: 'Fine Dining',
        files: ['fine-dining-template.html', 'fine-dining-template.css', 'fine-dining-template.js']
    },
    'jewelry-luxury-template': {
        id: 'jewelry-luxury-template',
        name: 'Jewelry Luxury',
        files: ['jewelry-luxury-template.html', 'jewelry-luxury-template.css', 'jewelry-luxury-template.js']
    },
    'photographer-template': {
        id: 'photographer-template',
        name: 'Photographer',
        files: ['photographer-template.html', 'photographer-template.css', 'photographer-template.js']
    },
    'startup-landing-template': {
        id: 'startup-landing-template',
        name: 'Startup Landing',
        files: ['startup-landing-template.html', 'startup-landing-template.css', 'startup-landing-template.js']
    },
    'wedding-gallery-template': {
        id: 'wedding-gallery-template',
        name: 'Wedding Gallery',
        files: ['wedding-gallery-template.html', 'wedding-gallery-template.css', 'wedding-gallery-template.js']
    }
};

function ensureDataDir() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (error) {
        if (error && (error.code === 'EROFS' || error.code === 'EPERM' || error.code === 'EACCES')) {
            return false;
        }
        throw error;
    }
    return true;
}

function isReadonlyFilesystemError(error) {
    return Boolean(error && (error.code === 'EROFS' || error.code === 'EPERM' || error.code === 'EACCES'));
}

function normalizeTemplateId(value) {
    const templateId = String(value || '').trim().toLowerCase();
    if (!templateId) return 'startup-landing-template';
    if (!TEMPLATE_CATALOG[templateId]) {
        throw new Error('Unknown template selected.');
    }
    return templateId;
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeLicenseKey(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function base64UrlEncode(value) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
    const normalized = String(value || '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function signValue(value) {
    return crypto
        .createHmac('sha256', TEMPLATE_DOWNLOAD_SECRET)
        .update(value)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function issueDownloadToken(payload) {
    const tokenPayload = {
        templateId: normalizeTemplateId(payload.templateId),
        email: normalizeEmail(payload.email),
        name: normalizeName(payload.name),
        provider: String(payload.provider || 'license'),
        referenceId: String(payload.referenceId || ''),
        issuedAt: Date.now(),
        expiresAt: Date.now() + TEMPLATE_DOWNLOAD_TOKEN_TTL_MS,
        nonce: crypto.randomBytes(12).toString('hex')
    };
    const encoded = base64UrlEncode(JSON.stringify(tokenPayload));
    return `${encoded}.${signValue(encoded)}`;
}

function verifyDownloadToken(token) {
    const rawToken = String(token || '').trim();
    const dotIndex = rawToken.lastIndexOf('.');
    if (dotIndex === -1) {
        throw new Error('Missing download token signature.');
    }

    const encodedPayload = rawToken.slice(0, dotIndex);
    const signature = rawToken.slice(dotIndex + 1);
    const expected = signValue(encodedPayload);

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
        throw new Error('Invalid download token signature.');
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload.expiresAt || Number(payload.expiresAt) < Date.now()) {
        throw new Error('Download token has expired.');
    }

    payload.templateId = normalizeTemplateId(payload.templateId);
    payload.email = normalizeEmail(payload.email);
    payload.name = normalizeName(payload.name);
    return payload;
}

function parseLicenseRecordLine(line, lineIndex, sourceFile) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('|')) {
        return null;
    }

    const parts = trimmed.split('|').map(part => part.trim());
    const firstColumn = String(parts[0] || '').trim().toLowerCase();
    if (firstColumn === 'template_id' || firstColumn === 'template id' || firstColumn === 'template name') {
        return null;
    }

    if (sourceFile === PRIMARY_LICENSE_FILE && parts.length >= 3) {
        return {
            sourceFile,
            lineIndex,
            format: 'simple',
            templateId: String(parts[0] || '').trim(),
            licenseKey: normalizeLicenseKey(parts[1]),
            status: String(parts[2] || 'active').trim().toLowerCase(),
            issuedToEmail: normalizeEmail(parts[3] || ''),
            usedByEmail: normalizeEmail(parts[4] || ''),
            createdAt: String(parts[5] || '').trim(),
            usedAt: String(parts[6] || '').trim()
        };
    }

    return null;
}

function loadLicenseRecords() {
    const records = [];
    if (!fs.existsSync(PRIMARY_LICENSE_FILE)) {
        return records;
    }

    const lines = fs.readFileSync(PRIMARY_LICENSE_FILE, 'utf8').split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
        const record = parseLicenseRecordLine(line, lineIndex, PRIMARY_LICENSE_FILE);
        if (record && record.licenseKey) {
            records.push(record);
        }
    });

    return records;
}

function serializeLicenseRecord(record) {
    return [
        record.templateId,
        record.licenseKey,
        record.status,
        record.issuedToEmail || '',
        record.usedByEmail || '',
        record.createdAt || '',
        record.usedAt || ''
    ].join(' | ');
}

function updateLicenseRecord(recordToPersist) {
    const filePath = recordToPersist.sourceFile;
    if (!filePath || !fs.existsSync(filePath)) {
        return;
    }
    try {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
        lines[recordToPersist.lineIndex] = serializeLicenseRecord(recordToPersist);
        fs.writeFileSync(filePath, lines.join('\n'));
    } catch (error) {
        if (isReadonlyFilesystemError(error)) {
            return;
        }
        throw error;
    }
}

function validateLicenseAccess(options) {
    const email = normalizeEmail(options.email);
    const templateId = normalizeTemplateId(options.templateId);
    const normalizedKey = normalizeLicenseKey(options.licenseKey);

    if (!normalizedKey) {
        throw new Error('License key is required.');
    }

    const record = loadLicenseRecords().find(item => item.licenseKey === normalizedKey);
    if (!record) {
        throw new Error('License key is invalid.');
    }

    if (record.templateId && record.templateId !== templateId) {
        throw new Error('This license key does not match the selected template.');
    }

    if (!['active', 'used'].includes(record.status)) {
        throw new Error('This license key is not active.');
    }

    if (record.status === 'used' && record.usedByEmail && record.usedByEmail !== email) {
        throw new Error('This license key has already been redeemed by another email address.');
    }

    if (record.status === 'active') {
        record.status = 'used';
        record.usedByEmail = email;
        record.usedAt = new Date().toISOString();
        updateLicenseRecord(record);
    }

    return {
        templateId,
        templateName: TEMPLATE_CATALOG[templateId].name,
        licenseKey: normalizedKey
    };
}

function readTransactions() {
    if (!ensureDataDir()) {
        return [];
    }
    if (!fs.existsSync(TRANSACTIONS_PATH)) {
        return [];
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(TRANSACTIONS_PATH, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function writeTransactions(transactions) {
    if (!ensureDataDir()) {
        return false;
    }
    try {
        fs.writeFileSync(TRANSACTIONS_PATH, JSON.stringify(transactions, null, 2));
        return true;
    } catch (error) {
        if (isReadonlyFilesystemError(error)) {
            return false;
        }
        throw error;
    }
}

function upsertTransaction(entry) {
    const transactions = readTransactions();
    const transactionId = String(entry.transactionId || '').trim()
        || `${entry.provider}:${entry.referenceId}:${entry.email}:${entry.templateId}`;
    const normalizedTemplateId = normalizeTemplateId(entry.templateId);
    const normalizedEntry = {
        transactionId,
        provider: String(entry.provider || 'license'),
        referenceId: String(entry.referenceId || ''),
        status: String(entry.status || 'pending'),
        amount: Number(entry.amount || 0),
        currency: String(entry.currency || TEMPLATE_PRICE.currency).toUpperCase(),
        templateId: normalizedTemplateId,
        templateName: TEMPLATE_CATALOG[normalizedTemplateId].name,
        email: normalizeEmail(entry.email),
        customerName: normalizeName(entry.customerName),
        metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
        updatedAt: new Date().toISOString()
    };

    const existingIndex = transactions.findIndex(item => item.transactionId === transactionId);
    if (existingIndex >= 0) {
        normalizedEntry.createdAt = transactions[existingIndex].createdAt || normalizedEntry.updatedAt;
        transactions[existingIndex] = Object.assign({}, transactions[existingIndex], normalizedEntry);
    } else {
        normalizedEntry.createdAt = normalizedEntry.updatedAt;
        transactions.push(normalizedEntry);
    }

    writeTransactions(transactions);
    return normalizedEntry;
}

function getTemplateAccessContext(input) {
    const templateId = normalizeTemplateId(input.templateId);
    const customerName = normalizeName(input.name);
    const email = normalizeEmail(input.email);

    if (!customerName) {
        throw new Error('Name is required.');
    }
    if (!email || !isValidEmail(email)) {
        throw new Error('Enter a valid email address.');
    }

    return {
        templateId,
        templateName: TEMPLATE_CATALOG[templateId].name,
        customerName,
        email
    };
}

function sanitizeBaseUrl(value) {
    const candidate = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(candidate)) {
        throw new Error('A valid site URL is required to start checkout.');
    }
    return candidate;
}

function extractPolarErrorMessage(data, fallbackMessage) {
    if (!data) return fallbackMessage;
    if (typeof data.detail === 'string' && data.detail.trim()) {
        return data.detail.trim();
    }
    if (Array.isArray(data.detail) && data.detail.length) {
        const messages = data.detail
            .map(item => {
                if (typeof item === 'string') return item.trim();
                if (item && typeof item.msg === 'string') return item.msg.trim();
                if (item && typeof item.message === 'string') return item.message.trim();
                return '';
            })
            .filter(Boolean);
        if (messages.length) {
            return messages.join(' ');
        }
    }
    if (data.error && typeof data.error === 'string') {
        return data.error.trim();
    }
    if (data.message && typeof data.message === 'string') {
        return data.message.trim();
    }
    return fallbackMessage;
}

function buildReturnUrls(baseUrl, templateId, provider) {
    const escapedTemplateId = encodeURIComponent(templateId);
    return {
        successUrl: `${baseUrl}/index.html?template=${escapedTemplateId}&template_access=success&provider=${encodeURIComponent(provider)}&session_id={CHECKOUT_SESSION_ID}#template-access`,
        cancelUrl: `${baseUrl}/index.html?template=${escapedTemplateId}&template_access=cancelled&provider=${encodeURIComponent(provider)}#template-access`,
        polarSuccessUrl: `${baseUrl}/index.html?template=${escapedTemplateId}&template_access=success&provider=${encodeURIComponent(provider)}&checkout_id={CHECKOUT_ID}#template-access`
    };
}

async function createStripeTemplateCheckout(options) {
    if (!STRIPE_SECRET_KEY) {
        throw new Error('Set STRIPE_SECRET_KEY before using Stripe checkout.');
    }

    const context = getTemplateAccessContext(options);
    const baseUrl = sanitizeBaseUrl(options.siteBaseUrl);
    const urls = buildReturnUrls(baseUrl, context.templateId, 'stripe');

    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', urls.successUrl);
    params.set('cancel_url', urls.cancelUrl);
    params.set('customer_email', context.email);
    params.set('client_reference_id', context.email);
    params.set('metadata[flow]', 'template_download');
    params.set('metadata[template_id]', context.templateId);
    params.set('metadata[template_name]', context.templateName);
    params.set('metadata[customer_name]', context.customerName);
    params.set('metadata[customer_email]', context.email);
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', TEMPLATE_PRICE.currency);
    params.set('line_items[0][price_data][unit_amount]', String(TEMPLATE_PRICE.amount));
    params.set('line_items[0][price_data][product_data][name]', `Nexlance Template - ${context.templateName}`);
    params.set('line_items[0][price_data][product_data][description]', `Protected template download for ${context.templateName}.`);

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : 'Stripe checkout session could not be created.';
        throw new Error(message);
    }

    upsertTransaction({
        transactionId: `stripe:${data.id}`,
        provider: 'stripe',
        referenceId: data.id,
        status: 'pending',
        amount: TEMPLATE_PRICE.amount / 100,
        currency: TEMPLATE_PRICE.currency,
        templateId: context.templateId,
        email: context.email,
        customerName: context.customerName,
        metadata: {
            checkoutUrl: data.url || '',
            paymentStatus: data.payment_status || '',
            templateName: context.templateName
        }
    });

    return {
        provider: 'stripe',
        redirectUrl: data.url,
        sessionId: data.id,
        templateId: context.templateId,
        templateName: context.templateName
    };
}

async function createPolarTemplateCheckout(options) {
    if (!POLAR_ACCESS_TOKEN) {
        throw new Error('Set POLAR_ACCESS_TOKEN before using Polar checkout.');
    }
    if (!POLAR_TEMPLATE_PRODUCT_ID) {
        throw new Error('Set POLAR_TEMPLATE_PRODUCT_ID before using Polar checkout.');
    }

    const context = getTemplateAccessContext(options);
    const baseUrl = sanitizeBaseUrl(options.siteBaseUrl);
    const urls = buildReturnUrls(baseUrl, context.templateId, 'polar');

    const response = await fetch(`${POLAR_API_BASE_URL}/v1/checkouts`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            products: [POLAR_TEMPLATE_PRODUCT_ID],
            customer_name: context.customerName,
            customer_email: context.email,
            external_customer_id: context.email,
            locale: 'en',
            metadata: {
                flow: 'template_download',
                template_id: context.templateId,
                template_name: context.templateName,
                customer_name: context.customerName,
                customer_email: context.email
            },
            success_url: urls.polarSuccessUrl,
            return_url: urls.cancelUrl
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(extractPolarErrorMessage(data, 'Polar checkout session could not be created.'));
    }

    upsertTransaction({
        transactionId: `polar:${data.id}`,
        provider: 'polar',
        referenceId: data.id,
        status: 'pending',
        amount: Number(data.total_amount || TEMPLATE_PRICE.amount) / 100,
        currency: data.currency || TEMPLATE_PRICE.currency,
        templateId: context.templateId,
        email: context.email,
        customerName: context.customerName,
        metadata: {
            checkoutUrl: data.url || '',
            checkoutStatus: data.status || '',
            templateName: context.templateName
        }
    });

    return {
        provider: 'polar',
        redirectUrl: data.url,
        checkoutId: data.id,
        templateId: context.templateId,
        templateName: context.templateName
    };
}

async function startTemplateAccess(options) {
    const context = getTemplateAccessContext(options);
    const paymentMethod = String(options.paymentMethod || '').trim().toLowerCase();
    const licenseKey = normalizeLicenseKey(options.licenseKey);

    if (licenseKey) {
        const license = validateLicenseAccess({
            templateId: context.templateId,
            email: context.email,
            licenseKey
        });
        const referenceId = `license:${license.licenseKey}`;

        upsertTransaction({
            transactionId: referenceId,
            provider: 'license',
            referenceId: license.licenseKey,
            status: 'succeeded',
            amount: 0,
            currency: TEMPLATE_PRICE.currency,
            templateId: license.templateId,
            email: context.email,
            customerName: context.customerName,
            metadata: {
                licenseKey: license.licenseKey,
                templateName: license.templateName
            }
        });

        return {
            mode: 'license',
            provider: 'license',
            templateId: license.templateId,
            templateName: license.templateName,
            redirectUrl: `/projects.html?template=${encodeURIComponent(license.templateId)}&template_source=license`
        };
    }

    if (!paymentMethod) {
        throw new Error('Choose Stripe or Polar, or enter a valid license key.');
    }

    if (paymentMethod === 'stripe') {
        const payload = await createHostedCheckout({
            productCode: 'single_template',
            provider: 'stripe',
            userEmail: context.email,
            userName: context.customerName,
            templateId: context.templateId,
            templateName: context.templateName,
            siteBaseUrl: options.siteBaseUrl
        });
        return Object.assign({ mode: 'payment' }, payload);
    }

    if (paymentMethod === 'polar') {
        const payload = await createHostedCheckout({
            productCode: 'single_template',
            provider: 'polar',
            userEmail: context.email,
            userName: context.customerName,
            templateId: context.templateId,
            templateName: context.templateName,
            siteBaseUrl: options.siteBaseUrl
        });
        return Object.assign({ mode: 'payment' }, payload);
    }

    throw new Error('Unsupported payment method selected.');
}

async function fetchStripeCheckoutSession(sessionId) {
    if (!STRIPE_SECRET_KEY) {
        throw new Error('Set STRIPE_SECRET_KEY before verifying Stripe checkout.');
    }

    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`
        }
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : 'Could not verify Stripe checkout session.';
        throw new Error(message);
    }

    return data;
}

async function fetchPolarCheckoutSession(checkoutId) {
    if (!POLAR_ACCESS_TOKEN) {
        throw new Error('Set POLAR_ACCESS_TOKEN before verifying Polar checkout.');
    }

    const response = await fetch(`${POLAR_API_BASE_URL}/v1/checkouts/${encodeURIComponent(checkoutId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`
        }
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data && data.detail ? data.detail : 'Could not verify Polar checkout session.';
        throw new Error(typeof message === 'string' ? message : 'Could not verify Polar checkout session.');
    }

    return data;
}

async function completeTemplateAccess(options) {
    const provider = String(options.provider || '').trim().toLowerCase();

    if (provider === 'stripe') {
        const payload = await completeHostedCheckout({
            provider: 'stripe',
            sessionId: String(options.sessionId || '').trim()
        });
        const templateId = normalizeTemplateId(payload.templateId || options.templateId);
        const email = normalizeEmail(payload.userEmail || '');
        const name = normalizeName(payload.result && payload.result.userRecord && payload.result.userRecord.name || email.split('@')[0]);

        upsertTransaction({
            transactionId: `stripe:${String(options.sessionId || '').trim()}`,
            provider: 'stripe',
            referenceId: String(options.sessionId || '').trim(),
            status: 'succeeded',
            amount: TEMPLATE_PRICE.amount / 100,
            currency: TEMPLATE_PRICE.currency,
            templateId,
            email,
            customerName: name,
            metadata: {
                templateName: TEMPLATE_CATALOG[templateId].name
            }
        });

        const token = issueDownloadToken({
            templateId,
            email,
            name,
            provider: 'stripe',
            referenceId: String(options.sessionId || '').trim()
        });

        return {
            provider: 'stripe',
            templateId,
            templateName: TEMPLATE_CATALOG[templateId].name,
            downloadUrl: `/api/template-download?token=${encodeURIComponent(token)}`
        };
    }

    if (provider === 'polar') {
        const payload = await completeHostedCheckout({
            provider: 'polar',
            checkoutId: String(options.checkoutId || '').trim()
        });
        const templateId = normalizeTemplateId(payload.templateId || options.templateId);
        const email = normalizeEmail(payload.userEmail || '');
        const name = normalizeName(payload.result && payload.result.userRecord && payload.result.userRecord.name || email.split('@')[0]);

        upsertTransaction({
            transactionId: `polar:${String(options.checkoutId || '').trim()}`,
            provider: 'polar',
            referenceId: String(options.checkoutId || '').trim(),
            status: 'succeeded',
            amount: TEMPLATE_PRICE.amount / 100,
            currency: TEMPLATE_PRICE.currency,
            templateId,
            email,
            customerName: name,
            metadata: {
                templateName: TEMPLATE_CATALOG[templateId].name
            }
        });

        const token = issueDownloadToken({
            templateId,
            email,
            name,
            provider: 'polar',
            referenceId: String(options.checkoutId || '').trim()
        });

        return {
            provider: 'polar',
            templateId,
            templateName: TEMPLATE_CATALOG[templateId].name,
            downloadUrl: `/api/template-download?token=${encodeURIComponent(token)}`
        };
    }

    throw new Error('Unsupported payment provider.');
}

function normalizeAssetReference(reference) {
    const cleaned = String(reference || '')
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\\/g, '/');

    if (!cleaned || /^(data:|https?:|\/\/|#)/i.test(cleaned)) {
        return '';
    }

    return cleaned.replace(/^\.?\//, '');
}

function collectAssetPaths(template) {
    const textExtensions = new Set(['.html', '.css', '.js']);
    const assetPaths = new Set(template.files);

    template.files.forEach(relativeFile => {
        const absolutePath = path.join(PROJECT_ROOT, relativeFile);
        if (!fs.existsSync(absolutePath)) {
            return;
        }

        const extension = path.extname(relativeFile).toLowerCase();
        if (!textExtensions.has(extension)) {
            return;
        }

        const content = fs.readFileSync(absolutePath, 'utf8');
        const matches = [
            ...content.matchAll(/(?:src|href)=["']([^"']+)["']/gi),
            ...content.matchAll(/url\(([^)]+)\)/gi)
        ];

        matches.forEach(match => {
            const normalized = normalizeAssetReference(match[1]);
            if (!normalized) return;

            const absoluteReferencedPath = path.normalize(path.join(PROJECT_ROOT, normalized));
            if (!absoluteReferencedPath.startsWith(PROJECT_ROOT) || !fs.existsSync(absoluteReferencedPath)) {
                return;
            }

            assetPaths.add(normalized);
        });
    });

    return Array.from(assetPaths);
}

function crc32(buffer) {
    let crc = 0 ^ -1;
    for (let i = 0; i < buffer.length; i += 1) {
        crc ^= buffer[i];
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
        }
    }
    return (crc ^ -1) >>> 0;
}

function getDosDateTime(date) {
    const target = date instanceof Date ? date : new Date();
    const year = Math.max(1980, target.getFullYear());
    const dosTime = ((target.getHours() & 0x1F) << 11)
        | ((target.getMinutes() & 0x3F) << 5)
        | Math.floor((target.getSeconds() || 0) / 2);
    const dosDate = (((year - 1980) & 0x7F) << 9)
        | (((target.getMonth() + 1) & 0x0F) << 5)
        | (target.getDate() & 0x1F);
    return { dosDate, dosTime };
}

function createStoredZip(entries) {
    const localFileParts = [];
    const centralDirectoryParts = [];
    let offset = 0;

    entries.forEach(entry => {
        const nameBuffer = Buffer.from(entry.name.replace(/\\/g, '/'));
        const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const { dosDate, dosTime } = getDosDateTime(entry.modifiedAt);
        const entryCrc32 = crc32(dataBuffer);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(dosTime, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(entryCrc32, 14);
        localHeader.writeUInt32LE(dataBuffer.length, 18);
        localHeader.writeUInt32LE(dataBuffer.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localFileParts.push(localHeader, nameBuffer, dataBuffer);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(dosTime, 12);
        centralHeader.writeUInt16LE(dosDate, 14);
        centralHeader.writeUInt32LE(entryCrc32, 16);
        centralHeader.writeUInt32LE(dataBuffer.length, 20);
        centralHeader.writeUInt32LE(dataBuffer.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralDirectoryParts.push(centralHeader, nameBuffer);
        offset += localHeader.length + nameBuffer.length + dataBuffer.length;
    });

    const centralDirectory = Buffer.concat(centralDirectoryParts);
    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
    endOfCentralDirectory.writeUInt16LE(0, 4);
    endOfCentralDirectory.writeUInt16LE(0, 6);
    endOfCentralDirectory.writeUInt16LE(entries.length, 8);
    endOfCentralDirectory.writeUInt16LE(entries.length, 10);
    endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
    endOfCentralDirectory.writeUInt32LE(offset, 16);
    endOfCentralDirectory.writeUInt16LE(0, 20);

    return Buffer.concat([...localFileParts, centralDirectory, endOfCentralDirectory]);
}

function buildTemplateZipBundle(templateId, requestedBy) {
    const normalizedTemplateId = normalizeTemplateId(templateId);
    const template = TEMPLATE_CATALOG[normalizedTemplateId];
    const assetPaths = collectAssetPaths(template);

    const manifest = {
        templateId: normalizedTemplateId,
        templateName: template.name,
        generatedAt: new Date().toISOString(),
        requestedBy: normalizeEmail(requestedBy),
        includedFiles: assetPaths
    };

    const entries = assetPaths.map(relativePath => {
        const absolutePath = path.join(PROJECT_ROOT, relativePath);
        return {
            name: relativePath.replace(/\\/g, '/'),
            data: fs.readFileSync(absolutePath),
            modifiedAt: fs.statSync(absolutePath).mtime
        };
    });

    entries.push({
        name: 'README.txt',
        data: Buffer.from(
            `Nexlance template download\nTemplate: ${template.name}\nRequested by: ${normalizeEmail(requestedBy)}\nGenerated at: ${manifest.generatedAt}\n`,
            'utf8'
        ),
        modifiedAt: new Date()
    });

    entries.push({
        name: 'manifest.json',
        data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
        modifiedAt: new Date()
    });

    return {
        fileName: `${normalizedTemplateId}.zip`,
        buffer: createStoredZip(entries)
    };
}

function renderDownloadErrorPage(message) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Template Download Error</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px; }
    .card { max-width: 560px; margin: 6vh auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12); }
    h1 { margin-top: 0; }
    p { line-height: 1.6; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Download unavailable</h1>
    <p>${escapeHtml(message)}</p>
    <p>Go back to the checkout form and request a new download link if needed.</p>
  </div>
</body>
</html>`;
}

module.exports = {
    TEMPLATE_CATALOG,
    TEMPLATE_PRICE,
    buildTemplateZipBundle,
    completeTemplateAccess,
    issueDownloadToken,
    renderDownloadErrorPage,
    startTemplateAccess,
    verifyDownloadToken
};
