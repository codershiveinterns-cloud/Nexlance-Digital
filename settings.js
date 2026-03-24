document.addEventListener('DOMContentLoaded', () => {
    const shell = window.NexlanceDashboardShell;
    if (!shell) return;

    const settingsTabs = Array.from(document.querySelectorAll('.settings-tab'));
    const settingsPanels = Array.from(document.querySelectorAll('.settings-panel'));
    const settingsSearchInput = document.getElementById('settingsSearchInput');
    const settingsSearchStatus = document.getElementById('settingsSearchStatus');
    const themeButtons = Array.from(document.querySelectorAll('[data-theme-option]'));
    const topbarSearchInput = document.querySelector('.topbar input');
    const openSettingsProfileBtn = document.getElementById('openSettingsProfileBtn');
    const topbarAvatar = document.getElementById('topbarAvatar');
    const topbarProfileLabel = document.getElementById('topbarProfileLabel');
    const settingsQuickOpenToggle = document.getElementById('settingsQuickOpenToggle');
    const notificationsProjectUpdates = document.getElementById('notificationsProjectUpdates');
    const notificationsBillingAlerts = document.getElementById('notificationsBillingAlerts');
    const notificationsProductTips = document.getElementById('notificationsProductTips');
    const privacyProfileVisibility = document.getElementById('privacyProfileVisibility');
    const privacyUsageAnalytics = document.getElementById('privacyUsageAnalytics');
    const privacySearchIndexing = document.getElementById('privacySearchIndexing');
    const settingsProfileAvatar = document.getElementById('settingsProfileAvatar');
    const settingsProfileName = document.getElementById('settingsProfileName');
    const settingsProfileEmail = document.getElementById('settingsProfileEmail');
    const settingsPlanBadge = document.getElementById('settingsPlanBadge');
    const settingsAccountTypeBadge = document.getElementById('settingsAccountTypeBadge');
    const settingsInfoName = document.getElementById('settingsInfoName');
    const settingsInfoEmail = document.getElementById('settingsInfoEmail');
    const settingsInfoMobile = document.getElementById('settingsInfoMobile');
    const settingsInfoPlan = document.getElementById('settingsInfoPlan');
    const settingsInfoAccountType = document.getElementById('settingsInfoAccountType');
    const settingsInfoCreatedAt = document.getElementById('settingsInfoCreatedAt');
    const settingsSecurityEmail = document.getElementById('settingsSecurityEmail');
    const settingsSecurityPlan = document.getElementById('settingsSecurityPlan');
    const settingsSecurityStatus = document.getElementById('settingsSecurityStatus');
    const settingsSecurityTimezone = document.getElementById('settingsSecurityTimezone');
    const openLogoutFromSettingsBtn = document.getElementById('openLogoutFromSettingsBtn');
    const openDeleteFromSettingsBtn = document.getElementById('openDeleteFromSettingsBtn');
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

    let currentSettings = shell.getStoredDashboardSettings();
    let currentProfile = null;

    function normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function updateSettingsNotice(message) {
        if (settingsSearchStatus) settingsSearchStatus.textContent = message;
    }

    function getInitials(name, email) {
        const source = String(name || email || 'NA').trim();
        const parts = source.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
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
        return parsed.toLocaleDateString(currentSettings.language || 'en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }

    function syncThemeChoiceButtons(theme) {
        themeButtons.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-theme-option') === theme);
        });
    }

    function populateSettingsControls(settings) {
        if (settingsQuickOpenToggle) settingsQuickOpenToggle.checked = Boolean(settings.quickOpen);
        if (notificationsProjectUpdates) notificationsProjectUpdates.checked = Boolean(settings.notificationsProjectUpdates);
        if (notificationsBillingAlerts) notificationsBillingAlerts.checked = Boolean(settings.notificationsBillingAlerts);
        if (notificationsProductTips) notificationsProductTips.checked = Boolean(settings.notificationsProductTips);
        if (privacyProfileVisibility) privacyProfileVisibility.checked = Boolean(settings.privacyProfileVisibility);
        if (privacyUsageAnalytics) privacyUsageAnalytics.checked = Boolean(settings.privacyUsageAnalytics);
        if (privacySearchIndexing) privacySearchIndexing.checked = Boolean(settings.privacySearchIndexing);
        shell.applyTheme(settings.theme);
        syncThemeChoiceButtons(settings.theme);
    }

    function syncProfileButtonVisibility(profile) {
        if (!topbarAvatar || !topbarProfileLabel) return;

        if (currentSettings.privacyProfileVisibility === false || !profile) {
            topbarProfileLabel.textContent = 'Account';
            topbarAvatar.textContent = 'AC';
            topbarAvatar.style.backgroundImage = '';
            topbarAvatar.style.color = '';
            return;
        }

        topbarProfileLabel.textContent = profile.name;
        setAvatarContent(topbarAvatar, getInitials(profile.name, profile.email), profile.avatar);
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
            if (window.location.hash !== nextHash) {
                history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
            }
        }
    }

    function resolveHashRoute() {
        const hash = String(window.location.hash || '').replace(/^#/, '');
        if (!hash || hash === 'settings') {
            showSettingsPanel('profile', { skipHash: true });
            return;
        }

        if (hash.startsWith('settings-')) {
            showSettingsPanel(hash.split('-').slice(1).join('-'), { skipHash: true });
            return;
        }

        showSettingsPanel('profile', { skipHash: true });
    }

    function getCurrentUser() {
        return shell.getCurrentUser();
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

        const currentPlan = typeof getCurrentPlanRecord === 'function' ? getCurrentPlanRecord() : { name: 'Individual', status: 'active' };
        const authInstance = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null;

        return {
            name: firebaseRecord.name || localRecord.name || (sessionUser && sessionUser.name) || 'Nexlance User',
            email: firebaseRecord.email || localRecord.email || (sessionUser && sessionUser.email) || 'Not available',
            mobile: firebaseRecord.mobile || localRecord.mobile || 'Not added',
            accountType: firebaseRecord.accountType || localRecord.accountType || 'personal',
            createdAt: firebaseRecord.createdAt || localRecord.createdAt || null,
            avatar: authInstance && authInstance.currentUser ? authInstance.currentUser.photoURL : '',
            planName: currentPlan && currentPlan.name ? currentPlan.name : 'Individual',
            planStatus: currentPlan && currentPlan.status ? currentPlan.status : 'active'
        };
    }

    async function hydrateProfileUi() {
        currentProfile = await loadUserProfileRecord();
        const accountTypeLabel = String(currentProfile.accountType || 'personal').toLowerCase() === 'business'
            ? 'Business account'
            : 'Personal account';
        const planLabel = `${currentProfile.planName || 'Individual'}${currentProfile.planStatus && currentProfile.planStatus !== 'active' ? ` - ${currentProfile.planStatus}` : ''}`;
        const initials = getInitials(currentProfile.name, currentProfile.email);

        setAvatarContent(settingsProfileAvatar, initials, currentProfile.avatar);
        if (settingsProfileName) settingsProfileName.textContent = currentProfile.name;
        if (settingsProfileEmail) settingsProfileEmail.textContent = currentProfile.email;
        if (settingsPlanBadge) settingsPlanBadge.textContent = planLabel;
        if (settingsAccountTypeBadge) settingsAccountTypeBadge.textContent = accountTypeLabel;
        if (settingsInfoName) settingsInfoName.textContent = currentProfile.name;
        if (settingsInfoEmail) settingsInfoEmail.textContent = currentProfile.email;
        if (settingsInfoMobile) settingsInfoMobile.textContent = currentProfile.mobile;
        if (settingsInfoPlan) settingsInfoPlan.textContent = planLabel;
        if (settingsInfoAccountType) settingsInfoAccountType.textContent = accountTypeLabel;
        if (settingsInfoCreatedAt) settingsInfoCreatedAt.textContent = formatInfoDate(currentProfile.createdAt);
        if (settingsSecurityEmail) settingsSecurityEmail.textContent = currentProfile.email;
        if (settingsSecurityPlan) settingsSecurityPlan.textContent = planLabel;
        if (settingsSecurityStatus) settingsSecurityStatus.textContent = typeof hasDashboardAccess === 'function' && hasDashboardAccess() ? 'Protected access' : 'Limited access';
        if (settingsSecurityTimezone) settingsSecurityTimezone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local timezone';

        syncProfileButtonVisibility(currentProfile);
    }

    function persistSettingChange(key, value, message) {
        currentSettings = shell.saveDashboardSettings({ ...currentSettings, [key]: value });
        populateSettingsControls(currentSettings);
        syncProfileButtonVisibility(currentProfile);
        updateSettingsNotice(message || 'Settings saved.');
    }

    function getAdminApiUrl(pathname) {
        const normalizedPath = String(pathname || '').startsWith('/')
            ? String(pathname || '')
            : `/${String(pathname || '')}`;

        if (window.location.protocol === 'file:') return `http://localhost:4242${normalizedPath}`;
        if (/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) && window.location.port && window.location.port !== '4242') {
            return `http://localhost:4242${normalizedPath}`;
        }
        return normalizedPath;
    }

    async function syncAdminAccessUi() {
        if (!adminNavItem) return;

        let isAdminSessionActive = false;
        try {
            const response = await fetch(getAdminApiUrl('/api/admin/session'), {
                credentials: 'include'
            });
            const session = await response.json().catch(() => ({}));
            isAdminSessionActive = Boolean(response.ok && session.authenticated && normalizeEmail(session.email) === 'mehrahinal113@gmail.com');
        } catch (error) {
            isAdminSessionActive = false;
        }

        adminNavItem.style.display = isAdminSessionActive ? '' : 'none';
    }

    function getDeletedAccountKey(email) {
        return normalizeEmail(email).replace(/[.#$/\[\]]/g, '_');
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
            if (typeof firebase !== 'undefined' && firebase.auth) await firebase.auth().signOut();
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

            if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && typeof db !== 'undefined' && db) {
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

    settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            showSettingsPanel(tab.getAttribute('data-settings-target') || 'profile');
        });
    });

    if (openSettingsProfileBtn) {
        openSettingsProfileBtn.addEventListener('click', () => {
            if (currentSettings.quickOpen === false) {
                updateSettingsNotice('Quick-open is off. Re-enable it in Preferences to keep opening Settings from the profile button.');
                if (topbarSearchInput) topbarSearchInput.focus();
                return;
            }
            showSettingsPanel('profile');
        });
    }

    if (settingsSearchInput) {
        settingsSearchInput.addEventListener('input', event => {
            const query = String(event.target.value || '').trim().toLowerCase();
            if (!query) {
                updateSettingsNotice('Use the left sections to navigate your account settings.');
                return;
            }

            if (currentSettings.privacySearchIndexing === false) {
                updateSettingsNotice('Local settings search is currently disabled in Privacy.');
                return;
            }

            const matchingPanel = settingsPanels.find(panel => {
                const keywords = `${panel.getAttribute('data-settings-panel') || ''} ${panel.getAttribute('data-settings-keywords') || ''}`.toLowerCase();
                return keywords.includes(query);
            });

            if (matchingPanel) {
                const panelName = matchingPanel.getAttribute('data-settings-panel') || 'profile';
                showSettingsPanel(panelName);
                updateSettingsNotice(`Showing "${panelName}" settings for "${query}".`);
                return;
            }

            updateSettingsNotice(`No settings section matched "${query}".`);
        });
    }

    themeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const theme = button.getAttribute('data-theme-option') || 'light';
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
            syncProfileButtonVisibility(currentProfile);
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

    if (openLogoutFromSettingsBtn) openLogoutFromSettingsBtn.addEventListener('click', openLogoutModal);
    if (openDeleteFromSettingsBtn) openDeleteFromSettingsBtn.addEventListener('click', openDeleteAccountModal);
    if (closeDeleteAccountModal) closeDeleteAccountModal.addEventListener('click', closeDeleteModal);
    if (cancelDeleteAccountBtn) cancelDeleteAccountBtn.addEventListener('click', closeDeleteModal);
    if (confirmDeleteAccountBtn) confirmDeleteAccountBtn.addEventListener('click', deleteCurrentAccount);
    if (closeLogoutModal) closeLogoutModal.addEventListener('click', closeLogoutModalDialog);
    if (cancelLogoutBtn) cancelLogoutBtn.addEventListener('click', closeLogoutModalDialog);
    if (confirmLogoutBtn) confirmLogoutBtn.addEventListener('click', logoutCurrentUser);

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
        if (event.key === 'Escape' && deleteAccountModal && deleteAccountModal.classList.contains('open')) closeDeleteModal();
        if (event.key === 'Escape' && logoutModal && logoutModal.classList.contains('open')) closeLogoutModalDialog();
    });

    function syncFromStoredSettings() {
        currentSettings = shell.getStoredDashboardSettings();
        populateSettingsControls(currentSettings);
        syncProfileButtonVisibility(currentProfile);
    }

    populateSettingsControls(currentSettings);
    resolveHashRoute();
    hydrateProfileUi().catch(error => {
        console.error('Could not load settings profile:', error);
    });
    syncAdminAccessUi().catch(() => {});

    window.addEventListener('hashchange', resolveHashRoute);
    window.addEventListener('storage', syncFromStoredSettings);
    window.addEventListener('nexlance-dashboard-settings-changed', syncFromStoredSettings);
});
