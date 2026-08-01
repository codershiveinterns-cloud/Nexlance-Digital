const crypto = require('crypto');

const { DEFAULT_CURRENCY, isSingleTemplateProduct } = require('../../billing-catalog.js');
const {
    findUserDocumentByEmail,
    getWebhookEvent,
    upsertWebhookEvent
} = require('./firebase-service');
const {
    buildCheckoutUrls,
    buildMetadata,
    buildPayloadHash,
    fulfillPurchase
} = require('./payments');
const {
    getCodaMerchantByCountry,
    isKnownCodaMerchantForCountry,
    normalizeMerchantId
} = require('./coda-merchants');
const {
    resolveIso3166NumericCode,
    resolveIso4217NumericCode
} = require('./coda-iso-codes');
const { getCodaSkuForProduct, resolveCodaSku } = require('./coda-skus');

const JSON_RPC_VERSION = '2.0';
const DEFAULT_SIGNATURE_SCHEME = 'header-hmac-sha256';
const SIGNATURE_HEADER_NAMES = [
    'x-coda-signature',
    'x-codapay-signature',
    'coda-signature',
    'signature',
    'authorization'
];
const TIMESTAMP_HEADER_NAMES = [
    'x-coda-timestamp',
    'x-codapay-timestamp',
    'coda-timestamp',
    'timestamp'
];
const SIGNATURE_TOLERANCE_SECONDS = 300;
const DEFAULT_INIT_API_BASE_URL = 'https://airtime.codapayments.com/airtime/api/restful/v1.0/Payment';

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getEnvSecret() {
    return String(process.env.CODA_SECRET_KEY || process.env.CODA_SHARED_SECRET || '').trim();
}

function getSignatureScheme() {
    return String(process.env.CODA_SIGNATURE_SCHEME || DEFAULT_SIGNATURE_SCHEME).trim().toLowerCase();
}

function getHeader(headers, names) {
    const source = headers || {};
    for (const name of names) {
        const direct = source[name];
        const lower = source[String(name).toLowerCase()];
        const upper = source[String(name).toUpperCase()];
        const value = direct !== undefined ? direct : lower !== undefined ? lower : upper;
        if (Array.isArray(value) && value.length) return String(value[0] || '').trim();
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
}

function stripSignatureDecorations(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (/^sha256=/i.test(normalized)) return normalized.replace(/^sha256=/i, '').trim();
    if (/^hmac-sha256=/i.test(normalized)) return normalized.replace(/^hmac-sha256=/i, '').trim();
    if (/^bearer\s+/i.test(normalized)) return normalized.replace(/^bearer\s+/i, '').trim();
    return normalized;
}

function safeCompareStrings(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function matchesSignature(candidate, expectedHex, expectedBase64) {
    const normalizedCandidate = stripSignatureDecorations(candidate);
    if (!normalizedCandidate) return false;
    return safeCompareStrings(normalizedCandidate, expectedHex)
        || safeCompareStrings(normalizedCandidate, expectedBase64);
}

function generateCodaSignature(rawBody, secret = getEnvSecret(), options = {}) {
    const scheme = String(options.scheme || getSignatureScheme()).trim().toLowerCase();
    const timestamp = String(options.timestamp || '').trim();
    const payload = String(rawBody || '');
    const signedPayload = scheme === 'timestamped-hmac-sha256'
        ? `${timestamp}.${payload}`
        : payload;

    const digest = crypto.createHmac('sha256', secret).update(signedPayload).digest();
    return {
        hex: digest.toString('hex'),
        base64: digest.toString('base64')
    };
}

function verifyTimestamp(timestamp) {
    const numeric = Number(timestamp || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error('Missing Coda signature timestamp.');
    }

    const timestampSeconds = numeric > 100000000000 ? numeric / 1000 : numeric;
    const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
    if (!Number.isFinite(ageSeconds) || ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
        throw new Error('Coda signature timestamp has expired.');
    }
}

function verifyCodaSignature(rawBody, headers = {}) {
    const scheme = getSignatureScheme();
    const allowUnsigned = String(process.env.CODA_ALLOW_UNSIGNED_WEBHOOKS || '').trim().toLowerCase() === 'true';
    if (scheme === 'disabled') {
        if (process.env.NODE_ENV === 'production' || !allowUnsigned) {
            throw new Error('Coda signature verification cannot be disabled in this environment.');
        }
        return true;
    }

    const secret = getEnvSecret();
    if (!secret) {
        throw new Error('Set CODA_SECRET_KEY before using Coda endpoints.');
    }

    const signatureHeader = getHeader(headers, SIGNATURE_HEADER_NAMES);
    if (!signatureHeader) {
        throw new Error('Missing Coda signature.');
    }

    const timestamp = getHeader(headers, TIMESTAMP_HEADER_NAMES);
    if (scheme === 'timestamped-hmac-sha256') {
        verifyTimestamp(timestamp);
    } else if (scheme !== DEFAULT_SIGNATURE_SCHEME) {
        throw new Error(`Unsupported Coda signature scheme: ${scheme}.`);
    }

    const expected = generateCodaSignature(rawBody, secret, { scheme, timestamp });
    const candidates = signatureHeader.split(',').map(entry => entry.trim()).filter(Boolean);
    const matched = candidates.some(candidate => matchesSignature(candidate, expected.hex, expected.base64));
    if (!matched) {
        throw new Error('Coda signature verification failed.');
    }

    return true;
}

function buildCodaJsonRpcResult(id, result) {
    return {
        id: id === undefined ? null : id,
        jsonrpc: JSON_RPC_VERSION,
        result
    };
}

function buildCodaJsonRpcError(id, code, message, data) {
    const error = {
        code: Number(code || -32000),
        message: String(message || 'Coda request failed.')
    };
    if (data !== undefined) {
        error.data = data;
    }
    return {
        id: id === undefined ? null : id,
        jsonrpc: JSON_RPC_VERSION,
        error
    };
}

function parseCodaJsonRpc(rawBody) {
    let parsed;
    try {
        parsed = JSON.parse(String(rawBody || ''));
    } catch (error) {
        throw Object.assign(new Error('Invalid JSON-RPC payload.'), { jsonRpcCode: -32700 });
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw Object.assign(new Error('Invalid JSON-RPC request.'), { jsonRpcCode: -32600 });
    }

    if (parsed.jsonrpc && String(parsed.jsonrpc) !== JSON_RPC_VERSION) {
        throw Object.assign(new Error('Unsupported JSON-RPC version.'), { jsonRpcCode: -32600, jsonRpcId: parsed.id });
    }

    const params = parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params)
        ? parsed.params
        : {};

    return {
        id: parsed.id === undefined ? null : parsed.id,
        jsonrpc: parsed.jsonrpc || JSON_RPC_VERSION,
        method: String(parsed.method || '').trim(),
        params,
        raw: parsed
    };
}

function firstString(source, keys) {
    for (const key of keys) {
        const value = source && source[key];
        if (value !== undefined && value !== null && String(value).trim()) {
            return String(value).trim();
        }
    }
    return '';
}

function normalizeCodaParams(params = {}) {
    const nestedUser = params.user && typeof params.user === 'object' ? params.user : {};
    const nestedProduct = params.product && typeof params.product === 'object' ? params.product : {};
    const nestedPayment = params.payment && typeof params.payment === 'object' ? params.payment : {};
    const source = {
        ...params,
        ...nestedUser,
        ...nestedProduct,
        ...nestedPayment
    };

    return {
        merchantId: normalizeMerchantId(firstString(source, ['merchant_id', 'merchantId', 'merchant'])),
        sku: firstString(source, ['sku', 'sku_id', 'skuId', 'product_id', 'productId', 'item_id', 'itemId']),
        userId: firstString(source, ['user_id', 'userId', 'uid', 'userid', 'customer_id', 'customerId']),
        userEmail: normalizeEmail(firstString(source, ['user_email', 'userEmail', 'email', 'customer_email', 'customerEmail'])),
        userName: normalizeName(firstString(source, ['user_name', 'userName', 'name', 'customer_name', 'customerName'])),
        country: firstString(source, ['country', 'country_code', 'countryCode']),
        currency: firstString(source, ['currency', 'currency_code', 'currencyCode']),
        amount: source.amount !== undefined ? source.amount
            : source.price !== undefined ? source.price
                : source.total_amount !== undefined ? source.total_amount
                    : source.totalAmount,
        txnId: firstString(source, ['txnId', 'txn_id', 'transaction_id', 'transactionId', 'coda_txn_id', 'codaTxnId']),
        orderId: firstString(source, ['orderId', 'order_id']),
        merchantTransactionId: firstString(source, ['merchantTransactionId', 'merchant_transaction_id', 'merchantTxnId', 'merchant_txn_id']),
        templateId: firstString(source, ['templateId', 'template_id']).toLowerCase(),
        templateName: firstString(source, ['templateName', 'template_name']),
        siteBaseUrl: firstString(source, ['siteBaseUrl', 'site_base_url', 'baseUrl', 'base_url']),
        rawParams: params
    };
}

function normalizeAmountToMinorUnits(value) {
    if (value === undefined || value === null || value === '') return NaN;
    const raw = String(value).trim();
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) return NaN;

    if (raw.includes('.') || (!Number.isInteger(numeric))) {
        return Math.round(numeric * 100);
    }

    return Math.round(numeric);
}

function validateMerchant(normalized) {
    if (!normalized.country || !normalized.merchantId) {
        throw Object.assign(new Error('Coda country and merchant are required.'), { jsonRpcCode: -32002 });
    }

    const merchant = getCodaMerchantByCountry(normalized.country);
    if (!merchant) {
        throw Object.assign(new Error('Unknown Coda country.'), { jsonRpcCode: -32002 });
    }

    if (merchant.merchantId !== normalized.merchantId) {
        throw Object.assign(new Error('Coda merchant does not match the requested country.'), { jsonRpcCode: -32002 });
    }

    if (!isKnownCodaMerchantForCountry(merchant.merchantId, normalized.country)) {
        throw Object.assign(new Error('Coda merchant country is not supported.'), { jsonRpcCode: -32002 });
    }

    return merchant;
}

function validateProductAndAmount(normalized) {
    const skuResolution = resolveCodaSku(normalized.sku);
    if (!skuResolution) {
        throw Object.assign(new Error('Invalid Coda SKU.'), { jsonRpcCode: -32003 });
    }

    const expectedCurrency = String(skuResolution.product.currency || DEFAULT_CURRENCY).trim().toUpperCase();
    const providedCurrency = String(normalized.currency || expectedCurrency).trim().toUpperCase();
    if (!providedCurrency || providedCurrency !== expectedCurrency) {
        throw Object.assign(new Error('Coda currency does not match the product catalog.'), { jsonRpcCode: -32005 });
    }

    const amountMinorUnits = normalizeAmountToMinorUnits(normalized.amount);
    if (!Number.isFinite(amountMinorUnits) || amountMinorUnits !== Number(skuResolution.product.price)) {
        throw Object.assign(new Error('Coda amount does not match the product catalog.'), { jsonRpcCode: -32005 });
    }

    if (isSingleTemplateProduct(skuResolution.productCode) && !normalized.templateId) {
        throw Object.assign(new Error('Template ID is required for Coda single-template purchases.'), { jsonRpcCode: -32602 });
    }

    return {
        ...skuResolution,
        currency: expectedCurrency,
        amountMinorUnits
    };
}

async function validateUser(normalized) {
    const userEmail = normalized.userEmail || (isValidEmail(normalized.userId) ? normalizeEmail(normalized.userId) : '');
    if (!userEmail || !isValidEmail(userEmail)) {
        throw Object.assign(new Error('A valid Nexlance user email is required.'), { jsonRpcCode: -32004 });
    }

    const userDoc = await findUserDocumentByEmail(userEmail);
    if (!userDoc) {
        throw Object.assign(new Error('Nexlance user was not found.'), { jsonRpcCode: -32004 });
    }

    return {
        userEmail,
        userName: normalized.userName || normalizeName(userDoc.data.name || userDoc.data.displayName || userDoc.data.businessName || userEmail.split('@')[0]),
        userDoc
    };
}

async function validateCodaTransaction(normalized) {
    const merchant = validateMerchant(normalized);
    const productResolution = validateProductAndAmount(normalized);
    const user = await validateUser(normalized);

    return {
        merchant,
        ...productResolution,
        ...user
    };
}

function getCodaInitApiUrl() {
    const configuredUrl = String(process.env.CODA_PAYMENT_INIT_API_URL || process.env.CODA_INIT_API_URL || '').trim();
    if (configuredUrl) return configuredUrl;

    const baseUrl = String(process.env.CODA_API_BASE_URL || DEFAULT_INIT_API_BASE_URL).trim().replace(/\/+$/, '');
    return `${baseUrl}/init.json`;
}

function getCodaApiKey() {
    return String(
        process.env.CODA_API_KEY
        || process.env.CODA_PRODUCTION_API_KEY
        || process.env.CODA_SANDBOX_API_KEY
        || ''
    ).trim();
}

function getCodaInitMerchant(context = {}) {
    const country = String(context.codaCountry || context.country || process.env.CODA_DEFAULT_COUNTRY || '').trim();
    const merchantId = normalizeMerchantId(context.codaMerchantId || context.merchantId || process.env.CODA_MERCHANT_ID || '');

    if (country) {
        const merchant = getCodaMerchantByCountry(country);
        if (!merchant) {
            throw new Error('Unknown Coda country.');
        }
        if (merchantId && merchant.merchantId !== merchantId) {
            throw new Error('Coda merchant does not match the requested country.');
        }
        return merchant;
    }

    if (!merchantId) {
        throw new Error('Set CODA_DEFAULT_COUNTRY or CODA_MERCHANT_ID before using Coda checkout.');
    }

    return { merchantId, country: '' };
}

function getCodaInitResult(data) {
    if (!data || typeof data !== 'object') return {};
    if (data.initResult && typeof data.initResult === 'object') return data.initResult;
    if (data.result && data.result.initResult && typeof data.result.initResult === 'object') return data.result.initResult;
    if (data.result && typeof data.result === 'object') return data.result;
    return data;
}

function getCodaResponseErrorMessage(data) {
    if (!data || typeof data !== 'object') return '';
    if (data.error && typeof data.error === 'string') return data.error.trim();
    if (data.error && data.error.message) return String(data.error.message).trim();
    if (data.message) return String(data.message).trim();
    if (data.result && data.result.message) return String(data.result.message).trim();
    return '';
}

function buildCodaInitError(initResult, data, responseStatus) {
    const resultCode = initResult && initResult.resultCode !== undefined ? Number(initResult.resultCode) : 0;
    const resultDesc = String(initResult && initResult.resultDesc ? initResult.resultDesc : '').trim();
    const error = new Error('Coda checkout initialization failed.');
    error.provider = 'coda';
    error.resultCode = Number.isFinite(resultCode) ? resultCode : initResult.resultCode;
    error.resultDesc = resultDesc;
    error.codaResponse = data;
    error.codaInitResult = initResult;
    error.responseStatus = responseStatus;
    error.publicPayload = {
        provider: 'coda',
        resultCode: error.resultCode,
        resultDesc,
        error: 'Coda checkout initialization failed.'
    };
    return error;
}

function redactCodaApiKey(value) {
    if (Array.isArray(value)) {
        return value.map(entry => redactCodaApiKey(entry));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.entries(value).reduce((acc, [key, entryValue]) => {
        acc[key] = key === 'apiKey' ? '[REDACTED]' : redactCodaApiKey(entryValue);
        return acc;
    }, {});
}

function stringifyCodaDebug(value) {
    return JSON.stringify(redactCodaApiKey(value), null, 2);
}

function headersToObject(headers) {
    const result = {};
    if (!headers || typeof headers.forEach !== 'function') return result;
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

function buildCodaReturnUrl(successUrl) {
    const withoutCheckoutSessionPlaceholder = String(successUrl || '')
        .trim()
        .replace(/[?&]session_id=\{CHECKOUT_SESSION_ID\}/g, '')
        .replace(/\?&/g, '?')
        .replace(/\?($|#)/g, '$1');
    const hashIndex = withoutCheckoutSessionPlaceholder.indexOf('#');
    const beforeHash = hashIndex === -1
        ? withoutCheckoutSessionPlaceholder
        : withoutCheckoutSessionPlaceholder.slice(0, hashIndex);
    const hash = hashIndex === -1 ? '' : withoutCheckoutSessionPlaceholder.slice(hashIndex);
    const queryIndex = beforeHash.indexOf('?');
    const base = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
    const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);
    const params = new URLSearchParams(query);
    params.set('transactionId', '{transactionId}');
    params.set('orderId', '{orderId}');
    const queryText = params.toString()
        .replace(/%7BtransactionId%7D/gi, '{transactionId}')
        .replace(/%7BorderId%7D/gi, '{orderId}');
    return `${base}${queryText ? `?${queryText}` : ''}${hash}`;
}

async function createCodaCheckoutInit(context) {
    const apiKey = getCodaApiKey();
    if (!apiKey) {
        throw new Error('Set CODA_API_KEY before using Coda checkout.');
    }

    const sku = getCodaSkuForProduct(context.product && context.product.productCode);
    if (!sku) {
        throw new Error('Coda SKU is not configured for this product.');
    }

    const merchant = getCodaInitMerchant(context);
    const urls = buildCheckoutUrls(context.siteBaseUrl, context.product, 'coda', context.templateId, {
        successRedirect: context.successRedirect,
        cancelRedirect: context.cancelRedirect
    });
    const initApiUrl = getCodaInitApiUrl();
    const country = resolveIso3166NumericCode(merchant.country || context.codaCountry || context.country);
    const isIndia = country === 356;
    const currency = 840;
    const payType = isIndia ? 391 : 0;
    const projectId = Number(String(context.projectId || process.env.CODA_PROJECT_ID || '3254').trim() || '3254');
    if (!Number.isFinite(projectId) || projectId <= 0) {
        throw new Error('Set CODA_PROJECT_ID to a valid numeric Coda project ID.');
    }

    const orderId = String(context.orderId || `nxl_${crypto.randomBytes(12).toString('hex')}`).trim();
    const codaReturnUrl = buildCodaReturnUrl(urls.successUrl);
    const profileEntries = [
        { key: 'user_id', value: context.userEmail },
        { key: 'return_url', value: codaReturnUrl }
    ];

    const initRequest = {
        projectId,
        country,
        payType,
        apiKey,
        orderId,
        currency,
        items: [
            {
                code: sku,
                price: context.product.price / 100,
                name: context.product.displayName
            }
        ],
        profile: {
            entry: profileEntries
        }
    };

    const payload = { initRequest };
    console.info('[Coda Checkout Init] Sending Payment/init.json request.', {
        url: initApiUrl,
        payload: stringifyCodaDebug(payload)
    });
    console.info(
        '[Coda Checkout Init] Final Payload:',
        JSON.stringify(payload, null, 2)
    );

    const response = await fetch(initApiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const responseBody = await response.text().catch(() => '');
    let data = {};
    try {
        data = responseBody ? JSON.parse(responseBody) : {};
    } catch (error) {
        data = {};
    }

    console.info('[Coda Checkout Init] Payment/init.json response received.', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: stringifyCodaDebug(headersToObject(response.headers)),
        body: stringifyCodaDebug(data),
        rawBody: responseBody,
        initResult: stringifyCodaDebug(getCodaInitResult(data))
    });
    if (!response.ok) {
        throw new Error(getCodaResponseErrorMessage(data) || 'Coda checkout could not be initialized.');
    }

    const initResult = getCodaInitResult(data);
    const rawResultCode = initResult && initResult.resultCode !== undefined ? initResult.resultCode : 0;
    const resultCode = Number(rawResultCode);
    const hasFailureResultCode = Number.isFinite(resultCode)
        ? resultCode !== 0
        : String(rawResultCode || '').trim() !== '';
    if (hasFailureResultCode) {
        throw buildCodaInitError(initResult, data, response.status);
    }

    const redirectUrl = String(initResult.redirectUrl || '').trim();
    if (!redirectUrl) {
        throw new Error('Coda checkout did not return a redirect URL.');
    }

    return {
        provider: 'coda',
        redirectUrl,
        providerReferenceId: String(initResult.txnId || initResult.transactionId || initResult.orderId || ''),
        checkoutId: String(initResult.txnId || initResult.transactionId || initResult.orderId || ''),
        diagnostics: {
            merchantId: merchant.merchantId,
            sku
        }
    };
}

function getCodaAccessEndIso(product, startedAtIso) {
    if (!product || product.billingType !== 'subscription') return '';
    const startedAt = startedAtIso ? new Date(startedAtIso) : new Date();
    if (Number.isNaN(startedAt.getTime())) return '';
    const endsAt = new Date(startedAt.getTime());
    if (product.billingCycle === 'yearly') {
        endsAt.setUTCFullYear(endsAt.getUTCFullYear() + 1);
    } else {
        endsAt.setUTCMonth(endsAt.getUTCMonth() + 1);
    }
    return endsAt.toISOString();
}

function buildOptionalCheckoutUrlMetadata(normalized, product) {
    const baseUrl = String(normalized.siteBaseUrl || process.env.APP_BASE_URL || process.env.LOCAL_APP_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return {};
    try {
        const urls = buildCheckoutUrls(baseUrl, product, 'coda', normalized.templateId, {});
        return {
            successUrl: urls.successUrl.replace('{CHECKOUT_SESSION_ID}', normalized.txnId || normalized.orderId || normalized.merchantTransactionId || ''),
            cancelUrl: urls.cancelUrl
        };
    } catch (error) {
        return {};
    }
}

function buildCodaPurchase(jsonRpc, normalized, validation) {
    const startedAt = new Date().toISOString();
    const providerPaymentId = normalized.txnId || normalized.orderId || normalized.merchantTransactionId;
    const metadataContext = {
        product: validation.product,
        userEmail: validation.userEmail,
        userName: validation.userName,
        templateId: normalized.templateId,
        templateName: normalized.templateName
    };

    return {
        provider: 'coda',
        providerSessionId: '',
        providerPaymentId,
        providerSubscriptionId: validation.product.billingType === 'subscription' ? providerPaymentId : '',
        providerCustomerId: normalized.userId || validation.userEmail,
        productCode: validation.productCode,
        product: validation.product,
        planCode: validation.product.planCode,
        billingType: validation.product.billingType,
        billingCycle: validation.product.billingCycle || '',
        userEmail: validation.userEmail,
        userName: validation.userName,
        templateId: normalized.templateId,
        templateName: normalized.templateName,
        amount: Number(validation.product.price) / 100,
        currency: validation.currency,
        status: validation.product.billingType === 'subscription' ? 'active' : 'paid',
        startedAt,
        endsAt: getCodaAccessEndIso(validation.product, startedAt),
        metadata: {
            ...buildMetadata(metadataContext),
            ...buildOptionalCheckoutUrlMetadata(normalized, validation.product),
            codaSku: validation.sku,
            codaMerchantId: validation.merchant.merchantId,
            codaCountry: validation.merchant.country,
            codaTxnId: normalized.txnId,
            codaOrderId: normalized.orderId,
            codaMerchantTransactionId: normalized.merchantTransactionId,
            jsonRpcId: String(jsonRpc.id || '')
        }
    };
}

function getCodaEventId(jsonRpc, normalized) {
    return normalized.txnId
        || normalized.orderId
        || normalized.merchantTransactionId
        || `${jsonRpc.id || 'request'}_${normalized.sku}_${normalized.userEmail || normalized.userId}`;
}

async function getProcessedCodaTopup(eventId) {
    const existing = await getWebhookEvent('coda', eventId);
    return Boolean(existing && existing.data && existing.data.processed);
}

async function recordProcessedCodaTopup(eventId, payloadHash, metadata) {
    await upsertWebhookEvent({
        provider: 'coda',
        eventId,
        eventType: 'topup',
        payloadHash,
        processed: true,
        processedAt: new Date().toISOString(),
        metadata
    });
}

function toCodaErrorResponse(jsonRpcId, error) {
    return buildCodaJsonRpcError(
        error && error.jsonRpcId !== undefined ? error.jsonRpcId : jsonRpcId,
        error && error.jsonRpcCode ? error.jsonRpcCode : -32000,
        error && error.message ? error.message : 'Coda request failed.'
    );
}

async function handleCodaValidate({ rawBody, headers = {} }) {
    let jsonRpcId = null;
    try {
        const jsonRpc = parseCodaJsonRpc(rawBody);
        jsonRpcId = jsonRpc.id;
        console.info('[Coda Validate] Request received.', { id: jsonRpc.id, method: jsonRpc.method || '' });
        verifyCodaSignature(rawBody, headers);

        const normalized = normalizeCodaParams(jsonRpc.params);
        const validation = await validateCodaTransaction(normalized);
        console.info('[Coda Validate] Request accepted.', {
            id: jsonRpc.id,
            sku: validation.sku,
            productCode: validation.productCode,
            merchantId: validation.merchant.merchantId,
            userEmail: validation.userEmail
        });

        return buildCodaJsonRpcResult(jsonRpc.id, {
            result: 0,
            user_id: validation.userEmail,
            sku: validation.sku,
            merchant_id: validation.merchant.merchantId,
            currency: validation.currency,
            amount: validation.amountMinorUnits
        });
    } catch (error) {
        console.error('[Coda Validate] Request rejected.', { error: error.message });
        return toCodaErrorResponse(jsonRpcId, error);
    }
}

async function handleCodaTopup({ rawBody, headers = {} }) {
    let jsonRpcId = null;
    try {
        const jsonRpc = parseCodaJsonRpc(rawBody);
        jsonRpcId = jsonRpc.id;
        console.info('[Coda Topup] Request received.', { id: jsonRpc.id, method: jsonRpc.method || '' });
        verifyCodaSignature(rawBody, headers);

        const normalized = normalizeCodaParams(jsonRpc.params);
        const validation = await validateCodaTransaction(normalized);
        const eventId = getCodaEventId(jsonRpc, normalized);
        const payloadHash = buildPayloadHash(rawBody);
        const eventMetadata = {
            jsonRpcId: String(jsonRpc.id || ''),
            sku: validation.sku,
            productCode: validation.productCode,
            userEmail: validation.userEmail,
            merchantId: validation.merchant.merchantId
        };

        if (await getProcessedCodaTopup(eventId)) {
            console.info('[Coda Topup] Duplicate purchase ignored.', {
                id: jsonRpc.id,
                eventId,
                userEmail: validation.userEmail,
                sku: validation.sku
            });
            return buildCodaJsonRpcResult(jsonRpc.id, 0);
        }

        const purchase = buildCodaPurchase(jsonRpc, normalized, validation);
        await fulfillPurchase(purchase);
        await recordProcessedCodaTopup(eventId, payloadHash, eventMetadata);
        console.info('[Coda Topup] Purchase fulfilled.', {
            id: jsonRpc.id,
            eventId,
            productCode: purchase.productCode,
            userEmail: purchase.userEmail,
            amount: purchase.amount,
            currency: purchase.currency
        });

        return buildCodaJsonRpcResult(jsonRpc.id, 0);
    } catch (error) {
        console.error('[Coda Topup] Request failed.', { error: error.message });
        return toCodaErrorResponse(jsonRpcId, error);
    }
}

module.exports = {
    buildCodaJsonRpcError,
    buildCodaJsonRpcResult,
    createCodaCheckoutInit,
    generateCodaSignature,
    handleCodaTopup,
    handleCodaValidate,
    normalizeCodaParams,
    parseCodaJsonRpc,
    validateCodaTransaction,
    verifyCodaSignature
};
