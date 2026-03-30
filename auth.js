document.addEventListener('DOMContentLoaded', async () => {
  const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
  const DEFAULT_PLAN_CURRENCY = (() => {
    const sharedCurrency = window.NEXLANCE_BILLING_CATALOG
      && typeof window.NEXLANCE_BILLING_CATALOG.DEFAULT_CURRENCY === 'string'
      ? window.NEXLANCE_BILLING_CATALOG.DEFAULT_CURRENCY
      : 'gbp';
    const normalized = String(sharedCurrency || '').trim().toUpperCase();
    return normalized || 'GBP';
  })();
  const VIP_EMAILS = [
    'vijaypratap@nexlancedigital.com',
    'mehrahinal113@gmail.com'
  ];
  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get('mode');

  // Post-login redirect: go to template if user was redirected from templates page
  function getPostLoginRedirect() {
    const urlRedirect = params.get('redirect');
    const storedRedirect = localStorage.getItem('nexlance_template_redirect');
    // Clear stored redirect after reading
    if (storedRedirect) localStorage.removeItem('nexlance_template_redirect');
    // Only allow local relative URLs (no http/https) for security
    const target = urlRedirect || storedRedirect || null;
    if (target && !target.startsWith('http') && !target.startsWith('//')) {
      return target;
    }
    return 'dashboard.html';
  }

  if (isFirebaseConfigured) {
    await new Promise(resolve => {
      const unsub = auth.onAuthStateChanged(user => {
        unsub();
        if (user) {
          window.location.href = getPostLoginRedirect();
          return;
        }
        resolve();
      });
    });
  } else if (localStorage.getItem('nexlance_auth') === '1') {
    window.location.href = getPostLoginRedirect();
    return;
  }

  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const authTabs = document.getElementById('authTabs');
  const forgotSection = document.getElementById('forgotSection');
  const authSubText = document.getElementById('authSubText');
  const forgotOtpFields = document.getElementById('forgotOtpFields');
  const sendResetBtn = document.getElementById('sendResetBtn');
  const verifyOtpBtn = document.getElementById('verifyOtpBtn');
  let forgotEmailRecord = null;

  function switchTab(tab) {
    clearAllErrors();
    hideForgot();
    if (tab === 'login') {
      loginTab.classList.add('active');
      registerTab.classList.remove('active');
      loginForm.style.display = 'flex';
      registerForm.style.display = 'none';
    } else {
      loginTab.classList.remove('active');
      registerTab.classList.add('active');
      loginForm.style.display = 'none';
      registerForm.style.display = 'flex';
    }
  }

  function resetForgotState() {
    forgotEmailRecord = null;
    document.getElementById('forgotEmail').disabled = false;
    document.getElementById('forgotEmail').value = '';
    document.getElementById('forgotOtp').value = '';
    document.getElementById('forgotNewPassword').value = '';
    document.getElementById('forgotConfirmPassword').value = '';
    if (forgotOtpFields) forgotOtpFields.style.display = 'none';
    if (sendResetBtn) {
      sendResetBtn.disabled = false;
      sendResetBtn.textContent = isFirebaseConfigured ? 'Send Reset Link' : 'Send OTP';
    }
    if (verifyOtpBtn) {
      verifyOtpBtn.disabled = false;
      verifyOtpBtn.textContent = 'Verify OTP & Save Password';
    }
  }

  function showForgot() {
    authTabs.style.display = 'none';
    loginForm.style.display = 'none';
    registerForm.style.display = 'none';
    forgotSection.style.display = 'block';
    authSubText.textContent = 'Reset your password';
    resetForgotState();
    [
      'forgotEmail',
      'forgotOtp',
      'forgotNewPassword',
      'forgotConfirmPassword'
    ].forEach(clearFieldError);
    setMessage('forgotMessage', '', '');
  }

  function hideForgot() {
    authTabs.style.display = 'flex';
    forgotSection.style.display = 'none';
    authSubText.textContent = 'Build beautiful websites & dashboards - sign in to continue.';
    resetForgotState();
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

  function normalizeEmail(email) {
    // Preserve internal whitespace so validation can reject malformed emails.
    return (email || '').trim().toLowerCase();
  }

  function isVipEmail(email) {
    return VIP_EMAILS.includes(normalizeEmail(email));
  }

  function getDeletedAccountKey(email) {
    return normalizeEmail(email).replace(/[.#$/\[\]]/g, '_');
  }

  function buildTrialRecord() {
    const startedAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + TRIAL_DURATION_MS).toISOString();
    return {
      status: 'trial',
      label: '3-day dashboard trial',
      startedAt,
      endsAt
    };
  }

  function buildExpiredRecord() {
    return {
      status: 'expired',
      label: '3-day dashboard trial expired',
      startedAt: new Date().toISOString(),
      endsAt: new Date().toISOString()
    };
  }

  function buildActiveRecord() {
    return {
      status: 'active',
      label: 'Paid plan access',
      startedAt: new Date().toISOString(),
      permanent: true
    };
  }

  function persistTrialRecord(trialRecord) {
    const currentUser = getCurrentSessionUser();
    const ownerKey = normalizeEmail(currentUser && currentUser.email);
    const scopedKey = ownerKey ? `nexlance_trial_${ownerKey}` : 'nexlance_trial';
    localStorage.setItem(scopedKey, JSON.stringify(trialRecord));
    localStorage.setItem('nexlance_trial', JSON.stringify(trialRecord));
  }

  async function ensureTrialRecordForFirstLogin(record, persistRecord) {
    if (!record || record.planPaid === true || record.fullAccess === true) return record;
    if (record.planStatus === 'expired' || record.trialEndsAt) return record;

    const trialRecord = buildTrialRecord();
    const nextRecord = {
      ...record,
      trialStartedAt: trialRecord.startedAt,
      trialEndsAt: trialRecord.endsAt,
      planStatus: 'trial'
    };

    if (typeof persistRecord === 'function') {
      await persistRecord(nextRecord);
    }

    return nextRecord;
  }

  function syncTrialFromRecord(record) {
    if (!record) return;
    if (record.planStatus === 'active' || record.fullAccess === true) {
      persistTrialRecord(buildActiveRecord());
      return;
    }
    if (record.planStatus === 'expired' && !record.trialEndsAt) {
      persistTrialRecord(buildExpiredRecord());
      return;
    }
    if (!record.trialEndsAt) return;
    const trialEndsAtMs = new Date(record.trialEndsAt).getTime();
    const inferredTrialStatus = !record.planPaid && Number.isFinite(trialEndsAtMs)
      ? (trialEndsAtMs > Date.now() ? 'trial' : 'expired')
      : (record.planStatus || 'free');
    persistTrialRecord({
      status: inferredTrialStatus,
      label: inferredTrialStatus === 'trial' ? '3-day dashboard trial' : '3-day dashboard trial expired',
      startedAt: record.trialStartedAt || new Date().toISOString(),
      endsAt: record.trialEndsAt
    });
  }

  function syncPlanFromRecord(record) {
    if (!record) {
      const storedTrial = typeof getStoredTrialRecord === 'function' ? getStoredTrialRecord() : null;
      const trialEndsAtMs = storedTrial && storedTrial.endsAt ? new Date(storedTrial.endsAt).getTime() : NaN;
      if (typeof activateIndividualPlanAccess === 'function') {
        activateIndividualPlanAccess(
          Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now()
            ? { trialRecord: storedTrial }
            : undefined
        );
      }
      return;
    }

    const planCode = String(record.planCode || '').toLowerCase();
    const planName = String(record.currentPlan || '').toLowerCase();
    const hasPlanEnd = Boolean(record.planEndsAt);
    const isExpired = hasPlanEnd && new Date(record.planEndsAt).getTime() <= Date.now();
    const trialEndsAtMs = record.trialEndsAt ? new Date(record.trialEndsAt).getTime() : NaN;
    const hasActiveTrial = !record.planPaid
      && Number.isFinite(trialEndsAtMs)
      && trialEndsAtMs > Date.now();
    const hasExpiredTrial = !record.planPaid
      && (
        record.planStatus === 'expired'
        || (Number.isFinite(trialEndsAtMs) && trialEndsAtMs <= Date.now())
      );
    const activePaidPlanCode = !isExpired
      ? (['plus', 'pro', 'business'].includes(planCode)
          ? planCode
          : (['plus', 'pro', 'business'].includes(planName)
              ? planName
              : (record.planPaid === true ? 'business' : '')))
      : '';

    if (typeof activatePaidPlanAccess === 'function' && activePaidPlanCode) {
      const defaultDashboardAccess = ['plus', 'pro', 'business'].includes(activePaidPlanCode);
      const defaultAllTemplatesAccess = activePaidPlanCode === 'business';
      const defaultTemplateLimit = activePaidPlanCode === 'pro' ? 4 : (activePaidPlanCode === 'business' ? 8 : 0);
      activatePaidPlanAccess(activePaidPlanCode, {
        price: record.paymentAmount || 0,
        currency: DEFAULT_PLAN_CURRENCY,
        startedAt: record.planStartedAt || record.upgradedAt || new Date().toISOString(),
        endsAt: record.planEndsAt || null,
        billingCycle: record.planBillingCycle || (record.planEndsAt ? 'annual' : 'monthly'),
        dashboardAccess: activePaidPlanCode === 'pro'
          ? true
          : (record.dashboardAccess !== undefined ? Boolean(record.dashboardAccess) : defaultDashboardAccess),
        allTemplatesAccess: activePaidPlanCode === 'business'
          ? Boolean(record.allTemplatesAccess !== false)
          : defaultAllTemplatesAccess,
        templateLimit: record.templateLimit !== undefined
          ? Number(record.templateLimit || defaultTemplateLimit)
          : defaultTemplateLimit
      });
      return;
    }

    if (typeof activateIndividualPlanAccess === 'function') {
      activateIndividualPlanAccess(
        isExpired || hasExpiredTrial
          ? {
              reason: 'expired',
              trialRecord: record.trialEndsAt ? {
                status: 'expired',
                label: '3-day dashboard trial expired',
                startedAt: record.trialStartedAt || new Date().toISOString(),
                endsAt: record.trialEndsAt
              } : null
            }
          : (hasActiveTrial
              ? {
                  trialRecord: {
                    status: 'trial',
                    label: '3-day dashboard trial',
                    startedAt: record.trialStartedAt || new Date().toISOString(),
                    endsAt: record.trialEndsAt
                  }
                }
              : undefined)
      );
    }
  }

  function persistSession(sessionUser) {
    localStorage.setItem('nexlance_auth', '1');
    localStorage.setItem('nexlance_user', JSON.stringify(sessionUser));
  }

  async function getDeletedMarker(email) {
    if (!isFirebaseConfigured) return null;
    const snapshot = await db.collection('deleted_accounts').doc(getDeletedAccountKey(email)).get();
    return snapshot.exists ? snapshot.data() : null;
  }

  function validateName(name) {
    if (!name.trim()) return 'Full name is required.';
    if (name.trim().length < 2) return 'Name must be at least 2 characters.';
    if (!/^[a-zA-Z ]+$/.test(name.trim())) return 'Name can only contain letters and spaces.';
    return null;
  }

  function validateEmail(email) {
    if (!email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
    return null;
  }

  function validateMobile(mobile) {
    if (!mobile.trim()) return 'Mobile number is required.';
    if (!/^[6-9][0-9]{9}$/.test(mobile.trim())) return 'Enter a valid 10-digit mobile number.';
    return null;
  }

  function validatePassword(password) {
    if (!password) return 'Password is required.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
    if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
    if (!/[!@#$%^&*()\-_=+\[\]{}|;:'",.<>?/`~\\]/.test(password)) {
      return 'Password must contain at least one special character.';
    }
    return null;
  }

  function validateRequired(value, label) {
    if (!String(value || '').trim()) return `${label} is required.`;
    return null;
  }

  function validateOtp(otp) {
    if (!otp) return 'OTP is required.';
    if (!/^\d{6}$/.test(otp)) return 'Enter the 6-digit OTP.';
    return null;
  }

  function showFieldError(fieldId, message) {
    const errEl = document.getElementById(fieldId + 'Error');
    const input = document.getElementById(fieldId);
    if (errEl) {
      errEl.textContent = message;
      errEl.style.display = 'block';
    }
    if (input) {
      input.classList.add('input-error');
    }
  }

  function clearFieldError(fieldId) {
    const errEl = document.getElementById(fieldId + 'Error');
    const input = document.getElementById(fieldId);
    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }
    if (input) {
      input.classList.remove('input-error');
    }
  }

  function setMessage(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'form-message' + (type ? ' ' + type : '');
  }

  function clearAllErrors() {
    [
      'loginEmail',
      'loginPassword',
      'regName',
      'regEmail',
      'regMobile',
      'regAccountType',
      'regBusinessEmail',
      'regBusinessName',
      'regBusinessAddress',
      'regPassword',
      'regConfirm',
      'forgotEmail',
      'forgotOtp',
      'forgotNewPassword',
      'forgotConfirmPassword'
    ].forEach(clearFieldError);
    setMessage('loginMessage', '', '');
    setMessage('registerMessage', '', '');
    setMessage('forgotMessage', '', '');
  }

  function setLoading(btnId, loading, defaultText, loadingText = 'Please wait...') {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? loadingText : defaultText;
  }

  function getInputValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  function setupToggle(btnId, inputId) {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
    });
  }

  function toggleBusinessFields() {
    const accountTypeField = document.getElementById('regAccountType');
    const businessFields = document.getElementById('businessFields');
    if (!accountTypeField || !businessFields) return;

    const isBusinessAccount = accountTypeField.value === 'business';
    businessFields.style.display = isBusinessAccount ? 'grid' : 'none';

    if (!isBusinessAccount) {
      ['regBusinessEmail', 'regBusinessName', 'regBusinessAddress'].forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) field.value = '';
        clearFieldError(fieldId);
      });
    }
  }

  function friendlyFirebaseError(code) {
    switch (code) {
      case 'auth/user-not-found':
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
        return 'Incorrect email or password.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists.';
      case 'auth/weak-password':
        return 'Password must be at least 8 characters.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please try again later.';
      case 'auth/network-request-failed':
        return 'Network error. Check your internet connection.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not enabled in Firebase Console. Contact your admin.';
      case 'auth/invalid-api-key':
      case 'auth/api-key-service-disabled':
        return 'Firebase API key error. Check console and Firebase Console settings.';
      case 'permission-denied':
      case 'firestore/permission-denied':
        return 'Login succeeded, but Firestore blocked access to your account data. Check your Firestore security rules for users/{uid}.';
      default:
        return `Error (${code}). Check the browser console for details.`;
    }
  }

  function isEmailJsConfigured() {
    return typeof emailjs !== 'undefined'
      && EMAILJS_CONFIG
      && EMAILJS_CONFIG.publicKey
      && EMAILJS_CONFIG.serviceId
      && EMAILJS_CONFIG.templateId
      && !String(EMAILJS_CONFIG.publicKey).includes('YOUR_')
      && !String(EMAILJS_CONFIG.serviceId).includes('YOUR_')
      && !String(EMAILJS_CONFIG.templateId).includes('YOUR_');
  }

  function getLocalResetRequests() {
    try {
      return JSON.parse(localStorage.getItem('nexlance_password_resets') || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveLocalResetRequests(records) {
    localStorage.setItem('nexlance_password_resets', JSON.stringify(records));
  }

  function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async function findFirebaseUserRecordByEmail(email) {
    const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  async function sendOtpEmail({ email, name, otp }) {
    if (!isEmailJsConfigured()) {
      throw new Error('Add your EmailJS public key, service ID, and template ID in supabase-config.js first.');
    }

    try {
      await emailjs.send(
        EMAILJS_CONFIG.serviceId,
        EMAILJS_CONFIG.templateId,
        {
          to_email: email,
          to_name: name || 'Nexlance user',
          otp_code: otp,
          otp_expiry_minutes: String(EMAILJS_CONFIG.otpExpiryMinutes || 10),
          from_name: EMAILJS_CONFIG.fromName || 'Nexlance',
          app_name: EMAILJS_CONFIG.fromName || 'Nexlance'
        },
        EMAILJS_CONFIG.publicKey
      );
    } catch (ejsErr) {
      // EmailJS v4 rejects with {status, text} not a standard Error
      const status = ejsErr && ejsErr.status ? ejsErr.status : '';
      const text   = ejsErr && ejsErr.text   ? ejsErr.text   : (ejsErr && ejsErr.message ? ejsErr.message : JSON.stringify(ejsErr));
      console.error('[EmailJS] send failed:', ejsErr);
      throw new Error(`Email could not be sent (${status}: ${text}). Check your EmailJS service ID, template ID, and public key.`);
    }
  }

  async function storeResetRequest(email, userRecord, otp) {
    const expiresAt = new Date(Date.now() + (EMAILJS_CONFIG.otpExpiryMinutes || 10) * 60000).toISOString();
    const payload = {
      passwordResetOtp: otp,
      passwordResetExpiresAt: expiresAt,
      passwordResetRequestedAt: new Date().toISOString()
    };

    if (isFirebaseConfigured) {
      await db.collection('users').doc(userRecord.id).set(payload, { merge: true });
    } else {
      const requests = getLocalResetRequests();
      requests[email] = payload;
      saveLocalResetRequests(requests);
    }

    return payload;
  }

  async function getResetRequest(email, userRecord) {
    if (isFirebaseConfigured) {
      const fresh = await db.collection('users').doc(userRecord.id).get();
      return fresh.exists ? fresh.data() : null;
    }
    return getLocalResetRequests()[email] || null;
  }

  async function clearResetRequest(email, userRecord) {
    if (isFirebaseConfigured) {
      await db.collection('users').doc(userRecord.id).set({
        passwordResetOtp: firebase.firestore.FieldValue.delete(),
        passwordResetExpiresAt: firebase.firestore.FieldValue.delete(),
        passwordResetRequestedAt: firebase.firestore.FieldValue.delete()
      }, { merge: true });
      return;
    }
    const requests = getLocalResetRequests();
    delete requests[email];
    saveLocalResetRequests(requests);
  }

  async function updatePasswordWithOtp(email, userRecord, newPassword) {
    if (isFirebaseConfigured) {
      throw new Error('Firebase accounts should use the reset link sent to email.');
    }

    const users = getLocalUsers();
    const index = users.findIndex(user => normalizeEmail(user.email) === email);
    if (index === -1) {
      throw new Error('No account found with this email.');
    }
    users[index] = {
      ...users[index],
      password: newPassword,
      updatedAt: new Date().toISOString()
    };
    saveLocalUsers(users);
  }

  loginTab.addEventListener('click', () => switchTab('login'));
  registerTab.addEventListener('click', () => switchTab('register'));

  if (requestedMode === 'register' || requestedMode === 'signup' || requestedMode === 'trial') {
    switchTab('register');
  }

  document.getElementById('forgotLink').addEventListener('click', event => {
    event.preventDefault();
    const existingEmail = document.getElementById('loginEmail').value.trim();
    showForgot();
    if (existingEmail) {
      document.getElementById('forgotEmail').value = existingEmail;
    }
  });

  document.getElementById('backToLoginLink').addEventListener('click', event => {
    event.preventDefault();
    switchTab('login');
  });

  setupToggle('toggleLoginPassword', 'loginPassword');
  setupToggle('toggleRegPassword', 'regPassword');
  setupToggle('toggleRegConfirm', 'regConfirm');
  setupToggle('toggleForgotNewPassword', 'forgotNewPassword');
  setupToggle('toggleForgotConfirmPassword', 'forgotConfirmPassword');
  toggleBusinessFields();

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    clearAllErrors();

    const email = normalizeEmail(document.getElementById('loginEmail').value);
    const password = document.getElementById('loginPassword').value;
    let valid = true;

    const emailErr = validateEmail(email);
    if (emailErr) {
      showFieldError('loginEmail', emailErr);
      valid = false;
    }
    if (!password) {
      showFieldError('loginPassword', 'Password is required.');
      valid = false;
    }
    if (!valid) return;

    setLoading('loginBtn', true, 'Sign In');

    if (isFirebaseConfigured) {
      try {
        console.info('[Auth] Starting Firebase email/password sign-in', { email });
        const { user } = await auth.signInWithEmailAndPassword(email, password);
        console.info('[Auth] Firebase Auth sign-in succeeded', {
          uid: user && user.uid,
          email: user && user.email
        });
        const userRef = db.collection('users').doc(user.uid);
        let userDoc = null;
        try {
          userDoc = await userRef.get();
          console.info('[Auth] Firestore profile lookup completed', {
            path: `users/${user.uid}`,
            exists: userDoc.exists
          });
        } catch (profileError) {
          console.error('[Auth] Firestore profile lookup failed after successful sign-in', {
            code: profileError && profileError.code,
            message: profileError && profileError.message,
            path: `users/${user.uid}`
          });
          throw profileError;
        }

        persistSession({
          name: user.displayName || user.email,
          email: user.email
        });

        if (isVipEmail(user.email)) {
          persistTrialRecord(buildActiveRecord());
        } else if (userDoc.exists) {
          const hydratedRecord = await ensureTrialRecordForFirstLogin(userDoc.data(), async nextRecord => {
            await userRef.set({
              trialStartedAt: nextRecord.trialStartedAt || null,
              trialEndsAt: nextRecord.trialEndsAt || null,
              planStatus: nextRecord.planStatus || 'trial'
            }, { merge: true });
          });
          syncTrialFromRecord({ ...hydratedRecord, password });
          syncPlanFromRecord(hydratedRecord);
        } else {
          syncPlanFromRecord(null);
        }

        if (typeof trackPlatformActivity === 'function') {
          await trackPlatformActivity('login', {
            actorEmail: user.email,
            actorName: user.displayName || user.email,
            message: 'User logged in successfully.',
            metadata: {
              auth_provider: 'password',
              source: 'login_form'
            }
          });
        }

        setMessage('loginMessage', 'Login successful! Redirecting...', 'success');
        setTimeout(() => {
          window.location.href = getPostLoginRedirect();
        }, 700);
      } catch (error) {
        setLoading('loginBtn', false, 'Sign In');
        console.error('Firebase Login Error:', {
          code: error && error.code,
          message: error && error.message,
          name: error && error.name
        }, error);
        const msg = friendlyFirebaseError(error.code);
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
          showFieldError('loginEmail', msg);
        } else if (error.code === 'auth/wrong-password') {
          showFieldError('loginPassword', msg);
        } else {
          setMessage('loginMessage', msg, 'error');
        }
      }
      return;
    }

    const users = getLocalUsers();
    const user = users.find(item => normalizeEmail(item.email) === email);
    setLoading('loginBtn', false, 'Sign In');

    if (!user) {
      showFieldError('loginEmail', 'No account found with this email.');
      return;
    }
    if (user.password !== password) {
      showFieldError('loginPassword', 'Incorrect password.');
      return;
    }

    persistSession({ name: user.name, email: user.email });
    if (isVipEmail(user.email)) {
      persistTrialRecord(buildActiveRecord());
    } else {
      const hydratedUser = await ensureTrialRecordForFirstLogin(user, async nextRecord => {
        const nextUsers = users.map(item =>
          normalizeEmail(item.email) === email
            ? { ...item, ...nextRecord }
            : item
        );
        saveLocalUsers(nextUsers);
      });
      syncTrialFromRecord(hydratedUser);
      syncPlanFromRecord(hydratedUser);
    }
    if (typeof trackPlatformActivity === 'function') {
      await trackPlatformActivity('login', {
        actorEmail: user.email,
        actorName: user.name,
        message: 'User logged in successfully.',
        metadata: {
          auth_provider: 'local',
          source: 'login_form'
        }
      });
    }
    setMessage('loginMessage', 'Login successful! Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = getPostLoginRedirect();
    }, 700);
  });

  registerForm.addEventListener('submit', async event => {
    event.preventDefault();
    clearAllErrors();

    const name = getInputValue('regName').trim();
    const email = normalizeEmail(getInputValue('regEmail'));
    const mobile = getInputValue('regMobile').trim();
    const accountType = getInputValue('regAccountType');
    const businessEmail = normalizeEmail(getInputValue('regBusinessEmail'));
    const businessName = getInputValue('regBusinessName').trim();
    const businessAddress = getInputValue('regBusinessAddress').trim();
    const password = getInputValue('regPassword');
    const confirm = getInputValue('regConfirm');
    let valid = true;

    const nameErr = validateName(name);
    if (nameErr) { showFieldError('regName', nameErr); valid = false; }

    const emailErr = validateEmail(email);
    if (emailErr) { showFieldError('regEmail', emailErr); valid = false; }

    const mobileErr = validateMobile(mobile);
    if (mobileErr) { showFieldError('regMobile', mobileErr); valid = false; }

    const accountTypeErr = validateRequired(accountType, 'Account type');
    if (accountTypeErr) { showFieldError('regAccountType', accountTypeErr); valid = false; }

    if (accountType === 'business') {
      const businessEmailErr = validateEmail(businessEmail);
      if (businessEmailErr) { showFieldError('regBusinessEmail', businessEmailErr); valid = false; }

      const businessNameErr = validateRequired(businessName, 'Business/Company Name');
      if (businessNameErr) { showFieldError('regBusinessName', businessNameErr); valid = false; }

      const businessAddressErr = validateRequired(businessAddress, 'Business/Company Address');
      if (businessAddressErr) { showFieldError('regBusinessAddress', businessAddressErr); valid = false; }
    }

    const passwordErr = validatePassword(password);
    if (passwordErr) { showFieldError('regPassword', passwordErr); valid = false; }

    if (!confirm) {
      showFieldError('regConfirm', 'Please confirm your password.');
      valid = false;
    } else if (!passwordErr && password !== confirm) {
      showFieldError('regConfirm', 'Passwords do not match.');
      valid = false;
    }

    if (!valid) return;

    setLoading('registerBtn', true, 'Create Account');

    if (isFirebaseConfigured) {
      try {
        const deletedMarker = await getDeletedMarker(email);
        const isVip = isVipEmail(email);
        const trialRecord = isVip ? buildActiveRecord() : (deletedMarker ? buildExpiredRecord() : buildTrialRecord());
        const { user } = await auth.createUserWithEmailAndPassword(email, password);
        await user.updateProfile({ displayName: name });
        await db.collection('users').doc(user.uid).set({
          name,
          email,
          mobile,
          accountType,
          businessEmail: accountType === 'business' ? businessEmail : '',
          businessName: accountType === 'business' ? businessName : '',
          businessAddress: accountType === 'business' ? businessAddress : '',
          createdAt: new Date().toISOString(),
          trialStartedAt: trialRecord.startedAt || null,
          trialEndsAt: trialRecord.endsAt || null,
          planStatus: trialRecord.status,
          dashboardAccess: isVip,
          allTemplatesAccess: isVip,
          fullAccess: isVip,
          currentPlan: isVip ? 'Business' : 'Individual',
          planCode: isVip ? 'business' : 'individual',
          planPaid: isVip
        });

        persistSession({ name, email });
        persistTrialRecord(trialRecord);
        if (isVip) {
          if (typeof activateBusinessPlanAccess === 'function') activateBusinessPlanAccess();
        } else if (typeof activateIndividualPlanAccess === 'function') {
          activateIndividualPlanAccess(
            trialRecord.status === 'expired'
              ? { reason: 'expired', trialRecord }
              : { trialRecord }
          );
        }
        if (typeof trackPlatformActivity === 'function') {
          await trackPlatformActivity('user_registered', {
            actorEmail: email,
            actorName: name,
            message: 'User account created successfully.',
            metadata: {
              account_type: accountType,
              trial_status: trialRecord.status
            }
          });
          await trackPlatformActivity('login', {
            actorEmail: email,
            actorName: name,
            message: 'User logged in after registration.',
            metadata: {
              auth_provider: 'password',
              source: 'register_form'
            }
          });
        }
        setLoading('registerBtn', false, 'Create Account');
        setMessage('registerMessage', 'Account created successfully! Redirecting...', 'success');
        setTimeout(() => {
          window.location.href = getPostLoginRedirect();
        }, 900);
      } catch (error) {
        setLoading('registerBtn', false, 'Create Account');
        if (error.code === 'auth/email-already-in-use') {
          showFieldError('regEmail', friendlyFirebaseError(error.code));
        } else {
          setMessage('registerMessage', friendlyFirebaseError(error.code), 'error');
        }
      }
      return;
    }

    const isVip = isVipEmail(email);
    const deletedAccounts = getLocalDeletedAccounts();
    const deletedMarker = deletedAccounts[normalizeEmail(email)];
    const trialRecord = isVip ? buildActiveRecord() : (deletedMarker ? buildExpiredRecord() : buildTrialRecord());
    const users = getLocalUsers();
    if (users.find(item => normalizeEmail(item.email) === email && !item.deletedAt)) {
      setLoading('registerBtn', false, 'Create Account');
      showFieldError('regEmail', 'An account with this email already exists.');
      return;
    }

    users.push({
      name,
      email,
      mobile,
      accountType,
      businessEmail: accountType === 'business' ? businessEmail : '',
      businessName: accountType === 'business' ? businessName : '',
      businessAddress: accountType === 'business' ? businessAddress : '',
      password,
      createdAt: new Date().toISOString(),
      trialStartedAt: trialRecord.startedAt || null,
      trialEndsAt: trialRecord.endsAt || null,
      planStatus: trialRecord.status,
      dashboardAccess: isVip,
      allTemplatesAccess: isVip,
      fullAccess: isVip,
      currentPlan: isVip ? 'Business' : 'Individual',
      planCode: isVip ? 'business' : 'individual',
      planPaid: isVip
    });
    saveLocalUsers(users);
    persistSession({ name, email });
    persistTrialRecord(trialRecord);
    if (isVip) {
      if (typeof activateBusinessPlanAccess === 'function') activateBusinessPlanAccess();
    } else if (typeof activateIndividualPlanAccess === 'function') {
      activateIndividualPlanAccess(
        trialRecord.status === 'expired'
          ? { reason: 'expired', trialRecord }
          : { trialRecord }
      );
    }
    if (typeof trackPlatformActivity === 'function') {
      await trackPlatformActivity('user_registered', {
        actorEmail: email,
        actorName: name,
        message: 'User account created successfully.',
        metadata: {
          account_type: accountType,
          trial_status: trialRecord.status
        }
      });
      await trackPlatformActivity('login', {
        actorEmail: email,
        actorName: name,
        message: 'User logged in after registration.',
        metadata: {
          auth_provider: 'local',
          source: 'register_form'
        }
      });
    }
    setLoading('registerBtn', false, 'Create Account');
    setMessage('registerMessage', 'Account created successfully! Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = getPostLoginRedirect();
    }, 900);
  });

  sendResetBtn.addEventListener('click', async () => {
    clearFieldError('forgotEmail');
    clearFieldError('forgotOtp');
    clearFieldError('forgotNewPassword');
    clearFieldError('forgotConfirmPassword');
    setMessage('forgotMessage', '', '');

    const email = normalizeEmail(document.getElementById('forgotEmail').value);
    const emailErr = validateEmail(email);
    if (emailErr) {
      showFieldError('forgotEmail', emailErr);
      return;
    }

    const resetButtonLabel = isFirebaseConfigured ? 'Send Reset Link' : 'Send OTP';
    const resetLoadingLabel = isFirebaseConfigured ? 'Sending Reset Link...' : 'Sending OTP...';
    setLoading('sendResetBtn', true, resetButtonLabel, resetLoadingLabel);

    try {
      let userRecord = null;
      if (isFirebaseConfigured) {
        userRecord = await findFirebaseUserRecordByEmail(email);
      } else {
        userRecord = getLocalUsers().find(user => normalizeEmail(user.email) === email) || null;
      }

      if (!userRecord) {
        throw new Error('No account found with this email.');
      }

      if (isFirebaseConfigured) {
        await auth.sendPasswordResetEmail(email);
        forgotEmailRecord = userRecord;
        if (forgotOtpFields) forgotOtpFields.style.display = 'none';
        setMessage('forgotMessage', `Password reset link sent to ${email}. Please check your inbox and spam folder.`, 'success');
        setLoading('sendResetBtn', false, resetButtonLabel);
        return;
      }

      const otp = generateOtp();
      await storeResetRequest(email, userRecord, otp);
      await sendOtpEmail({
        email,
        name: userRecord.name,
        otp
      });

      forgotEmailRecord = userRecord;
      document.getElementById('forgotEmail').disabled = true;
      if (forgotOtpFields) forgotOtpFields.style.display = 'grid';
      setMessage('forgotMessage', `OTP sent to ${email}. It expires in ${EMAILJS_CONFIG.otpExpiryMinutes} minutes.`, 'success');
      setLoading('sendResetBtn', false, resetButtonLabel);
    } catch (error) {
      console.error('Forgot password OTP error:', error);
      setLoading('sendResetBtn', false, resetButtonLabel);
      // EmailJS rejects with {status, text}; standard errors have .message
      const msg = error.message
        || (error.text ? `Email error (${error.status || '?'}): ${error.text}` : null)
        || 'Could not send OTP. Please try again.';
      setMessage('forgotMessage', msg, 'error');
    }
  });

  verifyOtpBtn.addEventListener('click', async () => {
    clearFieldError('forgotOtp');
    clearFieldError('forgotNewPassword');
    clearFieldError('forgotConfirmPassword');
    setMessage('forgotMessage', '', '');

    const email = normalizeEmail(document.getElementById('forgotEmail').value);
    const otp = document.getElementById('forgotOtp').value.trim();
    const newPassword = document.getElementById('forgotNewPassword').value;
    const confirmPassword = document.getElementById('forgotConfirmPassword').value;

    if (isFirebaseConfigured) {
      setMessage('forgotMessage', 'Use the reset link sent to your email to choose a new password.', 'error');
      return;
    }

    const otpErr = validateOtp(otp);
    if (otpErr) {
      showFieldError('forgotOtp', otpErr);
      return;
    }

    const passwordErr = validatePassword(newPassword);
    if (passwordErr) {
      showFieldError('forgotNewPassword', passwordErr);
      return;
    }

    if (newPassword !== confirmPassword) {
      showFieldError('forgotConfirmPassword', 'Passwords do not match.');
      return;
    }

    if (!forgotEmailRecord) {
      setMessage('forgotMessage', 'Please request a fresh OTP first.', 'error');
      return;
    }

    setLoading('verifyOtpBtn', true, 'Verify OTP & Save Password', 'Verifying OTP...');

    try {
      const resetRecord = await getResetRequest(email, forgotEmailRecord);
      if (!resetRecord || !resetRecord.passwordResetOtp) {
        throw new Error('No active OTP found. Please request a new OTP.');
      }
      if (resetRecord.passwordResetOtp !== otp) {
        throw new Error('Incorrect OTP. Please try again.');
      }
      if (!resetRecord.passwordResetExpiresAt || new Date(resetRecord.passwordResetExpiresAt).getTime() < Date.now()) {
        throw new Error('OTP has expired. Please request a new one.');
      }

      await updatePasswordWithOtp(email, forgotEmailRecord, newPassword);
      await clearResetRequest(email, forgotEmailRecord);
      setLoading('verifyOtpBtn', false, 'Verify OTP & Save Password');
      setMessage('forgotMessage', 'Password updated successfully. You can sign in now.', 'success');
      setTimeout(() => switchTab('login'), 1200);
    } catch (error) {
      console.error('Verify OTP error:', error);
      setLoading('verifyOtpBtn', false, 'Verify OTP & Save Password');
      setMessage('forgotMessage', error.message || 'Could not update password. Please try again.', 'error');
    }
  });

  document.getElementById('regName').addEventListener('blur', () => {
    const err = validateName(document.getElementById('regName').value);
    err ? showFieldError('regName', err) : clearFieldError('regName');
  });

  document.getElementById('regEmail').addEventListener('blur', () => {
    const err = validateEmail(document.getElementById('regEmail').value);
    err ? showFieldError('regEmail', err) : clearFieldError('regEmail');
  });

  document.getElementById('regMobile').addEventListener('blur', () => {
    const err = validateMobile(document.getElementById('regMobile').value);
    err ? showFieldError('regMobile', err) : clearFieldError('regMobile');
  });

  document.getElementById('regMobile').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '');
  });

  document.getElementById('regAccountType').addEventListener('change', () => {
    clearFieldError('regAccountType');
    toggleBusinessFields();
  });

  const regBusinessEmailEl = document.getElementById('regBusinessEmail');
  if (regBusinessEmailEl) {
    regBusinessEmailEl.addEventListener('blur', () => {
      const accountType = document.getElementById('regAccountType').value;
      if (accountType !== 'business') {
        clearFieldError('regBusinessEmail');
        return;
      }
      const err = validateEmail(regBusinessEmailEl.value);
      err ? showFieldError('regBusinessEmail', err) : clearFieldError('regBusinessEmail');
    });
  }

  const regBusinessNameEl = document.getElementById('regBusinessName');
  if (regBusinessNameEl) {
    regBusinessNameEl.addEventListener('blur', () => {
      const accountType = getInputValue('regAccountType');
      if (accountType !== 'business') {
        clearFieldError('regBusinessName');
        return;
      }
      const err = validateRequired(regBusinessNameEl.value, 'Business/Company Name');
      err ? showFieldError('regBusinessName', err) : clearFieldError('regBusinessName');
    });
  }

  const regBusinessAddressEl = document.getElementById('regBusinessAddress');
  if (regBusinessAddressEl) {
    regBusinessAddressEl.addEventListener('blur', () => {
      const accountType = getInputValue('regAccountType');
      if (accountType !== 'business') {
        clearFieldError('regBusinessAddress');
        return;
      }
      const err = validateRequired(regBusinessAddressEl.value, 'Business/Company Address');
      err ? showFieldError('regBusinessAddress', err) : clearFieldError('regBusinessAddress');
    });
  }

  document.getElementById('regPassword').addEventListener('input', () => {
    const pw = document.getElementById('regPassword').value;
    const err = validatePassword(pw);
    err ? showFieldError('regPassword', err) : clearFieldError('regPassword');
    const confirm = document.getElementById('regConfirm').value;
    if (confirm) {
      pw !== confirm ? showFieldError('regConfirm', 'Passwords do not match.') : clearFieldError('regConfirm');
    }
  });

  document.getElementById('regConfirm').addEventListener('input', () => {
    const pw = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirm').value;
    if (!confirm) {
      clearFieldError('regConfirm');
      return;
    }
    pw !== confirm ? showFieldError('regConfirm', 'Passwords do not match.') : clearFieldError('regConfirm');
  });

  document.getElementById('loginEmail').addEventListener('blur', () => {
    const err = validateEmail(document.getElementById('loginEmail').value);
    err ? showFieldError('loginEmail', err) : clearFieldError('loginEmail');
  });

  document.getElementById('forgotEmail').addEventListener('blur', () => {
    const err = validateEmail(document.getElementById('forgotEmail').value);
    err ? showFieldError('forgotEmail', err) : clearFieldError('forgotEmail');
  });

  document.getElementById('forgotOtp').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 6);
  });
});

document.addEventListener("DOMContentLoaded", () => {
    emailjs.init(EMAILJS_CONFIG.publicKey);
});
