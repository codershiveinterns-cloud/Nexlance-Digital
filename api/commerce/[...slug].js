const checkoutCompleteHandler = require('../../backend/api/checkout-complete');
const checkoutStartHandler = require('../../backend/api/checkout-start');
const confirmBusinessUpgradeHandler = require('../../backend/api/confirm-business-upgrade');
const createPaymentIntentHandler = require('../../backend/api/create-payment-intent');
const paymentConfigHandler = require('../../backend/api/payment-config');
const projectTemplateWorkspaceCompleteHandler = require('../../backend/api/project-template-workspace-complete');
const projectTemplateDownloadHandler = require('../../backend/api/project-template-download');
const projectTemplateWorkspaceHandler = require('../../backend/api/project-template-workspace');
const projectTemplateWorkspaceSaveHandler = require('../../backend/api/project-template-workspace-save');
const projectTemplateWorkspaceUnlockHandler = require('../../backend/api/project-template-workspace-unlock');
const projectSyncHandler = require('../../backend/api/project-sync');
const stripeWebhookHandler = require('../../backend/api/stripe-webhook');
const templateAccessCompleteHandler = require('../../backend/api/template-access-complete');
const templateAccessStartHandler = require('../../backend/api/template-access-start');
const templateDownloadHandler = require('../../backend/api/template-download');

const ROUTE_HANDLERS = {
    'checkout-complete': checkoutCompleteHandler,
    'checkout-start': checkoutStartHandler,
    'confirm-business-upgrade': confirmBusinessUpgradeHandler,
    'create-payment-intent': createPaymentIntentHandler,
    'payment-config': paymentConfigHandler,
    'project-template-workspace': projectTemplateWorkspaceHandler,
    'project-template-workspace-complete': projectTemplateWorkspaceCompleteHandler,
    'project-template-download': projectTemplateDownloadHandler,
    'project-template-workspace-save': projectTemplateWorkspaceSaveHandler,
    'project-template-workspace-unlock': projectTemplateWorkspaceUnlockHandler,
    'project-sync': projectSyncHandler,
    'stripe-webhook': stripeWebhookHandler,
    'template-access-complete': templateAccessCompleteHandler,
    'template-access-start': templateAccessStartHandler,
    'template-download': templateDownloadHandler
};

function getRequestPathname(req) {
    const directRequestUrl = String((req && req.url) || '').trim();
    const matchedPathHeader = req && req.headers
        ? (req.headers['x-matched-path'] || req.headers['x-invoke-path'])
        : '';
    const requestUrl = directRequestUrl || String(matchedPathHeader || '').trim();

    if (!requestUrl) {
        return '';
    }

    try {
        return new URL(requestUrl, 'https://nexlance.local').pathname;
    } catch (error) {
        return requestUrl.split('?')[0].trim();
    }
}

function getSlugParts(req) {
    const source = req && req.query ? req.query.slug : [];
    const slugFromQuery = (Array.isArray(source) ? source : [source])
        .map(entry => String(entry || '').trim())
        .filter(Boolean);

    if (slugFromQuery.length) {
        return slugFromQuery;
    }

    const pathname = getRequestPathname(req);
    const routePrefix = '/api/commerce/';
    if (pathname.startsWith(routePrefix)) {
        return pathname
            .slice(routePrefix.length)
            .split('/')
            .map(entry => String(entry || '').trim())
            .filter(Boolean);
    }

    const legacyApiPrefix = '/api/';
    if (!pathname.startsWith(legacyApiPrefix)) {
        return [];
    }

    return pathname
        .slice(legacyApiPrefix.length)
        .split('/')
        .map(entry => String(entry || '').trim())
        .filter(Boolean);
}

module.exports = async function handler(req, res) {
    const slugParts = getSlugParts(req);
    if (slugParts.length !== 1) {
        res.status(404).json({ error: 'Commerce route not found.' });
        return;
    }

    const routeKey = slugParts[0];
    const routeHandler = ROUTE_HANDLERS[routeKey];
    if (!routeHandler) {
        res.status(404).json({ error: 'Commerce route not found.' });
        return;
    }

    return routeHandler(req, res);
};
