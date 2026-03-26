const { DEFAULT_CURRENCY } = require('../../billing-catalog.js');
const { listCollectionDocuments } = require('./firebase-service');

const DEFAULT_CURRENCY_CODE = String(DEFAULT_CURRENCY || 'gbp').trim().toUpperCase() || 'GBP';

function toTimestamp(value) {
    const timestamp = new Date(value || '').getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function sum(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
}

function getDateThreshold(days) {
    return Date.now() - days * 24 * 60 * 60 * 1000;
}

function groupCounts(items, keyGetter) {
    return items.reduce((acc, item) => {
        const key = keyGetter(item);
        if (!key) return acc;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function buildTopList(items, keyGetter, labelKey) {
    const grouped = groupCounts(items, keyGetter);
    return Object.entries(grouped)
        .map(([key, count]) => ({
            [labelKey]: key,
            count
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
}

async function getAdminAnalytics(options = {}) {
    const search = String(options.search || '').trim().toLowerCase();
    const [users, payments, activityLogs, projects] = await Promise.all([
        listCollectionDocuments('users'),
        listCollectionDocuments('payments').catch(() => []),
        listCollectionDocuments('activity_logs').catch(() => []),
        listCollectionDocuments('projects').catch(() => [])
    ]);

    const now = Date.now();
    const dayThreshold = getDateThreshold(1);
    const weekThreshold = getDateThreshold(7);
    const monthThreshold = getDateThreshold(30);

    const filteredUsers = search
        ? users.filter(user => `${user.name || ''} ${user.email || ''}`.toLowerCase().includes(search))
        : users;

    const matchesSearch = value => !search || String(value || '').toLowerCase().includes(search);

    const planPayments = payments.filter(payment => payment.payment_type === 'plan_purchase' && payment.status === 'succeeded');
    const templatePayments = payments.filter(payment => payment.payment_type === 'template_download' && payment.status === 'succeeded');

    const activeSubscriptions = users.filter(user => {
        if (!user.planPaid) return false;
        if (!user.planEndsAt) return true;
        return toTimestamp(user.planEndsAt) > now;
    }).length;

    const expiredSubscriptions = users.filter(user => {
        if (!user.planPaid || !user.planEndsAt) return false;
        return toTimestamp(user.planEndsAt) <= now;
    }).length;

    const userRows = filteredUsers
        .map(user => {
            const userLogs = activityLogs.filter(log => String(log.actor_email || '').toLowerCase() === String(user.email || '').toLowerCase());
            const lastActivity = userLogs.sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at))[0] || null;
            const userProjects = projects.filter(project => String(project.owner_email || '').toLowerCase() === String(user.email || '').toLowerCase());
            return {
                name: user.name || 'Unknown user',
                email: user.email || '',
                createdAt: user.createdAt || '',
                planCode: user.planCode || 'individual',
                planStatus: user.planStatus || 'free',
                planPaid: Boolean(user.planPaid),
                projectCount: userProjects.length,
                lastActivityAt: lastActivity ? lastActivity.created_at : '',
                lastActivityType: lastActivity ? lastActivity.event_type : ''
            };
        })
        .sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));

    const paymentHistory = payments
        .filter(payment => {
            if (!search) return true;
            return [
                payment.user_email,
                payment.payment_type,
                payment.plan_code,
                payment.template_name,
                payment.payment_intent_id
            ].some(matchesSearch);
        })
        .slice()
        .sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at))
        .slice(0, 50)
        .map(payment => ({
            id: payment.payment_intent_id || payment.id,
            email: payment.user_email || '',
            amount: Number(payment.amount || 0),
            currency: payment.currency || DEFAULT_CURRENCY_CODE,
            type: payment.payment_type || 'payment',
            status: payment.status || 'unknown',
            planCode: payment.plan_code || '',
            templateName: payment.template_name || '',
            createdAt: payment.created_at || ''
        }));

    const recentActivity = activityLogs
        .filter(log => {
            if (!search) return true;
            return [
                log.actor_email,
                log.actor_name,
                log.event_type,
                log.message,
                log.target_type,
                log.target_id
            ].some(matchesSearch);
        })
        .slice()
        .sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at))
        .slice(0, 100)
        .map(log => ({
            id: log.id,
            eventType: log.event_type || '',
            actorEmail: log.actor_email || '',
            actorName: log.actor_name || '',
            targetType: log.target_type || '',
            targetId: log.target_id || '',
            message: log.message || '',
            createdAt: log.created_at || '',
            metadata: log.metadata || {}
        }));

    return {
        summary: {
            totalUsers: users.length,
            newUsersDaily: users.filter(user => toTimestamp(user.createdAt) >= dayThreshold).length,
            newUsersWeekly: users.filter(user => toTimestamp(user.createdAt) >= weekThreshold).length,
            newUsersMonthly: users.filter(user => toTimestamp(user.createdAt) >= monthThreshold).length,
            loginCount: activityLogs.filter(log => log.event_type === 'login').length,
            logoutCount: activityLogs.filter(log => log.event_type === 'logout').length,
            planPurchases: planPayments.length,
            activeSubscriptions,
            expiredSubscriptions,
            totalRevenue: sum(payments.filter(payment => payment.status === 'succeeded').map(payment => payment.amount)),
            paymentCount: payments.length,
            templatePurchases: templatePayments.length,
            templateProjectCount: projects.filter(project => project.template_id).length
        },
        templateAnalytics: {
            mostUsedTemplates: buildTopList(projects.filter(project => project.template_name), project => project.template_name, 'templateName'),
            templateUsagePerUser: Object.entries(
                projects.reduce((acc, project) => {
                    const email = String(project.owner_email || '').toLowerCase();
                    if (!email || !project.template_name) return acc;
                    if (!acc[email]) acc[email] = { email, templates: [] };
                    acc[email].templates.push(project.template_name);
                    return acc;
                }, {})
            ).map(([, entry]) => ({
                email: entry.email,
                templates: buildTopList(entry.templates.map(name => ({ name })), item => item.name, 'templateName')
            }))
        },
        users: userRows,
        payments: paymentHistory,
        activity: recentActivity
    };
}

module.exports = {
    getAdminAnalytics
};
