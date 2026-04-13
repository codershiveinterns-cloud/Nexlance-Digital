(function () {
    const THEME_STORAGE_KEY = 'nexlance_dashboard_theme';
    const SETTINGS_STORAGE_KEY = 'nexlance_dashboard_settings';
    const MOBILE_SIDEBAR_BREAKPOINT = '(max-width: 768px)';
    const AUTH_NOTICE_KEY = 'nexlance_auth_notice';
    const SETTINGS_PROFILE_PATH = 'settings.html#settings';

    let topbarProfileCache = null;
    let topbarProfilePromise = null;
    let authProfileListenerBound = false;

    function normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem('nexlance_user') || 'null');
        } catch (error) {
            return null;
        }
    }

    function getLocalUsers() {
        try {
            return JSON.parse(localStorage.getItem('nexlance_users') || '[]');
        } catch (error) {
            return [];
        }
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

    function getCurrentPathName() {
        const pathname = String(window.location.pathname || '');
        const pageName = pathname.split('/').pop();
        return pageName || 'dashboard.html';
    }

    function pageHasDedicatedProfileController() {
        const pageName = getCurrentPathName().toLowerCase();
        return pageName === 'dashboard.html' || pageName === 'settings.html';
    }

    function openSettingsFromTopbar() {
        const settings = getStoredDashboardSettings();

        if (settings.quickOpen === false) {
            const message = 'Quick-open is off. Re-enable it in Settings > Preferences to open Settings from the profile button.';
            if (typeof window.showToast === 'function') {
                window.showToast(message, 'info');
            } else {
                console.info(message);
            }
            return;
        }

        if (getCurrentPathName().toLowerCase() === 'settings.html') {
            if (window.location.hash !== '#settings') {
                history.replaceState(null, '', `${window.location.pathname}${window.location.search}#settings`);
            }
            return;
        }

        window.location.href = SETTINGS_PROFILE_PATH;
    }

    function bindTopbarProfileButton(button) {
        if (!button || pageHasDedicatedProfileController() || button.dataset.topbarProfileBound === '1') {
            return;
        }

        button.dataset.topbarProfileBound = '1';
        button.addEventListener('click', openSettingsFromTopbar);
    }

    function ensureTopbarProfileButton() {
        const topbar = document.querySelector('.topbar');
        if (!topbar) return null;

        let button = document.getElementById('openSettingsProfileBtn') || topbar.querySelector('.profile-button');
        if (!button) {
            const placeholder = topbar.querySelector('.profile');
            button = document.createElement('button');
            button.type = 'button';
            button.id = 'openSettingsProfileBtn';
            button.className = 'profile profile-button';
            button.setAttribute('aria-label', 'Open settings');
            button.innerHTML = '<span class="profile-avatar-small" id="topbarAvatar">NA</span><span id="topbarProfileLabel">Account</span>';

            if (placeholder) {
                placeholder.replaceWith(button);
            } else {
                topbar.appendChild(button);
            }
        } else {
            button.classList.add('profile', 'profile-button');
            if (!button.id) button.id = 'openSettingsProfileBtn';
            if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', 'Open settings');
        }

        let avatar = button.querySelector('#topbarAvatar') || button.querySelector('.profile-avatar-small');
        if (!avatar) {
            avatar = document.createElement('span');
            avatar.id = 'topbarAvatar';
            avatar.className = 'profile-avatar-small';
            avatar.textContent = 'NA';
            button.insertBefore(avatar, button.firstChild);
        } else if (!avatar.id) {
            avatar.id = 'topbarAvatar';
        }

        let label = button.querySelector('#topbarProfileLabel');
        if (!label) {
            label = document.createElement('span');
            label.id = 'topbarProfileLabel';
            label.textContent = 'Account';
            button.appendChild(label);
        }

        bindTopbarProfileButton(button);
        return button;
    }

    function getFallbackTopbarProfile() {
        const currentUser = getCurrentUser();
        if (!currentUser) return null;

        const email = normalizeEmail(currentUser.email);
        const localRecord = getLocalUsers().find(user => normalizeEmail(user.email) === email) || {};
        const authInstance = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null;

        return {
            name: currentUser.name || localRecord.name || currentUser.email || 'Account',
            email: localRecord.email || currentUser.email || '',
            avatar: authInstance && authInstance.currentUser ? authInstance.currentUser.photoURL || '' : ''
        };
    }

    function renderTopbarProfile(profile = null, settings = getStoredDashboardSettings()) {
        const button = ensureTopbarProfileButton();
        if (!button) return;

        const avatar = document.getElementById('topbarAvatar');
        const label = document.getElementById('topbarProfileLabel');
        if (!avatar || !label) return;

        const nextProfile = profile || topbarProfileCache || getFallbackTopbarProfile();

        if (settings.privacyProfileVisibility === false || !nextProfile) {
            label.textContent = 'Account';
            setAvatarContent(avatar, 'AC', '');
            return;
        }

        label.textContent = nextProfile.name || 'Account';
        setAvatarContent(avatar, getInitials(nextProfile.name, nextProfile.email), nextProfile.avatar);
    }

    async function loadTopbarProfile(options = {}) {
        if (!options.force && topbarProfilePromise) {
            return topbarProfilePromise;
        }

        topbarProfilePromise = (async () => {
            const currentUser = getCurrentUser();
            const fallbackProfile = getFallbackTopbarProfile();
            if (!currentUser) {
                topbarProfileCache = null;
                return null;
            }

            const email = normalizeEmail(currentUser.email);
            const localRecord = getLocalUsers().find(user => normalizeEmail(user.email) === email) || {};
            let firebaseRecord = {};

            try {
                const authInstance = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null;
                if (authInstance && authInstance.currentUser && typeof db !== 'undefined' && db) {
                    const snapshot = await db.collection('users').doc(authInstance.currentUser.uid).get();
                    firebaseRecord = snapshot.exists ? snapshot.data() : {};
                }
            } catch (error) {
                firebaseRecord = {};
            }

            topbarProfileCache = {
                name: currentUser.name || firebaseRecord.name || localRecord.name || 'Account',
                email: currentUser.email || firebaseRecord.email || localRecord.email || '',
                avatar: (authInstance && authInstance.currentUser ? authInstance.currentUser.photoURL : '') || ''
            };

            return topbarProfileCache;
        })();

        try {
            return await topbarProfilePromise;
        } finally {
            topbarProfilePromise = null;
        }
    }

    async function refreshTopbarProfile(options = {}) {
        renderTopbarProfile(topbarProfileCache, getStoredDashboardSettings());
        const profile = await loadTopbarProfile(options);
        renderTopbarProfile(profile, getStoredDashboardSettings());
        return profile;
    }

    function ensureAuthProfileRefresh() {
        if (authProfileListenerBound) return;
        const authInstance = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null;
        if (!authInstance || typeof authInstance.onAuthStateChanged !== 'function') return;

        authProfileListenerBound = true;
        authInstance.onAuthStateChanged(() => {
            refreshTopbarProfile({ force: true }).catch(() => undefined);
        });
    }

    function enforceVerifiedSession() {
        const currentUser = getCurrentUser();
        if (!currentUser || currentUser.emailVerified !== false) {
            return true;
        }

        sessionStorage.setItem(AUTH_NOTICE_KEY, 'Please verify your email before accessing the dashboard.');
        localStorage.removeItem('nexlance_auth');
        localStorage.removeItem('nexlance_user');
        localStorage.removeItem('nexlance_trial');
        window.location.href = 'login.html';
        return false;
    }

    function getScopedStorageKey(baseKey) {
        const currentUser = getCurrentUser();
        const email = normalizeEmail(currentUser && currentUser.email);
        return email ? `${baseKey}_${email}` : baseKey;
    }

    function getDefaultDashboardSettings() {
        const browserLanguage = String(navigator.language || 'en-IN').toLowerCase();
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

    function applyTheme(theme) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', nextTheme);
        document.documentElement.style.colorScheme = nextTheme;
        return nextTheme;
    }

    async function getAuthBearerToken() {
        if (typeof window !== 'undefined' && window.__nexlance_modular_auth && window.__nexlance_modular_auth.currentUser) {
            return window.__nexlance_modular_auth.currentUser.getIdToken(false);
        }
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
            return firebase.auth().currentUser.getIdToken(false);
        }
        return null;
    }

    async function syncPreferencesToBackend(settings) {
        try {
            const token = await getAuthBearerToken();
            if (!token) return;
            await fetch('/api/user-preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ preferences: settings })
            });
        } catch (error) {
            console.warn('[DashboardShell] Could not sync preferences to backend:', error.message);
        }
    }

    async function loadPreferencesFromBackend() {
        try {
            const token = await getAuthBearerToken();
            if (!token) return null;
            const response = await fetch('/api/user-preferences', {
                method: 'GET',
                headers: { Authorization: 'Bearer ' + token }
            });
            if (!response.ok) return null;
            const payload = await response.json();
            return payload && payload.preferences ? payload.preferences : null;
        } catch (error) {
            return null;
        }
    }

    function saveDashboardSettings(nextSettings) {
        const mergedSettings = { ...getDefaultDashboardSettings(), ...nextSettings };
        const scopedSettingsKey = getScopedStorageKey(SETTINGS_STORAGE_KEY);
        const scopedThemeKey = getScopedStorageKey(THEME_STORAGE_KEY);

        localStorage.setItem(scopedSettingsKey, JSON.stringify(mergedSettings));
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(mergedSettings));
        localStorage.setItem(scopedThemeKey, mergedSettings.theme);
        localStorage.setItem(THEME_STORAGE_KEY, mergedSettings.theme);

        // Sync to Firebase in the background
        syncPreferencesToBackend(mergedSettings);

        window.dispatchEvent(new CustomEvent('nexlance-dashboard-settings-changed', {
            detail: { settings: mergedSettings }
        }));

        return mergedSettings;
    }

    function applyProfileVisibility(settings) {
        ensureTopbarProfileButton();
        renderTopbarProfile(topbarProfileCache, settings);

        document.querySelectorAll('.topbar .profile:not(.profile-button)').forEach(profile => {
            profile.textContent = 'Account';
        });
    }

    function applySettingsToPage() {
        const settings = getStoredDashboardSettings();
        applyTheme(settings.theme);
        applyProfileVisibility(settings);
        return settings;
    }

    let _preferencesHydrated = false;
    async function hydratePreferencesFromBackend() {
        if (_preferencesHydrated) return;
        _preferencesHydrated = true;
        const remote = await loadPreferencesFromBackend();
        if (!remote || !Object.keys(remote).length) return;
        const local = getStoredDashboardSettings();
        const remoteUpdatedAt = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
        // Only apply remote if it has newer data
        if (!remoteUpdatedAt) return;
        const merged = { ...local, ...remote };
        delete merged.updatedAt;
        const scopedSettingsKey = getScopedStorageKey(SETTINGS_STORAGE_KEY);
        const scopedThemeKey = getScopedStorageKey(THEME_STORAGE_KEY);
        localStorage.setItem(scopedSettingsKey, JSON.stringify(merged));
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
        localStorage.setItem(scopedThemeKey, merged.theme);
        localStorage.setItem(THEME_STORAGE_KEY, merged.theme);
        applySettingsToPage();
    }

    function removeDashboardSearchBars() {
        document.querySelectorAll('.topbar > input').forEach(input => {
            if (!input || input.dataset.searchRemoved === '1') return;
            input.dataset.searchRemoved = '1';
            input.hidden = true;

            const topbar = input.parentElement;
            if (topbar && !topbar.querySelector('.topbar-spacer')) {
                const spacer = document.createElement('div');
                spacer.className = 'topbar-spacer';
                spacer.setAttribute('aria-hidden', 'true');
                spacer.style.flex = '1 1 auto';
                spacer.style.minWidth = '0';
                topbar.insertBefore(spacer, input.nextSibling);
            }
        });

        document.querySelectorAll('.filter-bar .search-input').forEach(input => {
            if (!input || input.dataset.searchRemoved === '1') return;
            input.dataset.searchRemoved = '1';
            input.hidden = true;
            input.disabled = true;
        });

        document.querySelectorAll('.settings-search').forEach(container => {
            container.hidden = true;
        });
    }

    async function logoutCurrentUser() {
        const currentUser = getCurrentUser();

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

    function ensureSidebarSignOutButton() {
        const nav = document.querySelector('.sidebar .nav');
        if (!nav || document.getElementById('sidebarSignOutBtn')) return;

        const separator = document.createElement('hr');
        separator.className = 'sidebar-utility-separator';

        const signOutItem = document.createElement('li');
        signOutItem.className = 'sidebar-signout-item';
        signOutItem.innerHTML = '<button type="button" class="sidebar-signout-button" id="sidebarSignOutBtn">Sign out</button>';

        nav.appendChild(separator);
        nav.appendChild(signOutItem);

        const signOutBtn = signOutItem.querySelector('#sidebarSignOutBtn');
        if (!signOutBtn) return;

        signOutBtn.addEventListener('click', async () => {
            const shouldLogout = window.confirm('Do you want to log out?');
            if (!shouldLogout) return;

            signOutBtn.disabled = true;
            signOutBtn.textContent = 'Signing out...';
            await logoutCurrentUser();
        });
    }

    function closeMobileSidebar() {
        document.body.classList.remove('sidebar-open');
        const toggle = document.getElementById('mobileSidebarToggle');
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
        }
    }

    function openMobileSidebar() {
        document.body.classList.add('sidebar-open');
        const toggle = document.getElementById('mobileSidebarToggle');
        if (toggle) {
            toggle.setAttribute('aria-expanded', 'true');
        }
    }

    function ensureMobileSidebarToggle() {
        const sidebar = document.querySelector('.sidebar');
        const topbar = document.querySelector('.topbar');
        if (!sidebar || !topbar) return;

        let backdrop = document.getElementById('mobileSidebarBackdrop');
        if (!backdrop) {
            backdrop = document.createElement('button');
            backdrop.type = 'button';
            backdrop.id = 'mobileSidebarBackdrop';
            backdrop.className = 'mobile-sidebar-backdrop';
            backdrop.setAttribute('aria-label', 'Close sidebar');
            backdrop.addEventListener('click', closeMobileSidebar);
            document.body.appendChild(backdrop);
        }

        if (!document.getElementById('mobileSidebarToggle')) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.id = 'mobileSidebarToggle';
            toggle.className = 'mobile-sidebar-toggle';
            toggle.setAttribute('aria-label', 'Open sidebar navigation');
            toggle.setAttribute('aria-controls', 'dashboardSidebar');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML = '<span></span><span></span><span></span>';
            toggle.addEventListener('click', () => {
                if (document.body.classList.contains('sidebar-open')) {
                    closeMobileSidebar();
                    return;
                }
                openMobileSidebar();
            });
            topbar.insertBefore(toggle, topbar.firstChild);
        }

        if (!sidebar.id) {
            sidebar.id = 'dashboardSidebar';
        }

        sidebar.querySelectorAll('a[href], button').forEach(element => {
            if (element.dataset.mobileSidebarBound === '1') return;
            element.dataset.mobileSidebarBound = '1';
            element.addEventListener('click', () => {
                if (window.matchMedia(MOBILE_SIDEBAR_BREAKPOINT).matches) {
                    closeMobileSidebar();
                }
            });
        });

        const syncSidebarState = () => {
            if (!window.matchMedia(MOBILE_SIDEBAR_BREAKPOINT).matches) {
                closeMobileSidebar();
            }
        };

        window.addEventListener('resize', syncSidebarState);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                closeMobileSidebar();
            }
        });
        syncSidebarState();
    }

    function handleStorageSync(event) {
        const key = event && event.key ? String(event.key) : '';
        if (!key || key.startsWith(THEME_STORAGE_KEY) || key.startsWith(SETTINGS_STORAGE_KEY)) {
            applySettingsToPage();
        }
        if (!key || key === 'nexlance_user' || key === 'nexlance_users') {
            refreshTopbarProfile({ force: true }).catch(() => undefined);
        }
    }

    window.NexlanceDashboardShell = {
        THEME_STORAGE_KEY,
        SETTINGS_STORAGE_KEY,
        getCurrentUser,
        getScopedStorageKey,
        getDefaultDashboardSettings,
        getStoredDashboardSettings,
        saveDashboardSettings,
        applyTheme,
        applySettingsToPage,
        refreshTopbarProfile,
        renderTopbarProfile,
        ensureTopbarProfileButton,
        logoutCurrentUser,
        ensureSidebarSignOutButton,
        ensureMobileSidebarToggle,
        removeDashboardSearchBars,
        openMobileSidebar,
        closeMobileSidebar
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (!enforceVerifiedSession()) return;
            applySettingsToPage();
            removeDashboardSearchBars();
            ensureSidebarSignOutButton();
            ensureMobileSidebarToggle();
            ensureAuthProfileRefresh();
            refreshTopbarProfile({ force: true }).catch(() => undefined);
            hydratePreferencesFromBackend().catch(() => undefined);
        });
    } else {
        if (!enforceVerifiedSession()) return;
        applySettingsToPage();
        removeDashboardSearchBars();
        ensureSidebarSignOutButton();
        ensureMobileSidebarToggle();
        ensureAuthProfileRefresh();
        refreshTopbarProfile({ force: true }).catch(() => undefined);
        hydratePreferencesFromBackend().catch(() => undefined);
    }

    window.addEventListener('storage', handleStorageSync);
    window.addEventListener('nexlance-dashboard-settings-changed', applySettingsToPage);
    window.addEventListener('focus', () => {
        refreshTopbarProfile({ force: true }).catch(() => undefined);
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshTopbarProfile({ force: true }).catch(() => undefined);
        }
    });
}());
