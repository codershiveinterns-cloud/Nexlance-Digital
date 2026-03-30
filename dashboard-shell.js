(function () {
    const THEME_STORAGE_KEY = 'nexlance_dashboard_theme';
    const SETTINGS_STORAGE_KEY = 'nexlance_dashboard_settings';
    const MOBILE_SIDEBAR_BREAKPOINT = '(max-width: 768px)';

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

    function saveDashboardSettings(nextSettings) {
        const mergedSettings = { ...getDefaultDashboardSettings(), ...nextSettings };
        const scopedSettingsKey = getScopedStorageKey(SETTINGS_STORAGE_KEY);
        const scopedThemeKey = getScopedStorageKey(THEME_STORAGE_KEY);

        localStorage.setItem(scopedSettingsKey, JSON.stringify(mergedSettings));
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(mergedSettings));
        localStorage.setItem(scopedThemeKey, mergedSettings.theme);
        localStorage.setItem(THEME_STORAGE_KEY, mergedSettings.theme);

        window.dispatchEvent(new CustomEvent('nexlance-dashboard-settings-changed', {
            detail: { settings: mergedSettings }
        }));

        return mergedSettings;
    }

    function applyProfileVisibility(settings) {
        const visible = !(settings && settings.privacyProfileVisibility === false);
        const topbarAvatar = document.getElementById('topbarAvatar');
        const topbarProfileLabel = document.getElementById('topbarProfileLabel');

        if (topbarAvatar && topbarProfileLabel && !visible) {
            topbarProfileLabel.textContent = 'Account';
            topbarAvatar.textContent = 'AC';
            topbarAvatar.style.backgroundImage = '';
            topbarAvatar.style.color = '';
        }

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
        logoutCurrentUser,
        ensureSidebarSignOutButton,
        ensureMobileSidebarToggle,
        removeDashboardSearchBars,
        openMobileSidebar,
        closeMobileSidebar
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applySettingsToPage();
            removeDashboardSearchBars();
            ensureSidebarSignOutButton();
            ensureMobileSidebarToggle();
        });
    } else {
        applySettingsToPage();
        removeDashboardSearchBars();
        ensureSidebarSignOutButton();
        ensureMobileSidebarToggle();
    }

    window.addEventListener('storage', handleStorageSync);
    window.addEventListener('nexlance-dashboard-settings-changed', applySettingsToPage);
}());
