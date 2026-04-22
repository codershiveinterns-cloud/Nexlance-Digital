const crypto = require('crypto');

const {
    DEFAULT_CURRENCY,
    PRODUCT_CATALOG,
    getProductByCode,
    getProducts,
    grantsAllTemplates,
    isSingleTemplateProduct
} = require('../../billing-catalog.js');
const {
    findUserDocumentByEmail,
    getWebhookEvent,
    recordTemplateEntitlement,
    updateUserByEmail,
    updateUserPlanByEmail,
    upsertPaymentAttempt,
    upsertPaymentRecord,
    upsertWebhookEvent
} = require('./firebase-service');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN || '';
const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET || '';
const POLAR_API_BASE_URL = String(process.env.POLAR_API_BASE_URL || 'https://api.polar.sh/v1').trim().replace(/\/+$/, '');

const STRIPE_PRICE_ENV_MAP = {
    single_template: ['STRIPE_PRICE_SINGLE_TEMPLATE'],
    plus_monthly: ['STRIPE_PRICE_PLUS_MONTHLY'],
    plus_yearly: ['STRIPE_PRICE_PLUS_YEARLY'],
    pro_monthly: ['STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO_ONETIME'],
    pro_onetime: ['STRIPE_PRICE_PRO_ONETIME', 'STRIPE_PRICE_PRO_MONTHLY'],
    pro_yearly: ['STRIPE_PRICE_PRO_YEARLY'],
    business_monthly: ['STRIPE_PRICE_BUSINESS_MONTHLY'],
    business_yearly: ['STRIPE_PRICE_BUSINESS_YEARLY']
};

const POLAR_PRODUCT_ENV_MAP = {
    single_template: ['POLAR_PRODUCT_SINGLE_TEMPLATE'],
    plus_monthly: ['POLAR_PRODUCT_PLUS_MONTHLY'],
    plus_yearly: ['POLAR_PRODUCT_PLUS_YEARLY'],
    pro_monthly: ['POLAR_PRODUCT_PRO_MONTHLY', 'POLAR_PRODUCT_PRO_ONETIME'],
    pro_onetime: ['POLAR_PRODUCT_PRO_ONETIME', 'POLAR_PRODUCT_PRO_MONTHLY'],
    pro_yearly: ['POLAR_PRODUCT_PRO_YEARLY'],
    business_monthly: ['POLAR_PRODUCT_BUSINESS_MONTHLY'],
    business_yearly: ['POLAR_PRODUCT_BUSINESS_YEARLY']
};

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getConfiguredEnvValue(envKeys) {
    const keys = Array.isArray(envKeys) ? envKeys : [envKeys];
    for (const envKey of keys) {
        const value = envKey ? String(process.env[envKey] || '').trim() : '';
        if (value) {
            return value;
        }
    }
    return '';
}

function getPrimaryEnvKey(envKeys) {
    const keys = Array.isArray(envKeys) ? envKeys : [envKeys];
    return keys.find(Boolean) || '';
}

function getPriceEnvValue(productCode) {
    return getConfiguredEnvValue(STRIPE_PRICE_ENV_MAP[productCode]);
}

function getPolarProductId(productCode) {
    return getConfiguredEnvValue(POLAR_PRODUCT_ENV_MAP[productCode]);
}

function getPolarProductEnvKey(productCode) {
    return getPrimaryEnvKey(POLAR_PRODUCT_ENV_MAP[productCode]);
}

function hasRealSecret(value, disallowedFragments = []) {
    const normalized = String(value || '').trim();
    if (!normalized) return false;
    const lower = normalized.toLowerCase();
    if (lower.includes('your_') || lower.includes('replace_with_') || lower.includes('changeme')) {
        return false;
    }
    return !disallowedFragments.some(fragment => lower.includes(String(fragment || '').trim().toLowerCase()));
}

function isValidPolarResourceId(value) {
    const normalized = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
}

function hasStripeGatewayAccess() {
    return hasRealSecret(STRIPE_SECRET_KEY, ['sk_test_your_', 'sk_live_your_', 'stripe_secret_key']);
}

function hasPolarGatewayAccess(productCode) {
    return hasRealSecret(POLAR_ACCESS_TOKEN, ['polar_oat_your_', 'polar_access_token'])
        && isValidPolarResourceId(getPolarProductId(productCode));
}

function getProductGatewayAvailability(productCode) {
    return {
        stripe: hasStripeGatewayAccess(),
        polar: hasPolarGatewayAccess(productCode)
    };
}

function compactMetadataValues(metadata) {
    return Object.fromEntries(
        Object.entries(metadata || {}).filter(([, value]) => {
            if (value === null || value === undefined) return false;
            if (typeof value === 'string') {
                return value.trim().length > 0;
            }
            return true;
        }).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
    );
}

function normalizeRequestedProvider(provider) {
    const normalized = String(provider || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'stripe' || normalized === 'polar') {
        return normalized;
    }
    throw new Error('Unsupported payment gateway selected.');
}

function getProviderConfigurationError(provider, productCode) {
    if (provider === 'stripe') {
        return 'Stripe checkout is not configured right now. Please choose Polar or try again later.';
    }
    if (provider === 'polar') {
        return getPolarProductId(productCode)
            ? 'Polar checkout is not configured right now. Please choose Stripe or try again later.'
            : 'Polar checkout is not configured for this product right now. Please choose Stripe or try again later.';
    }
    return 'Hosted checkout is not configured right now. Please try again later.';
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
                const baseMessage = item && typeof item.msg === 'string'
                    ? item.msg.trim()
                    : (item && typeof item.message === 'string' ? item.message.trim() : '');
                if (!baseMessage) return '';
                const location = item && Array.isArray(item.loc) && item.loc.length
                    ? item.loc.join('.')
                    : '';
                return location ? `${location}: ${baseMessage}` : baseMessage;
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

function getPaymentConfig() {
    return {
        publishableKey: STRIPE_PUBLISHABLE_KEY,
        currency: DEFAULT_CURRENCY,
        products: Object.fromEntries(
            getProducts().map(product => [
                product.productCode,
                {
                    productCode: product.productCode,
                    displayName: product.displayName,
                    amount: product.price,
                    currency: product.currency,
                    billingType: product.billingType,
                    billingCycle: product.billingCycle || '',
                    entitlements: product.entitlements,
                    gateways: getProductGatewayAvailability(product.productCode)
                }
            ])
        ),
        gateways: {
            stripe: hasStripeGatewayAccess(),
            polar: Boolean(POLAR_ACCESS_TOKEN)
        }
    };
}

function getIntervalConfig(product) {
    if (!product || product.billingType !== 'subscription') return null;
    return product.billingCycle === 'yearly'
        ? { interval: 'year', intervalCount: 1 }
        : { interval: 'month', intervalCount: 1 };
}

function splitPathAndHash(relativeTarget) {
    const raw = String(relativeTarget || '').trim() || 'pricing.html';
    const hashIndex = raw.indexOf('#');
    if (hashIndex === -1) {
        return { path: raw, hash: '' };
    }
    return {
        path: raw.slice(0, hashIndex) || 'pricing.html',
        hash: raw.slice(hashIndex)
    };
}

function sanitizeBaseUrl(value) {
    const candidate = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(candidate)) {
        throw new Error('A valid site URL is required to start checkout.');
    }
    return candidate;
}

function buildCheckoutUrls(baseUrl, product, provider, templateId, overrides = {}) {
    const successTarget = String(overrides.successRedirect || product.successRedirect || 'pricing.html').trim() || 'pricing.html';
    const cancelTarget = String(overrides.cancelRedirect || successTarget).trim() || successTarget;
    const { path: successPath, hash: successHash } = splitPathAndHash(successTarget);
    const { path: cancelPath, hash: cancelHash } = splitPathAndHash(cancelTarget);
    const successUrl = new URL(`${baseUrl}/${successPath.replace(/^\/+/, '')}`);
    successUrl.searchParams.set('checkout_result', 'success');
    successUrl.searchParams.set('provider', provider);
    successUrl.searchParams.set('product', product.productCode);
    if (templateId) {
        successUrl.searchParams.set('template', templateId);
    }
    const cancelUrl = new URL(`${baseUrl}/${cancelPath.replace(/^\/+/, '')}`);
    cancelUrl.searchParams.set('checkout_result', 'cancelled');
    cancelUrl.searchParams.set('provider', provider);
    cancelUrl.searchParams.set('product', product.productCode);
    if (templateId) {
        cancelUrl.searchParams.set('template', templateId);
    }

    const successBase = `${successUrl.toString()}${successHash}`;
    const cancelBase = `${cancelUrl.toString()}${cancelHash}`;
    return {
        successUrl: successBase.includes('?')
            ? `${successBase}&session_id={CHECKOUT_SESSION_ID}`
            : `${successBase}?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: cancelBase,
        polarSuccessUrl: successBase.includes('?')
            ? `${successBase}&checkout_id={CHECKOUT_ID}`
            : `${successBase}?checkout_id={CHECKOUT_ID}`
    };
}

function buildMetadata(context) {
    return compactMetadataValues({
        flow: isSingleTemplateProduct(context.product.productCode) ? 'template_download' : 'plan_purchase',
        product_code: context.product.productCode,
        plan_code: context.product.planCode,
        user_email: context.userEmail,
        user_name: context.userName,
        template_id: context.templateId || '',
        template_name: context.templateName || '',
        billing_type: context.product.billingType,
        billing_cycle: context.product.billingCycle || ''
    });
}

async function resolveCheckoutContext(options) {
    const product = getProductByCode(options.productCode);
    if (!product) {
        throw new Error('Invalid product selected for checkout.');
    }

    const userEmail = normalizeEmail(options.userEmail);
    if (!userEmail || !isValidEmail(userEmail)) {
        throw new Error('A valid signed-in account is required before checkout.');
    }

    const userDoc = await findUserDocumentByEmail(userEmail);
    if (!userDoc) {
        throw new Error('Create your account first before starting checkout.');
    }

    const userName = normalizeName(
        options.userName
        || userDoc.data.name
        || userDoc.data.displayName
        || userDoc.data.businessName
        || userEmail.split('@')[0]
    );

    if (isSingleTemplateProduct(product.productCode) && !String(options.templateId || '').trim()) {
        throw new Error('Choose a template before starting checkout.');
    }

    const baseUrl = sanitizeBaseUrl(options.siteBaseUrl);
    const templateId = String(options.templateId || '').trim().toLowerCase();
    const templateName = String(options.templateName || '').trim();
    const successRedirect = String(options.successRedirect || '').trim();
    const cancelRedirect = String(options.cancelRedirect || '').trim();

    return {
        product,
        userEmail,
        userName,
        templateId,
        templateName,
        successRedirect,
        cancelRedirect,
        siteBaseUrl: baseUrl,
        metadata: buildMetadata({
            product,
            userEmail,
            userName,
            templateId,
            templateName
        })
    };
}

async function createStripeCheckoutSession(context) {
    if (!hasStripeGatewayAccess()) {
        throw new Error('Set STRIPE_SECRET_KEY before using Stripe checkout.');
    }

    const urls = buildCheckoutUrls(context.siteBaseUrl, context.product, 'stripe', context.templateId, {
        successRedirect: context.successRedirect,
        cancelRedirect: context.cancelRedirect
    });
    const params = new URLSearchParams();
    params.set('mode', context.product.billingType === 'subscription' ? 'subscription' : 'payment');
    params.set('success_url', urls.successUrl);
    params.set('cancel_url', urls.cancelUrl);
    params.set('customer_email', context.userEmail);
    params.set('client_reference_id', context.userEmail);

    Object.entries(context.metadata).forEach(([key, value]) => {
        params.set(`metadata[${key}]`, String(value || ''));
    });

    if (context.product.billingType === 'subscription') {
        Object.entries(context.metadata).forEach(([key, value]) => {
            params.set(`subscription_data[metadata][${key}]`, String(value || ''));
        });
    }

    const configuredPriceId = getPriceEnvValue(context.product.productCode);
    params.set('line_items[0][quantity]', '1');

    if (configuredPriceId) {
        params.set('line_items[0][price]', configuredPriceId);
    } else if (context.product.billingType === 'subscription') {
        const interval = getIntervalConfig(context.product);
        params.set('line_items[0][price_data][currency]', context.product.currency);
        params.set('line_items[0][price_data][unit_amount]', String(context.product.price));
        params.set('line_items[0][price_data][product_data][name]', `Nexlance ${context.product.displayName}`);
        params.set('line_items[0][price_data][product_data][description]', `Nexlance ${context.product.displayName} plan checkout`);
        params.set('line_items[0][price_data][recurring][interval]', interval.interval);
        params.set('line_items[0][price_data][recurring][interval_count]', String(interval.intervalCount));
    } else {
        params.set('line_items[0][price_data][currency]', context.product.currency);
        params.set('line_items[0][price_data][unit_amount]', String(context.product.price));
        params.set('line_items[0][price_data][product_data][name]', `Nexlance ${context.product.displayName}`);
        params.set('line_items[0][price_data][product_data][description]', isSingleTemplateProduct(context.product.productCode)
            ? `Template purchase${context.templateName ? ` for ${context.templateName}` : ''}`
            : `${context.product.displayName} checkout`);
    }

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

    return {
        provider: 'stripe',
        redirectUrl: data.url,
        providerReferenceId: data.id,
        sessionId: data.id
    };
}

async function createPolarCheckoutSession(context) {
    if (!hasRealSecret(POLAR_ACCESS_TOKEN, ['polar_oat_your_', 'polar_access_token'])) {
        throw new Error('Set POLAR_ACCESS_TOKEN before using Polar checkout.');
    }

    const productId = getPolarProductId(context.product.productCode);
    if (!isValidPolarResourceId(productId)) {
        throw new Error(`Set the Polar product ID for ${context.product.productCode} before using Polar checkout.`);
    }

    const urls = buildCheckoutUrls(context.siteBaseUrl, context.product, 'polar', context.templateId, {
        successRedirect: context.successRedirect,
        cancelRedirect: context.cancelRedirect
    });
    const response = await fetch(`${POLAR_API_BASE_URL}/checkouts`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            products: [productId],
            customer_name: context.userName,
            customer_email: context.userEmail,
            external_customer_id: context.userEmail,
            locale: 'en',
            allow_trial: context.product.billingType === 'subscription' ? false : true,
            metadata: context.metadata,
            success_url: urls.polarSuccessUrl,
            return_url: urls.cancelUrl
        })
    });

    const data = await response.json();
    if (!response.ok) {
        const message = extractPolarErrorMessage(data, 'Polar checkout session could not be created.');
        if (/product is archived/i.test(message)) {
            const envKey = getPolarProductEnvKey(context.product.productCode);
            throw new Error(envKey
                ? `${message} Replace ${envKey} with an active Polar product ID.`
                : `${message} Replace the configured Polar product ID with an active product.`);
        }
        throw new Error(message);
    }

    return {
        provider: 'polar',
        redirectUrl: data.url,
        providerReferenceId: data.id,
        checkoutId: data.id,
        diagnostics: {
            paymentProcessor: data.payment_processor || '',
            productId: data.product_id || productId,
            productPriceId: data.product_price_id || '',
            productPriceType: data.product_price && data.product_price.type ? data.product_price.type : '',
            recurringInterval: data.product_price && data.product_price.recurring_interval ? data.product_price.recurring_interval : '',
            allowTrial: data.allow_trial === true,
            activeTrialInterval: data.active_trial_interval || '',
            currency: data.currency || '',
            isPaymentRequired: data.is_payment_required === true,
            isPaymentSetupRequired: data.is_payment_setup_required === true,
            isPaymentFormRequired: data.is_payment_form_required === true
        }
    };
}

async function createHostedCheckout(options) {
    const context = await resolveCheckoutContext(options);
    const explicitlyRequestedProvider = normalizeRequestedProvider(options.provider);
    const gatewayAvailability = getProductGatewayAvailability(context.product.productCode);
    let selectedProvider = explicitlyRequestedProvider;

    if (selectedProvider) {
        if (!gatewayAvailability[selectedProvider]) {
            throw new Error(getProviderConfigurationError(selectedProvider, context.product.productCode));
        }
    } else if (gatewayAvailability.stripe) {
        selectedProvider = 'stripe';
    } else if (gatewayAvailability.polar) {
        selectedProvider = 'polar';
    } else {
        throw new Error('Hosted checkout is not configured right now. Please try again later.');
    }

    const requestedProvider = selectedProvider;
    const fallbackProvider = '';
    const attemptBase = {
        attemptId: crypto.randomUUID ? crypto.randomUUID() : `attempt_${Date.now()}`,
        requestedProvider,
        fallbackProvider,
        productCode: context.product.productCode,
        userEmail: context.userEmail,
        userName: context.userName,
        templateId: context.templateId,
        amount: context.product.price / 100,
        currency: context.product.currency,
        siteBaseUrl: context.siteBaseUrl,
        status: 'pending',
        metadata: {
            templateName: context.templateName
        }
    };

    await upsertPaymentAttempt(attemptBase);

    let lastError = null;

    try {
        const payload = selectedProvider === 'polar'
            ? await createPolarCheckoutSession(context)
            : await createStripeCheckoutSession(context);

        await upsertPaymentAttempt({
            ...attemptBase,
            provider: selectedProvider,
            status: 'checkout_created',
            redirectUrl: payload.redirectUrl,
            providerReferenceId: payload.providerReferenceId,
            metadata: {
                ...attemptBase.metadata,
                usedFallback: false,
                paymentDiagnostics: payload.diagnostics || {}
            }
        });

        return {
            ok: true,
            provider: selectedProvider,
            usedFallback: false,
            productCode: context.product.productCode,
            redirectUrl: payload.redirectUrl,
            sessionId: payload.sessionId || '',
            checkoutId: payload.checkoutId || '',
            successRedirect: context.successRedirect || context.product.successRedirect
        };
    } catch (error) {
        lastError = error;
        await upsertPaymentAttempt({
            ...attemptBase,
            provider: selectedProvider,
            status: 'provider_failed',
            metadata: {
                ...attemptBase.metadata,
                error: error.message || 'Checkout session creation failed.',
                paymentDiagnostics: error && error.diagnostics ? error.diagnostics : {}
            }
        });
    }

    throw lastError || new Error('No payment gateway could start checkout.');
}

async function fetchStripeCheckoutSession(sessionId) {
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

async function fetchStripeSubscription(subscriptionId) {
    if (!subscriptionId) return null;
    const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`
        }
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : 'Could not retrieve Stripe subscription.';
        throw new Error(message);
    }

    return data;
}

async function fetchPolarCheckoutSession(checkoutId) {
    const response = await fetch(`${POLAR_API_BASE_URL}/checkouts/${encodeURIComponent(checkoutId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`
        }
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(extractPolarErrorMessage(data, 'Could not verify Polar checkout session.'));
    }

    return data;
}

function getPeriodEndIsoFromUnix(timestampSeconds) {
    const numeric = Number(timestampSeconds || 0);
    return numeric > 0 ? new Date(numeric * 1000).toISOString() : '';
}

async function buildStripePurchaseFromSession(session) {
    const metadata = session.metadata || {};
    const productCode = String(metadata.product_code || '').trim().toLowerCase();
    const product = getProductByCode(productCode);
    if (!product) {
        throw new Error('Stripe checkout session does not include a supported product.');
    }

    let planEndsAt = '';
    let subscription = null;
    if (product.billingType === 'subscription' && session.subscription) {
        subscription = await fetchStripeSubscription(session.subscription);
        planEndsAt = getPeriodEndIsoFromUnix(subscription && subscription.current_period_end);
    }

    return {
        provider: 'stripe',
        providerSessionId: session.id,
        providerPaymentId: session.payment_intent || '',
        providerSubscriptionId: session.subscription || '',
        providerCustomerId: session.customer || '',
        productCode,
        product,
        planCode: product.planCode,
        billingType: product.billingType,
        billingCycle: product.billingCycle || '',
        userEmail: normalizeEmail(metadata.user_email || session.customer_details && session.customer_details.email || session.customer_email || ''),
        userName: normalizeName(metadata.user_name || ''),
        templateId: String(metadata.template_id || '').trim().toLowerCase(),
        templateName: String(metadata.template_name || '').trim(),
        amount: Number(session.amount_total || product.price) / 100,
        currency: String(session.currency || product.currency || DEFAULT_CURRENCY).toUpperCase(),
        status: product.billingType === 'subscription'
            ? String(subscription && subscription.status || 'active')
            : 'paid',
        startedAt: new Date().toISOString(),
        endsAt: planEndsAt,
        metadata: {
            checkoutStatus: session.status || '',
            paymentStatus: session.payment_status || '',
            subscriptionStatus: subscription && subscription.status ? subscription.status : ''
        }
    };
}

function buildPolarPurchaseFromCheckout(checkout) {
    const metadata = checkout.metadata || {};
    const productCode = String(metadata.product_code || '').trim().toLowerCase();
    const product = getProductByCode(productCode);
    if (!product) {
        throw new Error('Polar checkout does not include a supported product.');
    }

    return {
        provider: 'polar',
        providerSessionId: '',
        providerPaymentId: String(checkout.order_id || checkout.id || ''),
        providerSubscriptionId: String(checkout.subscription_id || ''),
        providerCustomerId: String(checkout.customer_id || checkout.external_customer_id || ''),
        productCode,
        product,
        planCode: product.planCode,
        billingType: product.billingType,
        billingCycle: product.billingCycle || '',
        userEmail: normalizeEmail(metadata.user_email || checkout.customer_email || checkout.external_customer_id || ''),
        userName: normalizeName(metadata.user_name || checkout.customer_name || ''),
        templateId: String(metadata.template_id || '').trim().toLowerCase(),
        templateName: String(metadata.template_name || '').trim(),
        amount: Number(checkout.total_amount || product.price) / 100,
        currency: String(checkout.currency || product.currency || DEFAULT_CURRENCY).toUpperCase(),
        status: String(checkout.status || 'succeeded').toLowerCase(),
        startedAt: new Date().toISOString(),
        endsAt: '',
        metadata: {
            checkoutStatus: checkout.status || ''
        }
    };
}

function mergeTemplateIds(existingIds, nextTemplateId) {
    const normalizedExisting = Array.isArray(existingIds) ? existingIds.filter(Boolean) : [];
    if (!nextTemplateId) return normalizedExisting;
    return normalizedExisting.includes(nextTemplateId)
        ? normalizedExisting
        : normalizedExisting.concat(nextTemplateId);
}

async function applyPurchaseToUser(purchase) {
    const product = purchase.product;
    if (!purchase.userEmail) {
        throw new Error('Purchase is missing a user email.');
    }

    const templateAccessSource = grantsAllTemplates(product.productCode)
        ? (purchase.planCode || product.planCode)
        : '';
    const templateAccessEndsAt = grantsAllTemplates(product.productCode)
        ? (product.billingType === 'subscription' ? (purchase.endsAt || '') : '')
        : '';

    const planRecord = {
        code: product.planCode,
        name: product.displayName,
        paid: true,
        price: purchase.amount,
        currency: purchase.currency,
        startedAt: purchase.startedAt || new Date().toISOString(),
        endsAt: purchase.endsAt || '',
        status: purchase.status || 'active',
        billingCycle: purchase.billingCycle || '',
        paymentIntentId: purchase.providerPaymentId || '',
        checkoutSessionId: purchase.providerSessionId || '',
        provider: purchase.provider,
        providerCustomerId: purchase.providerCustomerId || '',
        providerSubscriptionId: purchase.providerSubscriptionId || '',
        dashboardAccess: Boolean(product.entitlements.dashboardAccess),
        allTemplatesAccess: Boolean(product.entitlements.allTemplates),
        templateLimit: Number(product.entitlements.templateLimit || 0),
        templateAccessSource,
        templateAccessEndsAt
    };

    if (product.entitlements.singleTemplatePurchase) {
        await recordTemplateEntitlement({
            userEmail: purchase.userEmail,
            templateId: purchase.templateId,
            scope: 'single_template',
            sourceProductCode: product.productCode,
            provider: purchase.provider,
            providerReferenceId: purchase.providerSessionId || purchase.providerPaymentId || '',
            startsAt: purchase.startedAt,
            metadata: {
                templateName: purchase.templateName || ''
            }
        });

        return updateUserByEmail(purchase.userEmail, currentUser => ({
            ownedTemplateIds: mergeTemplateIds(currentUser.ownedTemplateIds, purchase.templateId),
            allTemplatesAccess: Boolean(currentUser.allTemplatesAccess),
            dashboardAccess: Boolean(currentUser.dashboardAccess),
            fullAccess: Boolean(currentUser.dashboardAccess),
            currentPlan: currentUser.currentPlan || 'Individual',
            planCode: currentUser.planCode || 'individual',
            planPaid: Boolean(currentUser.planPaid),
            paymentProvider: purchase.provider,
            lastCheckoutSessionId: purchase.providerSessionId || currentUser.lastCheckoutSessionId || '',
            lastPaymentId: purchase.providerPaymentId || currentUser.lastPaymentId || '',
            updatedAt: new Date().toISOString()
        }));
    }

    if (product.entitlements.allTemplates) {
        await recordTemplateEntitlement({
            userEmail: purchase.userEmail,
            scope: 'all_templates',
            sourceProductCode: product.productCode,
            provider: purchase.provider,
            providerReferenceId: purchase.providerSubscriptionId || purchase.providerSessionId || purchase.providerPaymentId || '',
            startsAt: purchase.startedAt,
            endsAt: templateAccessEndsAt,
            metadata: {
                billingType: product.billingType,
                billingCycle: purchase.billingCycle || ''
            }
        });

        if (!product.entitlements.dashboardAccess) {
            return updateUserByEmail(purchase.userEmail, currentUser => ({
                currentPlan: currentUser.dashboardAccess ? (currentUser.currentPlan || 'Plus') : product.displayName,
                planCode: currentUser.dashboardAccess ? (currentUser.planCode || 'plus') : product.planCode,
                planPaid: currentUser.dashboardAccess ? Boolean(currentUser.planPaid) : true,
                planStatus: currentUser.dashboardAccess ? (currentUser.planStatus || 'active') : 'active',
                dashboardAccess: Boolean(currentUser.dashboardAccess),
                allTemplatesAccess: true,
                fullAccess: Boolean(currentUser.dashboardAccess),
                templateAccessSource: 'pro',
                templateAccessEndsAt: '',
                paymentProvider: purchase.provider,
                lastCheckoutSessionId: purchase.providerSessionId || currentUser.lastCheckoutSessionId || '',
                lastPaymentId: purchase.providerPaymentId || currentUser.lastPaymentId || '',
                updatedAt: new Date().toISOString()
            }));
        }
    }

    return updateUserPlanByEmail(purchase.userEmail, {
        ...planRecord
    });
}

async function persistPurchaseRecord(purchase) {
    const paymentId = `${purchase.provider}_${purchase.providerSubscriptionId || purchase.providerSessionId || purchase.providerPaymentId || purchase.productCode}`;
    return upsertPaymentRecord({
        paymentId,
        provider: purchase.provider,
        status: purchase.status,
        productCode: purchase.productCode,
        planCode: purchase.planCode,
        billingType: purchase.billingType,
        billingCycle: purchase.billingCycle,
        userEmail: purchase.userEmail,
        userName: purchase.userName,
        templateId: purchase.templateId,
        amount: purchase.amount,
        currency: purchase.currency,
        providerPaymentId: purchase.providerPaymentId,
        providerSessionId: purchase.providerSessionId,
        providerSubscriptionId: purchase.providerSubscriptionId,
        providerCustomerId: purchase.providerCustomerId,
        metadata: purchase.metadata,
        createdAt: purchase.startedAt || new Date().toISOString()
    });
}

async function fulfillPurchase(purchase) {
    const paymentRecord = await persistPurchaseRecord(purchase);
    const userRecord = await applyPurchaseToUser(purchase);
    return {
        paymentRecord,
        userRecord,
        product: purchase.product
    };
}

async function completeHostedCheckout(options) {
    const provider = String(options.provider || '').trim().toLowerCase();

    if (provider === 'stripe') {
        const sessionId = String(options.sessionId || '').trim();
        if (!sessionId) {
            throw new Error('Stripe session ID is required.');
        }
        const session = await fetchStripeCheckoutSession(sessionId);
        if (session.payment_status !== 'paid' || session.status !== 'complete') {
            throw new Error('Stripe payment has not completed yet.');
        }
        const purchase = await buildStripePurchaseFromSession(session);
        const result = await fulfillPurchase(purchase);
        return {
            provider,
            productCode: purchase.productCode,
            templateId: purchase.templateId,
            userEmail: purchase.userEmail,
            result
        };
    }

    if (provider === 'polar') {
        const checkoutId = String(options.checkoutId || '').trim();
        if (!checkoutId) {
            throw new Error('Polar checkout ID is required.');
        }
        const checkout = await fetchPolarCheckoutSession(checkoutId);
        if (String(checkout.status || '').toLowerCase() !== 'succeeded') {
            throw new Error('Polar payment has not completed yet.');
        }
        const purchase = buildPolarPurchaseFromCheckout(checkout);
        const result = await fulfillPurchase(purchase);
        return {
            provider,
            productCode: purchase.productCode,
            templateId: purchase.templateId,
            userEmail: purchase.userEmail,
            result
        };
    }

    throw new Error('Unsupported payment provider.');
}

function parseStripeSignatureHeader(signatureHeader) {
    return String(signatureHeader || '')
        .split(',')
        .map(part => part.trim())
        .reduce((acc, part) => {
            const [key, value] = part.split('=');
            if (key && value) {
                acc[key] = acc[key] ? [].concat(acc[key], value) : value;
            }
            return acc;
        }, {});
}

function verifyStripeWebhookSignature(payload, signatureHeader) {
    if (!STRIPE_WEBHOOK_SECRET) {
        throw new Error('Set STRIPE_WEBHOOK_SECRET in your environment before using the webhook endpoint.');
    }

    const parsed = parseStripeSignatureHeader(signatureHeader);
    const timestamp = parsed.t;
    const signatures = Array.isArray(parsed.v1) ? parsed.v1 : parsed.v1 ? [parsed.v1] : [];

    if (!timestamp || !signatures.length) {
        throw new Error('Missing Stripe webhook signature.');
    }

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
        throw new Error('Stripe webhook signature has expired.');
    }

    const signedPayload = `${timestamp}.${payload}`;
    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(signedPayload).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const matched = signatures.some(signature => {
        try {
            const signatureBuffer = Buffer.from(signature, 'hex');
            return signatureBuffer.length === expectedBuffer.length
                && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
        } catch (error) {
            return false;
        }
    });

    if (!matched) {
        throw new Error('Stripe webhook signature verification failed.');
    }
}

function parsePolarSignatureHeader(signatureHeader) {
    return String(signatureHeader || '')
        .split(' ')
        .map(part => part.trim())
        .filter(Boolean);
}

function verifyPolarWebhookSignature(payload, headers) {
    if (!POLAR_WEBHOOK_SECRET) {
        throw new Error('Set POLAR_WEBHOOK_SECRET in your environment before using the Polar webhook endpoint.');
    }

    const webhookId = String(headers['webhook-id'] || headers['Webhook-Id'] || '').trim();
    const webhookTimestamp = String(headers['webhook-timestamp'] || headers['Webhook-Timestamp'] || '').trim();
    const signatureHeader = String(headers['webhook-signature'] || headers['Webhook-Signature'] || '').trim();
    if (!webhookId || !webhookTimestamp || !signatureHeader) {
        throw new Error('Missing Polar webhook headers.');
    }

    const signedContent = `${webhookId}.${webhookTimestamp}.${payload}`;
    const secret = Buffer.from(POLAR_WEBHOOK_SECRET).toString('base64');
    const expectedSignature = crypto.createHmac('sha256', secret).update(signedContent).digest('base64');
    const candidates = parsePolarSignatureHeader(signatureHeader);
    const normalizedExpected = Buffer.from(expectedSignature);
    const matched = candidates.some(candidate => {
        const signature = candidate.includes(',') ? candidate.split(',').pop() : candidate;
        const normalizedCandidate = Buffer.from(signature.trim());
        return normalizedCandidate.length === normalizedExpected.length
            && crypto.timingSafeEqual(normalizedCandidate, normalizedExpected);
    });

    if (!matched) {
        throw new Error('Polar webhook signature verification failed.');
    }
}

function buildPayloadHash(payload) {
    return crypto.createHash('sha256').update(String(payload || '')).digest('hex');
}

async function markWebhookProcessed(provider, eventId, eventType, payloadHash, metadata) {
    const existing = await getWebhookEvent(provider, eventId);
    if (existing && existing.data && existing.data.processed) {
        return false;
    }
    await upsertWebhookEvent({
        provider,
        eventId,
        eventType,
        payloadHash,
        processed: true,
        processedAt: new Date().toISOString(),
        metadata
    });
    return true;
}

async function applyStripeSubscriptionState(metadata, subscription, nextStatus) {
    const userEmail = normalizeEmail(metadata.user_email || '');
    const productCode = String(metadata.product_code || '').trim().toLowerCase();
    const product = getProductByCode(productCode);
    if (!userEmail || !product || !product.entitlements.dashboardAccess) {
        return null;
    }

    const endsAt = getPeriodEndIsoFromUnix(subscription && subscription.current_period_end);
    return updateUserByEmail(userEmail, currentUser => {
        const now = Date.now();
        const hasRemainingPeriod = endsAt ? new Date(endsAt).getTime() > now : false;
        const keepDashboardAccess = hasRemainingPeriod;
        const allTemplatesSource = String(currentUser.templateAccessSource || '').toLowerCase();
        const shouldKeepTemplateAccess = currentUser.allTemplatesAccess === true
            && allTemplatesSource !== 'business';

        return {
            currentPlan: keepDashboardAccess ? product.displayName : (shouldKeepTemplateAccess ? 'Pro' : 'Individual'),
            planCode: keepDashboardAccess ? product.planCode : (shouldKeepTemplateAccess ? 'pro' : 'individual'),
            planPaid: keepDashboardAccess,
            planStatus: nextStatus,
            dashboardAccess: keepDashboardAccess,
            fullAccess: keepDashboardAccess,
            planEndsAt: endsAt || currentUser.planEndsAt || '',
            paymentProvider: 'stripe',
            providerSubscriptionId: subscription && subscription.id ? subscription.id : (currentUser.providerSubscriptionId || ''),
            allTemplatesAccess: shouldKeepTemplateAccess,
            templateLimit: keepDashboardAccess ? Number(product.entitlements.templateLimit || 0) : 0,
            updatedAt: new Date().toISOString()
        };
    });
}

async function handleStripeWebhookEvent(event) {
    if (!event || !event.type) return;

    if (event.type === 'checkout.session.completed') {
        const session = event.data && event.data.object ? event.data.object : null;
        if (!session) return;
        const wasMarked = await markWebhookProcessed('stripe', event.id, event.type, buildPayloadHash(JSON.stringify(event)), {
            sessionId: session.id || ''
        });
        if (!wasMarked) return;
        if (session.payment_status === 'paid') {
            const purchase = await buildStripePurchaseFromSession(session);
            await fulfillPurchase(purchase);
        }
        return;
    }

    if (event.type === 'invoice.paid') {
        const invoice = event.data && event.data.object ? event.data.object : null;
        if (!invoice || !invoice.subscription) return;
        const wasMarked = await markWebhookProcessed('stripe', event.id, event.type, buildPayloadHash(JSON.stringify(event)), {
            invoiceId: invoice.id || ''
        });
        if (!wasMarked) return;
        const subscription = await fetchStripeSubscription(invoice.subscription);
        const metadata = subscription && subscription.metadata ? subscription.metadata : {};
        await applyStripeSubscriptionState(metadata, subscription, 'active');
        return;
    }

    if (event.type === 'invoice.payment_failed') {
        const invoice = event.data && event.data.object ? event.data.object : null;
        if (!invoice || !invoice.subscription) return;
        const wasMarked = await markWebhookProcessed('stripe', event.id, event.type, buildPayloadHash(JSON.stringify(event)), {
            invoiceId: invoice.id || ''
        });
        if (!wasMarked) return;
        const subscription = await fetchStripeSubscription(invoice.subscription);
        const metadata = subscription && subscription.metadata ? subscription.metadata : {};
        await applyStripeSubscriptionState(metadata, subscription, 'past_due');
        return;
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const subscription = event.data && event.data.object ? event.data.object : null;
        if (!subscription) return;
        const wasMarked = await markWebhookProcessed('stripe', event.id, event.type, buildPayloadHash(JSON.stringify(event)), {
            subscriptionId: subscription.id || ''
        });
        if (!wasMarked) return;
        const metadata = subscription.metadata || {};
        await applyStripeSubscriptionState(metadata, subscription, event.type === 'customer.subscription.deleted' ? 'canceled' : String(subscription.status || 'active'));
    }
}

function getPolarEventObject(event) {
    if (!event || typeof event !== 'object') return null;
    if (event.data && typeof event.data === 'object') return event.data;
    return event;
}

function getPolarMetadataFromObject(object) {
    return object && object.metadata && typeof object.metadata === 'object' ? object.metadata : {};
}

async function handlePolarWebhookEvent(event) {
    if (!event || !event.type) return;
    const object = getPolarEventObject(event);
    if (!object) return;

    const eventId = String(event.id || object.id || `${event.type}_${Date.now()}`);
    const wasMarked = await markWebhookProcessed('polar', eventId, event.type, buildPayloadHash(JSON.stringify(event)), {
        objectId: object.id || ''
    });
    if (!wasMarked) return;

    if (event.type === 'order.paid' || event.type === 'checkout.updated') {
        const status = String(object.status || '').toLowerCase();
        if (status && status !== 'succeeded' && status !== 'paid') {
            return;
        }

        if (object.metadata && object.metadata.product_code) {
            const purchase = buildPolarPurchaseFromCheckout(object);
            await fulfillPurchase(purchase);
        }
        return;
    }

    if (event.type === 'subscription.updated' || event.type === 'subscription.canceled' || event.type === 'subscription.revoked') {
        const metadata = getPolarMetadataFromObject(object);
        const userEmail = normalizeEmail(metadata.user_email || object.customer_email || object.external_customer_id || '');
        const productCode = String(metadata.product_code || '').trim().toLowerCase();
        const product = getProductByCode(productCode);
        if (!userEmail || !product || !product.entitlements.dashboardAccess) {
            return;
        }

        const endsAt = String(object.current_period_end || object.ends_at || '');
        const hasRemainingPeriod = endsAt ? new Date(endsAt).getTime() > Date.now() : false;
        await updateUserByEmail(userEmail, currentUser => ({
            currentPlan: hasRemainingPeriod ? product.displayName : 'Individual',
            planCode: hasRemainingPeriod ? product.planCode : 'individual',
            planPaid: hasRemainingPeriod,
            planStatus: event.type === 'subscription.updated'
                ? String(object.status || 'active')
                : 'canceled',
            dashboardAccess: hasRemainingPeriod,
            fullAccess: hasRemainingPeriod,
            planEndsAt: endsAt || currentUser.planEndsAt || '',
            paymentProvider: 'polar',
            providerSubscriptionId: String(object.id || currentUser.providerSubscriptionId || ''),
            allTemplatesAccess: hasRemainingPeriod ? Boolean(product.entitlements.allTemplates) : false,
            templateLimit: hasRemainingPeriod ? Number(product.entitlements.templateLimit || 0) : 0,
            updatedAt: new Date().toISOString()
        }));
    }
}

async function createStripePaymentIntent() {
    throw new Error('Legacy Stripe card modal checkout has been replaced by hosted checkout sessions.');
}

async function retrieveStripePaymentIntent(paymentIntentId) {
    if (!STRIPE_SECRET_KEY) {
        throw new Error('Set STRIPE_SECRET_KEY in your environment before starting the payment server.');
    }
    const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`
        }
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : 'Could not retrieve payment intent.';
        throw new Error(message);
    }

    return data;
}

function buildPlanRecordFromPaymentIntent(paymentIntent) {
    const metadata = paymentIntent && paymentIntent.metadata ? paymentIntent.metadata : {};
    const productCode = String(metadata.product_code || '').trim();
    const product = getProductByCode(productCode);
    if (!product) {
        throw new Error('Unknown Stripe product code.');
    }
    return {
        code: product.planCode,
        name: product.displayName,
        paid: true,
        price: Number(product.price) / 100,
        currency: String(product.currency || DEFAULT_CURRENCY).toUpperCase(),
        startedAt: new Date().toISOString(),
        endsAt: '',
        status: 'active',
        billingCycle: product.billingCycle || '',
        paymentIntentId: paymentIntent.id,
        dashboardAccess: Boolean(product.entitlements.dashboardAccess),
        allTemplatesAccess: Boolean(product.entitlements.allTemplates)
    };
}

module.exports = {
    DEFAULT_CURRENCY,
    PRODUCT_CATALOG,
    buildPlanRecordFromPaymentIntent,
    completeHostedCheckout,
    createHostedCheckout,
    createStripePaymentIntent,
    fetchPolarCheckoutSession,
    fetchStripeCheckoutSession,
    getPaymentConfig,
    handlePolarWebhookEvent,
    handleStripeWebhookEvent,
    retrieveStripePaymentIntent,
    verifyPolarWebhookSignature,
    verifyStripeWebhookSignature
};
