const { getProductByCode } = require('../../billing-catalog.js');

const CODA_SKU_PRODUCT_MAP = Object.freeze({
    'NXL-TEMPLATE-001': 'single_template',
    'NXL-PLUS-M-001': 'plus_monthly',
    'NXL-PRO-M-001': 'pro_monthly',
    'NXL-BUS-M-001': 'business_monthly',
    'NXL-PLUS-Y-001': 'plus_yearly',
    'NXL-PRO-Y-001': 'pro_yearly',
    'NXL-BUS-Y-001': 'business_yearly'
});

function normalizeCodaSku(value) {
    return String(value || '').trim().toUpperCase();
}

function getCodaSkuForProduct(productCode) {
    const normalizedProductCode = String(productCode || '').trim().toLowerCase();
    return Object.entries(CODA_SKU_PRODUCT_MAP)
        .find(([, mappedProductCode]) => mappedProductCode === normalizedProductCode)?.[0] || '';
}

function resolveCodaSku(value) {
    const sku = normalizeCodaSku(value);
    const productCode = CODA_SKU_PRODUCT_MAP[sku] || '';
    if (!sku || !productCode) {
        return null;
    }

    const product = getProductByCode(productCode);
    if (!product) {
        return null;
    }

    return {
        sku,
        productCode,
        product
    };
}

module.exports = {
    CODA_SKU_PRODUCT_MAP,
    getCodaSkuForProduct,
    normalizeCodaSku,
    resolveCodaSku
};
