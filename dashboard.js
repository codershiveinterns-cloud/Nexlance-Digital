document.addEventListener('DOMContentLoaded', () => {
    const VIP_EMAILS = [
        'vijaypratap@nexlancedigital.com',
        'mehrahinal113@gmail.com'
    ];
    const trialBanner = document.getElementById('trialBanner');
    const trialTitle = document.getElementById('trialTitle');
    const trialMessage = document.getElementById('trialMessage');
    const trialCountdown = document.getElementById('trialCountdown');
    const trialTimerLabel = document.getElementById('trialTimerLabel');
    const upgradeControls = document.getElementById('upgradeControls');
    const upgradePlanBtn = document.getElementById('upgradePlanBtn');
    const plansModal = document.getElementById('plansModal');
    const closePlansModal = document.getElementById('closePlansModal');
    const planLinks = Array.from(document.querySelectorAll('[data-plan-code]'));
    const deleteAccountBtn = document.getElementById('deleteAccountBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const deleteAccountModal = document.getElementById('deleteAccountModal');
    const closeDeleteAccountModal = document.getElementById('closeDeleteAccountModal');
    const cancelDeleteAccountBtn = document.getElementById('cancelDeleteAccountBtn');
    const confirmDeleteAccountBtn = document.getElementById('confirmDeleteAccountBtn');
    const deleteAccountMessage = document.getElementById('deleteAccountMessage');
    const logoutModal = document.getElementById('logoutModal');
    const closeLogoutModal = document.getElementById('closeLogoutModal');
    const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
    const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
    const adminNavItem = document.getElementById('adminNavItem');
    const adminQuickLink = document.getElementById('adminQuickLink');
    const activityFeed = document.getElementById('activityFeed');
    const alertsSection = document.querySelector('.alerts');
    const revenueChartTitle = document.getElementById('revenueChartTitle');
    const revenueChartMeta = document.getElementById('revenueChartMeta');
    const revenueChartStatus = document.getElementById('revenueChartStatus');
    const dashboardHomeView = document.getElementById('dashboardHomeView');
    const settingsView = document.getElementById('settingsView');
    const settingsNavItem = document.getElementById('settingsNavItem');
    const settingsNavBtn = document.getElementById('settingsNavBtn');
    const dashboardNavLink = document.querySelector('.nav a[href="dashboard.html"]');
    const dashboardNavItem = dashboardNavLink ? dashboardNavLink.parentElement : null;
    const openSettingsProfileBtn = document.getElementById('openSettingsProfileBtn');
    const topbarAvatar = document.getElementById('topbarAvatar');
    const topbarProfileLabel = document.getElementById('topbarProfileLabel');
    const topbarSearchInput = document.querySelector('.topbar input');
    const settingsTabs = Array.from(document.querySelectorAll('.settings-tab'));
    const settingsPanels = Array.from(document.querySelectorAll('.settings-panel'));
    const settingsSearchInput = document.getElementById('settingsSearchInput');
    const settingsSearchStatus = document.getElementById('settingsSearchStatus');
    const themeButtons = Array.from(document.querySelectorAll('[data-theme-option]'));
    const lightThemeBtn = document.getElementById('lightThemeBtn');
    const darkThemeBtn = document.getElementById('darkThemeBtn');
    const settingsQuickOpenToggle = document.getElementById('settingsQuickOpenToggle');
    const notificationsProjectUpdates = document.getElementById('notificationsProjectUpdates');
    const notificationsBillingAlerts = document.getElementById('notificationsBillingAlerts');
    const notificationsProductTips = document.getElementById('notificationsProductTips');
    const privacyProfileVisibility = document.getElementById('privacyProfileVisibility');
    const privacyUsageAnalytics = document.getElementById('privacyUsageAnalytics');
    const privacySearchIndexing = document.getElementById('privacySearchIndexing');
    const openLogoutFromSettingsBtn = document.getElementById('openLogoutFromSettingsBtn');
    const openDeleteFromSettingsBtn = document.getElementById('openDeleteFromSettingsBtn');
    const settingsProfileAvatar = document.getElementById('settingsProfileAvatar');
    const settingsProfileName = document.getElementById('settingsProfileName');
    const settingsProfileEmail = document.getElementById('settingsProfileEmail');
    const settingsPlanBadge = document.getElementById('settingsPlanBadge');
    const settingsAccountTypeBadge = document.getElementById('settingsAccountTypeBadge');
    const settingsInfoName = document.getElementById('settingsInfoName');
    const settingsInfoEmail = document.getElementById('settingsInfoEmail');
    const settingsInfoPlan = document.getElementById('settingsInfoPlan');
    const settingsInfoAccountType = document.getElementById('settingsInfoAccountType');
    const settingsInfoCreatedAt = document.getElementById('settingsInfoCreatedAt');
    const settingsSecurityEmail = document.getElementById('settingsSecurityEmail');
    const settingsSecurityPlan = document.getElementById('settingsSecurityPlan');
    const settingsSecurityStatus = document.getElementById('settingsSecurityStatus');
    const settingsSecurityTimezone = document.getElementById('settingsSecurityTimezone');
    const THEME_STORAGE_KEY = 'nexlance_dashboard_theme';
    const SETTINGS_STORAGE_KEY = 'nexlance_dashboard_settings';

    let projectStatusChartInstance = null;
    let revenueChartInstance = null;
    let hasHandledTrialExpiry = false;
    let currentSettings = null;
    let dashboardRefreshRequestId = 0;

    function normalizeEmail(email) {
        return (email || '').trim().toLowerCase();
    }

    function getAdminApiUrl(pathname) {
        const normalizedPath = String(pathname || '').startsWith('/')
            ? String(pathname || '')
            : `/${String(pathname || '')}`;

        if (window.location.protocol === 'file:') {
            return `http://localhost:4242${normalizedPath}`;
        }

        if (/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) && window.location.port && window.location.port !== '4242') {
            return `http://localhost:4242${normalizedPath}`;
        }

        return normalizedPath;
    }

    function getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem('nexlance_user') || 'null');
        } catch (error) {
            return null;
        }
    }

    function applyRoleAwareUi() {
        const accessControl = window.NexlanceAccessControl;
        const currentUser = getCurrentUser();
        if (!accessControl || !currentUser) return;

        document.querySelectorAll('.quick-links a[href], .page-header-actions a[href]').forEach(link => {
            const href = link.getAttribute('href');
            if (!href || /^https?:/i.test(href)) return;
            link.style.display = accessControl.canAccessPage(currentUser, href) ? '' : 'none';
        });
    }

    function getScopedStorageKey(baseKey) {
        const currentUser = getCurrentUser();
        const email = normalizeEmail(currentUser && currentUser.email);
        return email ? `${baseKey}_${email}` : baseKey;
    }

    function getDefaultDashboardSettings() {
        const browserLanguage = (navigator.language || 'en-IN').toLowerCase();
        return {
            theme: localStorage.getItem(getScopedStorageKey(THEME_STORAGE_KEY)) || localStorage.getItem(THEME_STORAGE_KEY) || 'light',
            language: browserLanguage.startsWith('hi') ? 'hi-IN' : (browserLanguage === 'en-us' ? 'en-US' : 'en-IN'),
            quickOpen: true,
            notificationsProjectUpdates: true,
            notificationsBillingAlerts: true,
            notificationsProductTips: false,
            privacyProfileVisibility: true,
            privacyUsageAnalytics: true,
            privacySearchIndexing: true
        };
    }

    function getStoredDashboardSettings() {
        const defaults = getDefaultDashboardSettings();
        try {
            const scopedKey = getScopedStorageKey(SETTINGS_STORAGE_KEY);
            const stored = JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
            return stored ? { ...defaults, ...stored } : defaults;
        } catch (error) {
            return defaults;
        }
    }

    function saveDashboardSettings(nextSettings) {
        currentSettings = { ...getDefaultDashboardSettings(), ...nextSettings };
        const scopedSettingsKey = getScopedStorageKey(SETTINGS_STORAGE_KEY);
        const scopedThemeKey = getScopedStorageKey(THEME_STORAGE_KEY);
        localStorage.setItem(scopedSettingsKey, JSON.stringify(currentSettings));
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
        localStorage.setItem(scopedThemeKey, currentSettings.theme);
        localStorage.setItem(THEME_STORAGE_KEY, currentSettings.theme);
        return currentSettings;
    }

    function updateSettingsNotice(message) {
        if (!settingsSearchStatus) return;
        settingsSearchStatus.textContent = message;
    }

    function getInitials(name, email) {
        const source = String(name || email || 'NA').trim();
        const parts = source.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        }
        return source.slice(0, 2).toUpperCase();
    }

    function setAvatarContent(element, label, imageUrl) {
        if (!element) return;
        element.textContent = label;
        if (imageUrl) {
            element.style.backgroundImage = `url("${imageUrl}")`;
            element.style.color = 'transparent';
            return;
        }
        element.style.backgroundImage = '';
        element.style.color = '';
    }

    function formatInfoDate(value) {
        if (!value) return 'Not available';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return 'Not available';
        return parsed.toLocaleDateString(currentSettings && currentSettings.language ? currentSettings.language : 'en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }

    function renderDashboardGreeting() {
        const dashDate = document.getElementById('dashDate');
        if (!dashDate) return;

        const now = new Date();
        const period = now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';
        dashDate.textContent = `Good ${period} - ${now.toLocaleDateString(currentSettings && currentSettings.language ? currentSettings.language : 'en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        })}`;
    }

    function getChartPalette() {
        const styles = getComputedStyle(document.body);
        return {
            accent: styles.getPropertyValue('--accent').trim() || '#6c5ce7',
            accentSoft: styles.getPropertyValue('--accent-soft').trim() || 'rgba(108, 92, 231, 0.12)',
            text: styles.getPropertyValue('--text-secondary').trim() || '#667085',
            border: styles.getPropertyValue('--border-color').trim() || 'rgba(126, 98, 231, 0.14)'
        };
    }

    function syncThemeChoiceButtons(theme) {
        themeButtons.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-theme-option') === theme);
        });
    }

    function applyTheme(theme, options = {}) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', nextTheme);
        syncThemeChoiceButtons(nextTheme);

        if (currentSettings) {
            currentSettings.theme = nextTheme;
        }

        if (!options.skipPersist) {
            saveDashboardSettings({ ...(currentSettings || getStoredDashboardSettings()), theme: nextTheme });
        }

        if (!options.skipRefresh && (projectStatusChartInstance || revenueChartInstance)) {
            refreshDashboardData();
        }
    }

    function populateSettingsControls(settings) {
        if (settingsQuickOpenToggle) settingsQuickOpenToggle.checked = Boolean(settings.quickOpen);
        if (notificationsProjectUpdates) notificationsProjectUpdates.checked = Boolean(settings.notificationsProjectUpdates);
        if (notificationsBillingAlerts) notificationsBillingAlerts.checked = Boolean(settings.notificationsBillingAlerts);
        if (notificationsProductTips) notificationsProductTips.checked = Boolean(settings.notificationsProductTips);
        if (privacyProfileVisibility) privacyProfileVisibility.checked = Boolean(settings.privacyProfileVisibility);
        if (privacyUsageAnalytics) privacyUsageAnalytics.checked = Boolean(settings.privacyUsageAnalytics);
        if (privacySearchIndexing) privacySearchIndexing.checked = Boolean(settings.privacySearchIndexing);
        applyTheme(settings.theme, { skipPersist: true, skipRefresh: true });
    }

    function syncProfileButtonVisibility() {
        const visible = !(currentSettings && currentSettings.privacyProfileVisibility === false);
        if (!topbarProfileLabel || !topbarAvatar) return;

        if (visible) {
            topbarProfileLabel.textContent = settingsProfileName && settingsProfileName.textContent ? settingsProfileName.textContent : 'Account';
            topbarAvatar.style.visibility = '';
            return;
        }

        topbarProfileLabel.textContent = 'Account';
        topbarAvatar.textContent = 'AC';
        topbarAvatar.style.backgroundImage = '';
        topbarAvatar.style.color = '';
        topbarAvatar.style.visibility = '';
    }

    function syncMainNavState(showingSettings) {
        if (dashboardNavItem) dashboardNavItem.classList.toggle('active', !showingSettings);
        if (settingsNavItem) settingsNavItem.classList.toggle('active', Boolean(showingSettings));
    }

    function syncDashboardPreviewOverlay() {
        if (typeof applyRestrictedPreviewOverlay === 'function') applyRestrictedPreviewOverlay();
    }

    function canOpenDashboardHome() {
        if (typeof hasDashboardAccess === 'function' && hasDashboardAccess()) return true;
        if (typeof shouldShowRestrictedPreview === 'function' && shouldShowRestrictedPreview('dashboard.html')) return true;
        return false;
    }

    function showSettingsPanel(panelName, options = {}) {
        const requestedPanel = panelName || 'profile';
        const hasMatch = settingsPanels.some(panel => panel.getAttribute('data-settings-panel') === requestedPanel);
        const targetPanel = hasMatch ? requestedPanel : 'profile';
        settingsTabs.forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-settings-target') === targetPanel);
        });
        settingsPanels.forEach(panel => {
            panel.classList.toggle('active', panel.getAttribute('data-settings-panel') === targetPanel);
        });

        if (!options.skipHash) {
            const nextHash = targetPanel === 'profile' ? '#settings' : `#settings-${targetPanel}`;
            if (window.location.hash !== nextHash) window.location.hash = nextHash;
        }
    }

    function openDashboardView(options = {}) {
        if (!canOpenDashboardHome()) {
            window.location.href = 'projects.html';
            return;
        }
        if (dashboardHomeView) dashboardHomeView.hidden = false;
        if (settingsView) settingsView.hidden = true;
        syncMainNavState(false);
        syncDashboardPreviewOverlay();
        if (!options.skipHash && window.location.hash && window.location.hash !== '#dashboard') {
            history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        }
    }

    function openSettingsView(panelName = 'profile') {
        const targetHash = panelName && panelName !== 'profile' ? `#settings-${panelName}` : '#settings';
        window.location.href = `settings.html${targetHash}`;
    }

    function resolveHashRoute() {
        const hash = String(window.location.hash || '').replace(/^#/, '');
        if (!hash || hash === 'dashboard') {
            if (canOpenDashboardHome()) {
                openDashboardView({ skipHash: true });
            } else {
                window.location.href = 'projects.html';
            }
            return;
        }

        if (hash.startsWith('settings')) {
            const panelName = hash.includes('-') ? hash.split('-').slice(1).join('-') : 'profile';
            openSettingsView(panelName);
            return;
        }

        openDashboardView({ skipHash: true });
    }

    async function loadUserProfileRecord() {
        const sessionUser = getCurrentUser();
        const email = normalizeEmail(sessionUser && sessionUser.email);
        const localRecord = getLocalUsers().find(user => normalizeEmail(user.email) === email) || {};
        let firebaseRecord = {};

        try {
            if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && typeof db !== 'undefined' && db) {
                const snapshot = await db.collection('users').doc(firebase.auth().currentUser.uid).get();
                firebaseRecord = snapshot.exists ? snapshot.data() : {};
            }
        } catch (error) {
            firebaseRecord = {};
        }

        const currentPlan = typeof getCurrentPlanRecord === 'function' ? getCurrentPlanRecord() : { name: 'Individual', status: 'free' };

        const authInstance = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null;

        return {
            name: firebaseRecord.name || localRecord.name || (sessionUser && sessionUser.name) || 'Nexlance User',
            email: firebaseRecord.email || localRecord.email || (sessionUser && sessionUser.email) || 'Not available',
            accountType: firebaseRecord.accountType || localRecord.accountType || 'personal',
            createdAt: firebaseRecord.createdAt || localRecord.createdAt || null,
            avatar: authInstance && authInstance.currentUser ? authInstance.currentUser.photoURL : '',
            planName: currentPlan && currentPlan.name ? currentPlan.name : 'Individual',
            planStatus: currentPlan && currentPlan.status ? currentPlan.status : 'active'
        };
    }

    async function hydrateProfileUi() {
        const profile = await loadUserProfileRecord();
        const initials = getInitials(profile.name, profile.email);
        const accountTypeLabel = String(profile.accountType || 'personal').toLowerCase() === 'business' ? 'Business account' : 'Personal account';
        const planLabel = `${profile.planName || 'Individual'}${profile.planStatus && profile.planStatus !== 'active' ? ` - ${profile.planStatus}` : ''}`;

        setAvatarContent(settingsProfileAvatar, initials, profile.avatar);
        if (settingsProfileName) settingsProfileName.textContent = profile.name;
        if (settingsProfileEmail) settingsProfileEmail.textContent = profile.email;
        if (settingsPlanBadge) settingsPlanBadge.textContent = planLabel;
        if (settingsAccountTypeBadge) settingsAccountTypeBadge.textContent = accountTypeLabel;
        if (settingsInfoName) settingsInfoName.textContent = profile.name;
        if (settingsInfoEmail) settingsInfoEmail.textContent = profile.email;
        if (settingsInfoPlan) settingsInfoPlan.textContent = planLabel;
        if (settingsInfoAccountType) settingsInfoAccountType.textContent = accountTypeLabel;
        if (settingsInfoCreatedAt) settingsInfoCreatedAt.textContent = formatInfoDate(profile.createdAt);
        if (settingsSecurityEmail) settingsSecurityEmail.textContent = profile.email;
        if (settingsSecurityPlan) settingsSecurityPlan.textContent = planLabel;
        if (settingsSecurityStatus) settingsSecurityStatus.textContent = typeof hasDashboardAccess === 'function' && hasDashboardAccess() ? 'Protected access' : 'Limited access';
        if (settingsSecurityTimezone) settingsSecurityTimezone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local timezone';
        setAvatarContent(topbarAvatar, initials, profile.avatar);
        syncProfileButtonVisibility();
    }

    function persistSettingChange(key, value, message) {
        currentSettings = saveDashboardSettings({ ...(currentSettings || getStoredDashboardSettings()), [key]: value });
        populateSettingsControls(currentSettings);
        syncProfileButtonVisibility();
        updateSettingsNotice(message || 'Settings saved.');
    }

    async function syncAdminAccessUi() {
        if (!adminNavItem && !adminQuickLink) return;

        const accessControl = window.NexlanceAccessControl;
        const currentUser = getCurrentUser();
        const isAdminSessionActive = Boolean(accessControl && currentUser && accessControl.canAccessAdminPanel(currentUser));

        if (adminNavItem) adminNavItem.style.display = isAdminSessionActive ? '' : 'none';
        if (adminQuickLink) adminQuickLink.style.display = isAdminSessionActive ? '' : 'none';
    }

    function getDeletedAccountKey(email) {
        return normalizeEmail(email).replace(/[.#$/\[\]]/g, '_');
    }

    function getLocalUsers() {
        try {
            return JSON.parse(localStorage.getItem('nexlance_users') || '[]');
        } catch (error) {
            return [];
        }
    }

    function saveLocalUsers(users) {
        localStorage.setItem('nexlance_users', JSON.stringify(users));
    }

    function getLocalDeletedAccounts() {
        try {
            return JSON.parse(localStorage.getItem('nexlance_deleted_accounts') || '{}');
        } catch (error) {
            return {};
        }
    }

    function saveLocalDeletedAccounts(records) {
        localStorage.setItem('nexlance_deleted_accounts', JSON.stringify(records));
    }

    function buildActiveRecord() {
        return {
            status: 'active',
            label: 'Full access to the website',
            permanent: true,
            startedAt: new Date().toISOString()
        };
    }

    function getStoredTrial() {
        try {
            const currentUser = getCurrentUser();
            const scopedKey = currentUser && currentUser.email
                ? `nexlance_trial_${normalizeEmail(currentUser.email)}`
                : 'nexlance_trial';
            return JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('nexlance_trial') || 'null');
        } catch (error) {
            return null;
        }
    }

    function setStoredTrial(trial) {
        const currentUser = getCurrentUser();
        const scopedKey = currentUser && currentUser.email
            ? `nexlance_trial_${normalizeEmail(currentUser.email)}`
            : 'nexlance_trial';
        localStorage.setItem(scopedKey, JSON.stringify(trial));
        localStorage.setItem('nexlance_trial', JSON.stringify(trial));
    }

    function formatRemaining(ms) {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }

    function handleTrialExpiry(trial) {
        if (hasHandledTrialExpiry) return;
        hasHandledTrialExpiry = true;

        const expiredTrial = {
            status: 'expired',
            label: '3-day dashboard trial expired',
            startedAt: trial && trial.startedAt ? trial.startedAt : new Date().toISOString(),
            endsAt: trial && trial.endsAt ? trial.endsAt : new Date().toISOString()
        };

        setStoredTrial(expiredTrial);

        if (typeof activateIndividualPlanAccess === 'function') {
            activateIndividualPlanAccess({ reason: 'expired', trialRecord: expiredTrial });
        }

        if (typeof syncPlanUiVisibility === 'function') syncPlanUiVisibility();

        if (typeof showToast === 'function') {
            showToast('Your 3-day dashboard trial has ended. Redirecting to Projects.', 'info');
        }

        window.setTimeout(() => {
            window.location.href = 'projects.html';
        }, 900);
    }

    function renderTrialState() {
        if (!trialBanner || !trialCountdown || !trialTimerLabel) return;
        const currentPlan = typeof getCurrentPlanRecord === 'function' ? getCurrentPlanRecord() : { code: 'individual', name: 'Individual' };
        const trialState = typeof getTrialAccessState === 'function'
            ? getTrialAccessState()
            : { isActive: false, record: typeof getStoredTrial === 'function' ? getStoredTrial() : null };

        function getPlanAccessMessage(plan) {
            const normalizedCode = String(plan && plan.code || '').toLowerCase();
            if (normalizedCode === 'plus') {
                return 'You can access Dashboard, Projects, Settings, Support Info, Access / Roles, and Services.';
            }
            if (normalizedCode === 'pro') {
                return 'You can access Dashboard, Projects, Settings, Support Info, Access / Roles, Services, Invoices, and Team, plus up to 4 templates.';
            }
            if (normalizedCode === 'business') {
                return 'You can access the complete dashboard, including Clients and Reports, plus all 8 templates.';
            }
            return 'You can access the dashboard.';
        }

        trialBanner.style.display = 'flex';

        if (typeof isPaidPlanActive === 'function' && isPaidPlanActive()) {
            trialBanner.classList.remove('expired');
            trialBanner.classList.add('active');
            trialTitle.textContent = `${currentPlan.name || 'Paid'} plan is active`;
            if (currentPlan.endsAt) {
                const remainingMs = new Date(currentPlan.endsAt).getTime() - Date.now();
                trialMessage.textContent = `${getPlanAccessMessage(currentPlan)} Access remains active until ${new Date(currentPlan.endsAt).toLocaleDateString()}.`;
                trialTimerLabel.textContent = 'Expires in';
                trialCountdown.textContent = formatRemaining(remainingMs);
            } else {
                trialMessage.textContent = getPlanAccessMessage(currentPlan);
                trialTimerLabel.textContent = 'Plan';
                trialCountdown.textContent = currentPlan.name || 'Paid';
            }
            if (upgradeControls) upgradeControls.hidden = true;
            return;
        }

        if (trialState.isActive) {
            const trial = trialState.record || (typeof getStoredTrial === 'function' ? getStoredTrial() : null);
            const trialEndsAt = trial && trial.endsAt ? new Date(trial.endsAt).getTime() : NaN;
            const remainingMs = Number.isFinite(trialEndsAt) ? (trialEndsAt - Date.now()) : 0;

            if (remainingMs <= 0) {
                handleTrialExpiry(trial);
                return;
            }

            trialBanner.classList.remove('expired');
            trialBanner.classList.add('active');
            trialTitle.textContent = '3-day dashboard trial is active';
            trialMessage.textContent = 'You can use all dashboard features during the trial. Templates still require separate payment.';
            trialTimerLabel.textContent = 'Trial ends in';
            trialCountdown.textContent = formatRemaining(remainingMs);
            if (upgradeControls) upgradeControls.hidden = false;
            return;
        }

        trialBanner.classList.remove('active');
        trialBanner.classList.add('expired');
        trialTitle.textContent = currentPlan.status === 'expired' ? 'Dashboard trial expired' : 'Dashboard is locked';
        trialMessage.textContent = 'Your 3-day dashboard trial has ended. The dashboard is locked now and only the Projects section is accessible.';
        trialTimerLabel.textContent = 'Plan';
        trialCountdown.textContent = 'Projects only';
        if (upgradeControls) upgradeControls.hidden = false;
    }

    async function activatePaidPlan(planCode) {
        closeModal();
        const normalizedPlanCode = String(planCode || '').trim().toLowerCase();
        if (['plus', 'pro', 'business'].includes(normalizedPlanCode)) {
            window.location.href = `pricing.html?checkout=${encodeURIComponent(normalizedPlanCode)}`;
            return;
        }
        if (typeof showToast === 'function') {
            showToast('This plan is not activated from the dashboard. Use the pricing page to upgrade securely.', 'info');
        }
    }

    function openPlansModal() {
        if (!plansModal) return;
        plansModal.classList.add('open');
        plansModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
    }

    function closeModal() {
        if (!plansModal) return;
        plansModal.classList.remove('open');
        plansModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function destroyRevenueChart() {
        if (revenueChartInstance) {
            revenueChartInstance.destroy();
            revenueChartInstance = null;
        }
    }

    function getInvoiceAmount(invoice) {
        return Number(invoice && (invoice.total_amount || invoice.amount) || 0);
    }

    function getInvoiceTimelineDate(invoice, mode) {
        const candidateKeys = mode === 'paid'
            ? ['paid_date', 'updated_at', 'created_at']
            : ['due_date', 'created_at', 'updated_at'];

        for (const key of candidateKeys) {
            const value = invoice && invoice[key];
            if (!value) continue;
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed;
            }
        }

        return null;
    }

    function getRevenueChartYear(invoices) {
        const years = invoices.reduce((list, invoice) => {
            const paidDate = invoice.status === 'paid' ? getInvoiceTimelineDate(invoice, 'paid') : null;
            const pendingDate = ['pending', 'overdue'].includes(invoice.status) ? getInvoiceTimelineDate(invoice, 'pending') : null;
            if (paidDate) list.push(paidDate.getFullYear());
            if (pendingDate) list.push(pendingDate.getFullYear());
            return list;
        }, []);

        return years.length ? Math.max(...years) : new Date().getFullYear();
    }

    function setRevenueChartState({ year, meta, status, tone = 'default', hideCanvas = false }) {
        const revenueChart = document.getElementById('revenueChart');
        if (revenueChartTitle) {
            revenueChartTitle.textContent = year ? `Revenue Analytics - ${year}` : 'Revenue Analytics';
        }
        if (revenueChartMeta) {
            revenueChartMeta.textContent = meta || 'Actual revenue and pending payments from live invoice data.';
        }
        if (revenueChartStatus) {
            revenueChartStatus.textContent = status || '';
            revenueChartStatus.classList.toggle('is-empty', tone === 'empty');
            revenueChartStatus.classList.toggle('is-error', tone === 'error');
        }
        if (revenueChart) {
            revenueChart.hidden = hideCanvas;
        }
    }

    function renderRevenueChart(invoices) {
        const revenueChart = document.getElementById('revenueChart');
        const year = getRevenueChartYear(invoices);
        if (!revenueChart) return;
        if (typeof Chart === 'undefined') {
            destroyRevenueChart();
            setRevenueChartState({
                year,
                meta: 'The revenue chart could not load because the chart library is unavailable.',
                status: 'Unavailable',
                tone: 'error',
                hideCanvas: true
            });
            return;
        }

        const palette = getChartPalette();
        const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const actualRevenueByMonth = new Array(12).fill(0);
        const pendingRevenueByMonth = new Array(12).fill(0);

        invoices.forEach(invoice => {
            if (invoice.status === 'paid') {
                const paidDate = getInvoiceTimelineDate(invoice, 'paid');
                if (paidDate && paidDate.getFullYear() === year) {
                    actualRevenueByMonth[paidDate.getMonth()] += getInvoiceAmount(invoice);
                }
                return;
            }

            if (['pending', 'overdue'].includes(invoice.status)) {
                const pendingDate = getInvoiceTimelineDate(invoice, 'pending');
                if (pendingDate && pendingDate.getFullYear() === year) {
                    pendingRevenueByMonth[pendingDate.getMonth()] += getInvoiceAmount(invoice);
                }
            }
        });

        const hasActualRevenue = actualRevenueByMonth.some(value => value > 0);
        const hasPendingRevenue = pendingRevenueByMonth.some(value => value > 0);

        if (!hasActualRevenue && !hasPendingRevenue) {
            destroyRevenueChart();
            setRevenueChartState({
                year,
                meta: `No paid or pending invoice totals are available for ${year} yet.`,
                status: 'No data',
                tone: 'empty',
                hideCanvas: true
            });
            return;
        }

        revenueChart.hidden = false;
        destroyRevenueChart();
        revenueChartInstance = new Chart(revenueChart.getContext('2d'), {
            type: 'line',
            data: {
                labels: monthLabels,
                datasets: [
                    {
                        label: 'Actual Revenue',
                        data: actualRevenueByMonth,
                        borderColor: palette.accent,
                        backgroundColor: palette.accentSoft,
                        pointBackgroundColor: palette.accent,
                        pointBorderColor: palette.accent,
                        fill: true,
                        tension: 0.35
                    },
                    {
                        label: 'Pending Payments',
                        data: pendingRevenueByMonth,
                        borderColor: '#f39c12',
                        backgroundColor: 'rgba(243, 156, 18, 0.1)',
                        pointBackgroundColor: '#f39c12',
                        pointBorderColor: '#f39c12',
                        fill: true,
                        tension: 0.35,
                        borderDash: [8, 6]
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            color: palette.text
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: palette.text },
                        grid: { color: palette.border }
                    },
                    y: {
                        ticks: { color: palette.text },
                        grid: { color: palette.border }
                    }
                }
            }
        });

        const activeSeriesLabel = hasActualRevenue && hasPendingRevenue
            ? 'Live'
            : hasActualRevenue
                ? 'Actual only'
                : 'Pending only';
        const invoiceCount = invoices.filter(invoice => {
            if (invoice.status === 'paid') {
                const paidDate = getInvoiceTimelineDate(invoice, 'paid');
                return paidDate && paidDate.getFullYear() === year;
            }
            if (['pending', 'overdue'].includes(invoice.status)) {
                const pendingDate = getInvoiceTimelineDate(invoice, 'pending');
                return pendingDate && pendingDate.getFullYear() === year;
            }
            return false;
        }).length;

        setRevenueChartState({
            year,
            meta: `Actual revenue and pending payments aggregated from ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} in ${year}.`,
            status: activeSeriesLabel,
            hideCanvas: false
        });
    }

    function renderProjectStatusChart(projects) {
        const projectStatusChart = document.getElementById('projectStatusChart');
        if (!projectStatusChart || typeof Chart === 'undefined') return;
        const palette = getChartPalette();

        const labels = ['Planning', 'Design', 'Development', 'Testing', 'Live', 'On Hold'];
        const counts = labels.map(label => projects.filter(project => project.status === label).length);

        if (projectStatusChartInstance) projectStatusChartInstance.destroy();
        projectStatusChartInstance = new Chart(projectStatusChart.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: counts,
                    backgroundColor: ['#a29bfe', '#6c5ce7', '#4b3fbf', '#b2bec3', '#00b894', '#fab1a0']
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: palette.text
                        }
                    }
                }
            }
        });
    }

    function renderActivity(clients, projects, invoices) {
        if (!activityFeed) return;

        if (isUpgradeRequiredForData()) {
            activityFeed.innerHTML = `<li>${getUpgradeRequiredMessage()}</li>`;
            return;
        }

        const items = [];
        const recentPaid = invoices
            .filter(invoice => invoice.status === 'paid')
            .sort((a, b) => new Date(b.paid_date || b.updated_at || 0) - new Date(a.paid_date || a.updated_at || 0))
            .slice(0, 2);
        recentPaid.forEach(invoice => items.push(`Payment received from ${invoice.client_name || 'a client'} for ${formatCurrency(invoice.total_amount || 0)}`));

        projects
            .filter(project => project.status === 'Live')
            .slice(0, 2)
            .forEach(project => items.push(`${project.name} is marked live`));

        clients
            .slice(0, 2)
            .forEach(client => items.push(`${client.name} is in your client list`));

        activityFeed.innerHTML = (items.length ? items : ['No recent real activity yet.']).map(item => `<li>${item}</li>`).join('');
    }

    function renderAlerts(clients, projects, invoices) {
        if (!alertsSection) return;

        if (isUpgradeRequiredForData()) {
            alertsSection.innerHTML = `<h3>Urgent Alerts</h3><div class="alert danger">${getUpgradeRequiredMessage()}</div>`;
            return;
        }

        const alerts = [];
        const delayedProjects = projects.filter(project => {
            if (!project.deadline || project.status === 'Live') return false;
            return new Date(project.deadline) < new Date();
        });
        if (delayedProjects.length) {
            alerts.push(`<div class="alert danger">${delayedProjects.length} project${delayedProjects.length > 1 ? 's are' : ' is'} past deadline</div>`);
        }

        const expiringHosts = clients.filter(client => {
            if (!client.hosting_expiry) return false;
            const days = (new Date(client.hosting_expiry) - new Date()) / 86400000;
            return days >= 0 && days <= 30;
        });
        if (expiringHosts.length) {
            alerts.push(`<div class="alert warning">${expiringHosts.length} hosting renewal${expiringHosts.length > 1 ? 's are' : ' is'} due within 30 days</div>`);
        }

        const outstanding = invoices.filter(invoice => ['pending', 'overdue'].includes(invoice.status));
        if (outstanding.length) {
            alerts.push(`<div class="alert danger">${outstanding.length} unpaid invoice${outstanding.length > 1 ? 's' : ''} need follow-up</div>`);
        }

        alertsSection.innerHTML = `<h3>Urgent Alerts</h3>${alerts.join('') || '<div class="alert warning">No urgent real-data alerts right now.</div>'}`;
    }

    async function ensureSessionReadyForDashboard(reason = 'dashboard_refresh') {
        if (
            window.NexlanceSessionState &&
            typeof window.NexlanceSessionState.ensureSessionHydration === 'function'
        ) {
            await window.NexlanceSessionState.ensureSessionHydration(reason, { forceRetry: true });
        }
    }

    async function refreshDashboardData() {
        const requestId = ++dashboardRefreshRequestId;
        await ensureSessionReadyForDashboard('dashboard_refresh');
        if (requestId !== dashboardRefreshRequestId) return;

        destroyRevenueChart();
        setRevenueChartState({
            year: getRevenueChartYear([]),
            meta: 'Loading actual revenue and pending payments from invoices...',
            status: 'Loading...',
            hideCanvas: true
        });

        try {
            const [clients, projects, invoices] = await Promise.all([
                fetchClients(),
                fetchProjects(),
                fetchInvoices()
            ]);
            if (requestId !== dashboardRefreshRequestId) return;

            const paidInvoices = invoices.filter(invoice => invoice.status === 'paid');
            const pendingInvoices = invoices.filter(invoice => ['pending', 'overdue'].includes(invoice.status));
            const activeProjects = projects.filter(project => !['Live', 'On Hold'].includes(project.status));
            const planningProjects = projects.filter(project => project.status === 'Planning');
            const overdueProjects = projects.filter(project => {
                if (!project.deadline || project.status === 'Live') return false;
                return new Date(project.deadline) < new Date();
            });

            setText('dRevenue', formatCurrency(paidInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0)));
            setText('dProjects', String(activeProjects.length));
            setText('dApprovals', String(planningProjects.length));
            setText('dOverdue', String(overdueProjects.length));
            setText('dPending', formatCurrency(pendingInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0)));

            renderProjectStatusChart(projects);
            renderRevenueChart(invoices);
            renderActivity(clients, projects, invoices);
            renderAlerts(clients, projects, invoices);
        } catch (error) {
            console.error('Dashboard refresh failed:', error);
            destroyRevenueChart();
            setRevenueChartState({
                year: getRevenueChartYear([]),
                meta: 'We could not load revenue analytics right now. Please try again in a moment.',
                status: 'Error',
                tone: 'error',
                hideCanvas: true
            });
        }
    }

    if (upgradePlanBtn) {
        upgradePlanBtn.addEventListener('click', openPlansModal);
    }

    if (closePlansModal) {
        closePlansModal.addEventListener('click', closeModal);
    }

    if (plansModal) {
        plansModal.addEventListener('click', event => {
            if (event.target === plansModal) closeModal();
        });
    }

    planLinks.forEach(link => {
        link.addEventListener('click', async event => {
            event.preventDefault();
            const planCode = link.getAttribute('data-plan-code');
            if (!planCode) return;
            try {
                await activatePaidPlan(planCode);
            } catch (error) {
                console.error('Plan activation failed:', error);
            }
        });
    });

    settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-settings-target') || 'profile';
            openSettingsView(target);
        });
    });

    if (settingsNavBtn) {
        settingsNavBtn.addEventListener('click', () => {
            openSettingsView('profile');
        });
    }

    if (dashboardNavLink) {
        dashboardNavLink.addEventListener('click', event => {
            event.preventDefault();
            openDashboardView();
        });
    }

    if (openSettingsProfileBtn) {
        openSettingsProfileBtn.addEventListener('click', () => {
            if (currentSettings && currentSettings.quickOpen === false) {
                updateSettingsNotice('Quick-open is off. Re-enable it in Preferences to open Settings from the profile button.');
                if (topbarSearchInput) topbarSearchInput.focus();
                return;
            }
            openSettingsView('profile');
        });
    }

    if (settingsSearchInput) {
        settingsSearchInput.addEventListener('input', event => {
            const query = String(event.target.value || '').trim().toLowerCase();
            if (!query) {
                updateSettingsNotice('Use the left sections to navigate your account settings.');
                return;
            }

            if (currentSettings && currentSettings.privacySearchIndexing === false) {
                updateSettingsNotice('Local settings search is currently disabled in Privacy.');
                return;
            }

            const matchingPanel = settingsPanels.find(panel => {
                const keywords = `${panel.getAttribute('data-settings-panel') || ''} ${panel.getAttribute('data-settings-keywords') || ''}`.toLowerCase();
                return keywords.includes(query);
            });

            if (matchingPanel) {
                const panelName = matchingPanel.getAttribute('data-settings-panel') || 'profile';
                openSettingsView(panelName);
                updateSettingsNotice(`Showing "${panelName}" settings for "${query}".`);
                return;
            }

            updateSettingsNotice(`No settings section matched "${query}".`);
        });
    }

    themeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const theme = button.getAttribute('data-theme-option') || 'light';
            applyTheme(theme);
            persistSettingChange('theme', theme, `Theme updated to ${theme} mode.`);
        });
    });

    if (settingsQuickOpenToggle) {
        settingsQuickOpenToggle.addEventListener('change', event => {
            persistSettingChange('quickOpen', event.target.checked, event.target.checked ? 'Quick-open enabled.' : 'Quick-open disabled.');
        });
    }

    if (notificationsProjectUpdates) {
        notificationsProjectUpdates.addEventListener('change', event => {
            persistSettingChange('notificationsProjectUpdates', event.target.checked, 'Project alert preference saved.');
        });
    }

    if (notificationsBillingAlerts) {
        notificationsBillingAlerts.addEventListener('change', event => {
            persistSettingChange('notificationsBillingAlerts', event.target.checked, 'Billing reminder preference saved.');
        });
    }

    if (notificationsProductTips) {
        notificationsProductTips.addEventListener('change', event => {
            persistSettingChange('notificationsProductTips', event.target.checked, 'Product tip preference saved.');
        });
    }

    if (privacyProfileVisibility) {
        privacyProfileVisibility.addEventListener('change', event => {
            persistSettingChange('privacyProfileVisibility', event.target.checked, 'Profile visibility preference saved.');
            hydrateProfileUi().catch(() => {});
        });
    }

    if (privacyUsageAnalytics) {
        privacyUsageAnalytics.addEventListener('change', event => {
            persistSettingChange('privacyUsageAnalytics', event.target.checked, 'Usage analytics preference saved.');
        });
    }

    if (privacySearchIndexing) {
        privacySearchIndexing.addEventListener('change', event => {
            persistSettingChange('privacySearchIndexing', event.target.checked, event.target.checked ? 'Settings search enabled.' : 'Settings search disabled.');
        });
    }

    function openDeleteAccountModal() {
        if (!deleteAccountModal) return;
        deleteAccountModal.classList.add('open');
        deleteAccountModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        if (deleteAccountMessage) {
            deleteAccountMessage.textContent = '';
            deleteAccountMessage.className = 'form-message';
        }
    }

    function closeDeleteModal() {
        if (!deleteAccountModal) return;
        deleteAccountModal.classList.remove('open');
        deleteAccountModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
    }

    function openLogoutModal() {
        if (!logoutModal) return;
        logoutModal.classList.add('open');
        logoutModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
    }

    function closeLogoutModalDialog() {
        if (!logoutModal) return;
        logoutModal.classList.remove('open');
        logoutModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
    }

    async function logoutCurrentUser() {
        const currentUser = getCurrentUser();
        if (confirmLogoutBtn) {
            confirmLogoutBtn.disabled = true;
            confirmLogoutBtn.textContent = 'Logging out...';
        }

        try {
        if (typeof firebase !== 'undefined' && firebase.auth) {
            await firebase.auth().signOut();
        }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            if (typeof trackPlatformActivity === 'function' && currentUser && currentUser.email) {
                await trackPlatformActivity('logout', {
                    actorEmail: currentUser.email,
                    actorName: currentUser.name || currentUser.email,
                    message: 'User logged out successfully.'
                });
            }
            localStorage.removeItem('nexlance_auth');
            localStorage.removeItem('nexlance_user');
            localStorage.removeItem('nexlance_trial');
            localStorage.removeItem('nexlance_admin_ui');
            window.location.href = 'index.html';
        }
    }

    async function deleteCurrentAccount() {
        const currentUser = getCurrentUser();
        const email = normalizeEmail(currentUser && currentUser.email);

        if (!email) {
            if (deleteAccountMessage) {
                deleteAccountMessage.textContent = 'No signed-in account found.';
                deleteAccountMessage.className = 'form-message error';
            }
            return;
        }

        if (confirmDeleteAccountBtn) {
            confirmDeleteAccountBtn.disabled = true;
            confirmDeleteAccountBtn.textContent = 'Deleting...';
        }

        try {
            const deletedRecord = {
                email,
                deletedAt: new Date().toISOString(),
                trialUsed: true
            };

            if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
                const authUser = firebase.auth().currentUser;
                await db.collection('deleted_accounts').doc(getDeletedAccountKey(email)).set(deletedRecord);
                await db.collection('users').doc(authUser.uid).delete();
                await authUser.delete();
            } else {
                const users = getLocalUsers().filter(user => normalizeEmail(user.email) !== email);
                saveLocalUsers(users);
                const deletedAccounts = getLocalDeletedAccounts();
                deletedAccounts[email] = deletedRecord;
                saveLocalDeletedAccounts(deletedAccounts);
            }

            localStorage.removeItem('nexlance_auth');
            localStorage.removeItem('nexlance_user');
            localStorage.removeItem('nexlance_trial');
            window.location.href = 'login.html';
        } catch (error) {
            if (deleteAccountMessage) {
                deleteAccountMessage.textContent = error.code === 'auth/requires-recent-login'
                    ? 'Please log in again, then delete the account.'
                    : 'Could not delete the account. Please try again.';
                deleteAccountMessage.className = 'form-message error';
            }
            if (confirmDeleteAccountBtn) {
                confirmDeleteAccountBtn.disabled = false;
                confirmDeleteAccountBtn.textContent = 'Yes, delete account';
            }
        }
    }

    if (deleteAccountBtn) deleteAccountBtn.addEventListener('click', openDeleteAccountModal);
    if (logoutBtn) logoutBtn.addEventListener('click', openLogoutModal);
    if (openDeleteFromSettingsBtn) openDeleteFromSettingsBtn.addEventListener('click', openDeleteAccountModal);
    if (openLogoutFromSettingsBtn) openLogoutFromSettingsBtn.addEventListener('click', openLogoutModal);
    if (closeDeleteAccountModal) closeDeleteAccountModal.addEventListener('click', closeDeleteModal);
    if (cancelDeleteAccountBtn) cancelDeleteAccountBtn.addEventListener('click', closeDeleteModal);
    if (confirmDeleteAccountBtn) confirmDeleteAccountBtn.addEventListener('click', deleteCurrentAccount);
    if (closeLogoutModal) closeLogoutModal.addEventListener('click', closeLogoutModalDialog);
    if (cancelLogoutBtn) cancelLogoutBtn.addEventListener('click', closeLogoutModalDialog);
    if (confirmLogoutBtn) confirmLogoutBtn.addEventListener('click', logoutCurrentUser);

    syncAdminAccessUi().catch(() => {});

    if (deleteAccountModal) {
        deleteAccountModal.addEventListener('click', event => {
            if (event.target === deleteAccountModal) closeDeleteModal();
        });
    }

    if (logoutModal) {
        logoutModal.addEventListener('click', event => {
            if (event.target === logoutModal) closeLogoutModalDialog();
        });
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && plansModal && plansModal.classList.contains('open')) closeModal();
        if (event.key === 'Escape' && deleteAccountModal && deleteAccountModal.classList.contains('open')) closeDeleteModal();
        if (event.key === 'Escape' && logoutModal && logoutModal.classList.contains('open')) closeLogoutModalDialog();
    });

    const currentUser = getCurrentUser();
    if (VIP_EMAILS.includes(normalizeEmail(currentUser && currentUser.email))) {
        setStoredTrial(buildActiveRecord());
    }

    (async () => {
        await ensureSessionReadyForDashboard('dashboard_bootstrap');
        currentSettings = getStoredDashboardSettings();
        populateSettingsControls(currentSettings);
        renderDashboardGreeting();
        syncProfileButtonVisibility();
        applyRoleAwareUi();
        resolveHashRoute();
        hydrateProfileUi().catch(error => {
            console.error('Could not load settings profile:', error);
        });
        renderTrialState();
        refreshDashboardData();
    })().catch(error => {
        console.error('Dashboard bootstrap failed:', error);
    });

    window.setInterval(renderTrialState, 60000);

    // Throttle: prevent refreshDashboardData from firing more than once per 30s
    let _dashboardRefreshCooldownUntil = 0;
    let _dashboardRefreshPendingTimer = null;
    function throttledDashboardRefresh() {
        const now = Date.now();
        if (now < _dashboardRefreshCooldownUntil) {
            if (!_dashboardRefreshPendingTimer) {
                _dashboardRefreshPendingTimer = setTimeout(function() {
                    _dashboardRefreshPendingTimer = null;
                    throttledDashboardRefresh();
                }, _dashboardRefreshCooldownUntil - now + 100);
            }
            return;
        }
        _dashboardRefreshCooldownUntil = now + 30000;
        refreshDashboardData();
    }

    window.addEventListener('focus', throttledDashboardRefresh);
    window.addEventListener('nexlance-project-updated', throttledDashboardRefresh);
    window.addEventListener('nexlance-project-completed', throttledDashboardRefresh);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) throttledDashboardRefresh();
    });
    window.addEventListener('hashchange', resolveHashRoute);
});
