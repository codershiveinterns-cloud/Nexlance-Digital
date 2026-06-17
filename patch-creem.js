const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'backend', 'services', 'payments.js');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Add Env Map
content = content.replace(
    /const POLAR_PRODUCT_ENV_MAP = \{[\s\S]*?\};\n/,
    `$&
const CREEM_PRODUCT_ENV_MAP = {
    single_template: ['CREEM_PRODUCT_SINGLE_TEMPLATE'],
    plus_monthly: ['CREEM_PRODUCT_PLUS_MONTHLY'],
    plus_yearly: ['CREEM_PRODUCT_PLUS_YEARLY'],
    pro_monthly: ['CREEM_PRODUCT_PRO_MONTHLY', 'CREEM_PRODUCT_PRO_ONETIME'],
    pro_onetime: ['CREEM_PRODUCT_PRO_ONETIME', 'CREEM_PRODUCT_PRO_MONTHLY'],
    pro_yearly: ['CREEM_PRODUCT_PRO_YEARLY'],
    business_monthly: ['CREEM_PRODUCT_BUSINESS_MONTHLY'],
    business_yearly: ['CREEM_PRODUCT_BUSINESS_YEARLY']
};
`
);

// 2. Add getter
content = content.replace(
    /function getPolarProductEnvKey.*?\}\n/s,
    `$&
function getCreemProductId(productCode) {
    return getConfiguredEnvValue(CREEM_PRODUCT_ENV_MAP[productCode]);
}
`
);

// 3. Add access checker
content = content.replace(
    /function hasPolarGatewayAccess.*?\}\n/s,
    `$&
function hasCreemGatewayAccess(productCode) {
    return hasRealSecret(process.env.CREEM_API_KEY, ['your_', 'changeme'])
        && Boolean(getCreemProductId(productCode));
}
`
);

// 4. Update availability
content = content.replace(
    /function getProductGatewayAvailability\(productCode\) \{\n\s*return \{\n\s*stripe: hasStripeGatewayAccess\(\),\n\s*polar: hasPolarGatewayAccess\(productCode\)\n\s*\};\n\s*\}/,
    `function getProductGatewayAvailability(productCode) {
    return {
        stripe: hasStripeGatewayAccess(),
        polar: hasPolarGatewayAccess(productCode),
        creem: hasCreemGatewayAccess(productCode)
    };
}`
);

// 5. Update normalizeRequestedProvider
content = content.replace(
    /if \(normalized === 'stripe' \|\| normalized === 'polar'\) \{/,
    `if (normalized === 'stripe' || normalized === 'polar' || normalized === 'creem') {`
);

// 6. Update getProviderConfigurationError
content = content.replace(
    /if \(provider === 'polar'\) \{[\s\S]*?\n\s*\}/,
    `$&
    if (provider === 'creem') {
        return getCreemProductId(productCode)
            ? 'Creem checkout is not configured right now. Please choose another or try again later.'
            : 'Creem checkout is not configured for this product right now.';
    }`
);

// 7. Update getPaymentConfig gateways
content = content.replace(
    /gateways: \{\n\s*stripe: hasStripeGatewayAccess\(\),\n\s*polar: Boolean\(POLAR_ACCESS_TOKEN\)\n\s*\}/,
    `gateways: {
            stripe: hasStripeGatewayAccess(),
            polar: Boolean(POLAR_ACCESS_TOKEN),
            creem: hasRealSecret(process.env.CREEM_API_KEY)
        }`
);

// 8. Add createCreemCheckoutSession
content = content.replace(
    /async function createHostedCheckout\(options\) \{/,
    `async function createCreemCheckoutSession(context) {
    const apiKey = process.env.CREEM_API_KEY;
    if (!hasRealSecret(apiKey)) throw new Error('Set CREEM_API_KEY before using Creem checkout.');

    const productId = getCreemProductId(context.product.productCode);
    if (!productId) throw new Error(\`Set the Creem product ID for \${context.product.productCode}.\`);

    const urls = buildCheckoutUrls(context.siteBaseUrl, context.product, 'creem', context.templateId, {
        successRedirect: context.successRedirect,
        cancelRedirect: context.cancelRedirect
    });

    const response = await fetch('https://api.creem.io/v1/checkouts', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            product_id: productId,
            success_url: urls.polarSuccessUrl, // reuse the {CHECKOUT_ID} format
            cancel_url: urls.cancelUrl,
            customer_email: context.userEmail,
            customer_name: context.userName,
            metadata: context.metadata
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || data.error || 'Creem checkout session could not be created.');
    }

    return {
        provider: 'creem',
        redirectUrl: data.url,
        providerReferenceId: data.id,
        checkoutId: data.id,
        diagnostics: { productId }
    };
}

$&`
);

// 9. Update createHostedCheckout dispatch
content = content.replace(
    /const payload = selectedProvider === 'polar'\n\s*\? await createPolarCheckoutSession\(context\)\n\s*: await createStripeCheckoutSession\(context\);/,
    `const payload = selectedProvider === 'polar'
            ? await createPolarCheckoutSession(context)
            : selectedProvider === 'creem'
                ? await createCreemCheckoutSession(context)
                : await createStripeCheckoutSession(context);`
);

// 10. Update getPaymentConfig defaults logic (gateway fallback)
content = content.replace(
    /\} else if \(gatewayAvailability\.polar\) \{\n\s*selectedProvider = 'polar';\n\s*\}/,
    `$& else if (gatewayAvailability.creem) {
        selectedProvider = 'creem';
    }`
);


// Save back
fs.writeFileSync(targetPath, content, 'utf8');
console.log('Successfully patched payments.js');
