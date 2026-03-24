(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }

    root.NEXLANCE_BILLING_CATALOG = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const DEFAULT_CURRENCY = 'eur';

    const PRODUCT_CATALOG = {
        single_template: {
            productCode: 'single_template',
            planCode: 'single_template',
            displayName: 'Single Template',
            price: 19900,
            currency: DEFAULT_CURRENCY,
            billingType: 'one_time',
            successRedirect: 'index.html#template-access',
            entitlements: {
                dashboardAccess: false,
                allTemplates: false,
                singleTemplatePurchase: true
            },
            limits: {
                templateDownloads: 1
            }
        },
        plus_monthly: {
            productCode: 'plus_monthly',
            planCode: 'plus',
            displayName: 'Plus',
            price: 59900,
            currency: DEFAULT_CURRENCY,
            billingType: 'subscription',
            billingCycle: 'monthly',
            successRedirect: 'dashboard.html',
            entitlements: {
                dashboardAccess: true,
                allTemplates: false,
                singleTemplatePurchase: false
            },
            limits: {
                aiCreditsPerMonth: 5,
                storageGb: 10,
                supportTier: 'email'
            }
        },
        plus_yearly: {
            productCode: 'plus_yearly',
            planCode: 'plus',
            displayName: 'Plus',
            price: 575040,
            currency: DEFAULT_CURRENCY,
            billingType: 'subscription',
            billingCycle: 'yearly',
            successRedirect: 'dashboard.html',
            entitlements: {
                dashboardAccess: true,
                allTemplates: false,
                singleTemplatePurchase: false
            },
            limits: {
                aiCreditsPerMonth: 5,
                storageGb: 10,
                supportTier: 'email'
            }
        },
        pro_onetime: {
            productCode: 'pro_onetime',
            planCode: 'pro',
            displayName: 'Pro',
            price: 149900,
            currency: DEFAULT_CURRENCY,
            billingType: 'one_time',
            billingCycle: 'one_time',
            successRedirect: 'templates.html',
            entitlements: {
                dashboardAccess: false,
                allTemplates: true,
                singleTemplatePurchase: false
            },
            limits: {
                allTemplates: true,
                supportTier: 'priority'
            }
        },
        business_monthly: {
            productCode: 'business_monthly',
            planCode: 'business',
            displayName: 'Business',
            price: 179900,
            currency: DEFAULT_CURRENCY,
            billingType: 'subscription',
            billingCycle: 'monthly',
            successRedirect: 'dashboard.html',
            entitlements: {
                dashboardAccess: true,
                allTemplates: true,
                singleTemplatePurchase: false
            },
            limits: {
                aiCreditsPerMonth: 50,
                storageGb: 50,
                supportTier: 'priority',
                allTemplates: true
            }
        },
        business_yearly: {
            productCode: 'business_yearly',
            planCode: 'business',
            displayName: 'Business',
            price: 1727040,
            currency: DEFAULT_CURRENCY,
            billingType: 'subscription',
            billingCycle: 'yearly',
            successRedirect: 'dashboard.html',
            entitlements: {
                dashboardAccess: true,
                allTemplates: true,
                singleTemplatePurchase: false
            },
            limits: {
                aiCreditsPerMonth: 50,
                storageGb: 50,
                supportTier: 'priority',
                allTemplates: true
            }
        }
    };

    function normalizeProductCode(value) {
        return String(value || '').trim().toLowerCase();
    }

    function getProductByCode(productCode) {
        return PRODUCT_CATALOG[normalizeProductCode(productCode)] || null;
    }

    function getProducts() {
        return Object.values(PRODUCT_CATALOG);
    }

    function isDashboardProduct(productCode) {
        const product = getProductByCode(productCode);
        return Boolean(product && product.entitlements && product.entitlements.dashboardAccess);
    }

    function grantsAllTemplates(productCode) {
        const product = getProductByCode(productCode);
        return Boolean(product && product.entitlements && product.entitlements.allTemplates);
    }

    function isSingleTemplateProduct(productCode) {
        const product = getProductByCode(productCode);
        return Boolean(product && product.entitlements && product.entitlements.singleTemplatePurchase);
    }

    return {
        DEFAULT_CURRENCY,
        PRODUCT_CATALOG,
        getProducts,
        getProductByCode,
        normalizeProductCode,
        isDashboardProduct,
        grantsAllTemplates,
        isSingleTemplateProduct
    };
});
