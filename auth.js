import {
  clearPersistedSession,
  loginWithEmail,
  persistSession,
  resendVerificationEmailForCredentials,
  sendForgotPasswordEmail,
  signUpWithEmail,
} from "./authService.js";

const AUTH_NOTICE_KEY = "nexlance_auth_notice";
const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const VIP_EMAILS = [
  "vijaypratap@nexlancedigital.com",
  "mehrahinal113@gmail.com",
];

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getStoredSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("nexlance_user") || "null");
  } catch (error) {
    return null;
  }
}

function getPostLoginRedirect() {
  const params = new URLSearchParams(window.location.search);
  const urlRedirect = params.get("redirect");
  const storedRedirect = localStorage.getItem("nexlance_template_redirect");

  if (storedRedirect) {
    localStorage.removeItem("nexlance_template_redirect");
  }

  const target = urlRedirect || storedRedirect || null;
  if (target && !target.startsWith("http") && !target.startsWith("//")) {
    return target;
  }

  const currentUser = getStoredSessionUser();
  if (window.NexlanceAccessControl && currentUser && !window.NexlanceAccessControl.canViewDashboard(currentUser)) {
    return "projects.html";
  }

  return "dashboard.html";
}

function popAuthNotice() {
  const message = sessionStorage.getItem(AUTH_NOTICE_KEY) || "";
  if (message) {
    sessionStorage.removeItem(AUTH_NOTICE_KEY);
  }
  return message;
}

function isVipEmail(email) {
  return VIP_EMAILS.includes(normalizeEmail(email));
}

function buildTrialRecord() {
  const startedAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + TRIAL_DURATION_MS).toISOString();
  return {
    status: "trial",
    label: "3-day dashboard trial",
    startedAt,
    endsAt,
  };
}

function buildActiveRecord() {
  return {
    status: "active",
    label: "Paid plan access",
    startedAt: new Date().toISOString(),
    permanent: true,
  };
}

function normalizeDashboardRole(role) {
  if (window.NexlanceAccessControl) {
    return window.NexlanceAccessControl.normalizeRole(role || "admin");
  }
  return String(role || "admin").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function getDefaultDashboardPermissions(role = "admin", isWorkspaceOwner = false) {
  if (window.NexlanceAccessControl) {
    return window.NexlanceAccessControl.getPermissionMatrix({
      role,
      isWorkspaceOwner,
    });
  }
  const normalizedRole = normalizeDashboardRole(role);
  return normalizedRole === "client"
    ? {
        clients: { create: false, update: false, delete: false, read: false },
        invoices: { create: false, update: false, delete: false, read: false },
        projects: { create: false, update: false, delete: false, read: true },
        services: { create: false, update: false, delete: false, read: false },
        tasks: { create: false, update: false, delete: false, read: false },
        team: { create: false, update: false, delete: false, read: false },
      }
    : {
        clients: { create: true, update: true, delete: true, read: true },
        invoices: { create: true, update: true, delete: true, read: true },
        projects: { create: true, update: true, delete: true, read: true },
        services: { create: true, update: true, delete: true, read: true },
        tasks: { create: true, update: true, delete: true, read: true },
        team: { create: isWorkspaceOwner, update: isWorkspaceOwner, delete: isWorkspaceOwner, read: isWorkspaceOwner },
      };
}

function buildDefaultDashboardAccessFields(role = "admin", isWorkspaceOwner = false) {
  const normalizedRole = normalizeDashboardRole(role);
  return {
    role: normalizedRole,
    workspaceRole: normalizedRole,
    isWorkspaceOwner,
    permissions: getDefaultDashboardPermissions(normalizedRole, isWorkspaceOwner),
    permissionKeys: window.NexlanceAccessControl
      ? window.NexlanceAccessControl.getAuthenticatedPermissionKeys({
          role: normalizedRole,
          isWorkspaceOwner,
        })
      : [],
  };
}

function persistTrialRecord(trialRecord) {
  const currentUser =
    (typeof window.getCurrentSessionUser === "function" && window.getCurrentSessionUser()) ||
    getStoredSessionUser();
  const ownerKey = normalizeEmail(currentUser && currentUser.email);
  const scopedKey = ownerKey ? `nexlance_trial_${ownerKey}` : "nexlance_trial";

  localStorage.setItem(scopedKey, JSON.stringify(trialRecord));
  localStorage.setItem("nexlance_trial", JSON.stringify(trialRecord));
}

function syncTrialFromRecord(record) {
  if (!record) return;

  if (record.planStatus === "active" || record.fullAccess === true) {
    persistTrialRecord(buildActiveRecord());
    return;
  }

  if (!record.trialEndsAt) return;

  const trialEndsAtMs = new Date(record.trialEndsAt).getTime();
  const status =
    !record.planPaid && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now()
      ? "trial"
      : "expired";

  persistTrialRecord({
    status,
    label:
      status === "trial"
        ? "3-day dashboard trial"
        : "3-day dashboard trial expired",
    startedAt: record.trialStartedAt || new Date().toISOString(),
    endsAt: record.trialEndsAt,
  });
}

function syncPlanFromRecord(record) {
  if (!record) {
    if (typeof window.activateIndividualPlanAccess === "function") {
      window.activateIndividualPlanAccess();
    }
    return;
  }

  const planCode = String(record.planCode || "").toLowerCase();
  const trialEndsAtMs = record.trialEndsAt ? new Date(record.trialEndsAt).getTime() : NaN;
  const hasActiveTrial =
    !record.planPaid && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now();

  if (
    typeof window.activatePaidPlanAccess === "function" &&
    ["plus", "pro", "business"].includes(planCode) &&
    record.planPaid
  ) {
    window.activatePaidPlanAccess(planCode, {
      price: record.paymentAmount || 0,
      startedAt: record.planStartedAt || record.createdAt || new Date().toISOString(),
      endsAt: record.planEndsAt || null,
      billingCycle: record.planBillingCycle || "monthly",
      dashboardAccess: record.dashboardAccess,
      allTemplatesAccess: record.allTemplatesAccess,
      templateLimit: record.templateLimit,
    });
    return;
  }

  if (typeof window.activateBusinessPlanAccess === "function" && record.fullAccess === true) {
    window.activateBusinessPlanAccess();
    return;
  }

  if (typeof window.activateIndividualPlanAccess === "function") {
    window.activateIndividualPlanAccess(
      hasActiveTrial
        ? {
            trialRecord: {
              status: "trial",
              label: "3-day dashboard trial",
              startedAt: record.trialStartedAt || new Date().toISOString(),
              endsAt: record.trialEndsAt,
            },
          }
        : undefined
    );
  }
}

async function hardRefreshServerSessionAfterLogin(user, profile = {}, accessFields = {}) {
  const provisionalSession = {
    uid: user.uid,
    name: profile?.name || user.displayName || user.email,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    role: "",
    workspaceRole: "",
    workspaceId: "",
    workspaceOwnerEmail: "",
    workspaceOwnerUserId: "",
    isWorkspaceOwner: false,
    permissionKeys: [],
    permissionMode: "default",
    assignedProjectIds: [],
    allProjectsAccess: false,
    projectAccessScope: "selected",
    membershipStatus: profile?.membershipStatus || "active",
    inviteType: profile?.inviteType || "",
    permissions: {},
    businessName: profile?.businessName || "",
    businessEmail: profile?.businessEmail || "",
    businessAddress: profile?.businessAddress || "",
  };

  persistSession(provisionalSession);

  const sessionApi =
    typeof window !== "undefined" && window.NexlanceSessionState
      ? window.NexlanceSessionState
      : null;
  if (sessionApi && typeof sessionApi.hardRefreshSessionFromServer === "function") {
    const hydrated = await sessionApi.hardRefreshSessionFromServer("login_hard_refresh");
    // Only accept if workspaceId is actually present (not empty string)
    if (hydrated && String(hydrated.workspaceId || "").trim()) {
      return hydrated;
    }
  }

  // Direct fallback: get token from the user object and call /api/me
  const token = await user.getIdToken(true);
  const response = await fetch("/api/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload || !payload.user) {
    throw new Error("Could not refresh workspace session from server.");
  }

  // Validate that backend returned a workspaceId
  if (!String(payload.user.workspaceId || "").trim()) {
    throw new Error("Workspace could not be created. Please contact support.");
  }

  const mergedSession = {
    ...provisionalSession,
    ...payload.user,
    role: payload.user.role || payload.user.workspaceRole || "",
    workspaceRole: payload.user.workspaceRole || payload.user.role || "",
    workspaceId: payload.user.workspaceId || "",
    assignedProjectIds: payload.user.assignedProjectIds || [],
    allProjectsAccess: Boolean(payload.user.allProjectsAccess),
    projectAccessScope:
      payload.user.projectAccessScope ||
      (payload.user.allProjectsAccess ? "all" : "selected"),
    permissionKeys: payload.user.permissionKeys || accessFields.permissionKeys || [],
    permissions: payload.user.permissions || {},
  };
  persistSession(mergedSession);
  return mergedSession;
}

async function trackActivity(eventName, payload) {
  if (typeof window.trackPlatformActivity !== "function") return;

  try {
    await window.trackPlatformActivity(eventName, payload);
  } catch (error) {
    console.warn(`Activity tracking failed for ${eventName}:`, error);
  }
}

function validateName(name) {
  if (!name.trim()) return "Full name is required.";
  if (name.trim().length < 2) return "Name must be at least 2 characters.";
  if (!/^[a-zA-Z ]+$/.test(name.trim())) return "Name can only contain letters and spaces.";
  return null;
}

function validateEmail(email) {
  if (!email.trim()) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return "Enter a valid email address.";
  }
  return null;
}

function validatePassword(password) {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
  if (!/[!@#$%^&*()\-_=+\[\]{}|;:'\",.<>?/`~\\]/.test(password)) {
    return "Password must contain at least one special character.";
  }
  return null;
}

function validateRequired(value, label) {
  if (!String(value || "").trim()) return `${label} is required.`;
  return null;
}

function showFieldError(fieldId, message) {
  const errorElement = document.getElementById(`${fieldId}Error`);
  const input = document.getElementById(fieldId);

  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = "block";
  }

  if (input) {
    input.classList.add("input-error");
  }
}

function clearFieldError(fieldId) {
  const errorElement = document.getElementById(`${fieldId}Error`);
  const input = document.getElementById(fieldId);

  if (errorElement) {
    errorElement.textContent = "";
    errorElement.style.display = "none";
  }

  if (input) {
    input.classList.remove("input-error");
  }
}

function setMessage(id, text, type = "") {
  const element = document.getElementById(id);
  if (!element) return;

  element.textContent = text;
  element.className = `form-message${type ? ` ${type}` : ""}`;
}

function setLoading(buttonId, loading, defaultText, loadingText = "Please wait...") {
  const button = document.getElementById(buttonId);
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading ? loadingText : defaultText;
}

function getInputValue(id) {
  return document.getElementById(id)?.value || "";
}

function setupToggle(buttonId, inputId) {
  const button = document.getElementById(buttonId);
  const input = document.getElementById(inputId);

  if (!button || !input) return;

  button.addEventListener("click", () => {
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Show" : "Hide";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const authTabs = document.getElementById("authTabs");
  const forgotSection = document.getElementById("forgotSection");
  const authSubText = document.getElementById("authSubText");
  const resendVerificationBtn = document.getElementById("resendVerificationBtn");

  let pendingVerificationCredentials = null;

  function setResendVerificationState(visible, credentials = null) {
    pendingVerificationCredentials = visible ? credentials : null;
    if (resendVerificationBtn) {
      resendVerificationBtn.style.display = visible ? "inline-flex" : "none";
      resendVerificationBtn.disabled = false;
      resendVerificationBtn.textContent = "Resend verification email";
    }
  }

  function clearAllErrors() {
    [
      "loginEmail",
      "loginPassword",
      "regName",
      "regEmail",
      "regAccountType",
      "regBusinessEmail",
      "regBusinessName",
      "regBusinessAddress",
      "regPassword",
      "regConfirm",
      "forgotEmail",
    ].forEach(clearFieldError);

    setMessage("loginMessage", "", "");
    setMessage("registerMessage", "", "");
    setMessage("forgotMessage", "", "");
  }

  function resetForgotState() {
    document.getElementById("forgotEmail").disabled = false;
    document.getElementById("forgotEmail").value = "";
    if (document.getElementById("sendResetBtn")) {
      setLoading("sendResetBtn", false, "Send reset email");
    }
  }

  function showForgot() {
    clearAllErrors();
    authTabs.style.display = "none";
    loginForm.style.display = "none";
    registerForm.style.display = "none";
    forgotSection.style.display = "block";
    authSubText.textContent = "Reset your password";
    setResendVerificationState(false);
    resetForgotState();
  }

  function hideForgot() {
    authTabs.style.display = "flex";
    forgotSection.style.display = "none";
    authSubText.textContent =
      "Build beautiful websites & dashboards - sign in to continue.";
    resetForgotState();
  }

  function switchTab(tab) {
    clearAllErrors();
    hideForgot();
    setResendVerificationState(false);

    if (tab === "login") {
      loginTab.classList.add("active");
      registerTab.classList.remove("active");
      loginForm.style.display = "flex";
      registerForm.style.display = "none";
      return;
    }

    loginTab.classList.remove("active");
    registerTab.classList.add("active");
    loginForm.style.display = "none";
    registerForm.style.display = "flex";
  }

  function toggleBusinessFields() {
    const accountTypeField = document.getElementById("regAccountType");
    const businessFields = document.getElementById("businessFields");
    if (!accountTypeField || !businessFields) return;

    const isBusinessAccount = accountTypeField.value === "business";
    businessFields.style.display = isBusinessAccount ? "grid" : "none";

    if (!isBusinessAccount) {
      ["regBusinessEmail", "regBusinessName", "regBusinessAddress"].forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (field) field.value = "";
        clearFieldError(fieldId);
      });
    }
  }

  const storedUser = getStoredSessionUser();
  if (localStorage.getItem("nexlance_auth") === "1" && storedUser?.emailVerified === true) {
    window.location.href = getPostLoginRedirect();
    return;
  }

  if (storedUser?.emailVerified === false) {
    clearPersistedSession();
  }

  const authNotice = popAuthNotice();
  if (authNotice) {
    setMessage("loginMessage", authNotice, "error");
  }

  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get("mode");

  loginTab.addEventListener("click", () => switchTab("login"));
  registerTab.addEventListener("click", () => switchTab("register"));

  if (requestedMode === "register" || requestedMode === "signup" || requestedMode === "trial") {
    switchTab("register");
  }

  document.getElementById("forgotLink").addEventListener("click", (event) => {
    event.preventDefault();
    const existingEmail = document.getElementById("loginEmail").value.trim();
    showForgot();
    if (existingEmail) {
      document.getElementById("forgotEmail").value = existingEmail;
    }
  });

  document.getElementById("backToLoginLink").addEventListener("click", (event) => {
    event.preventDefault();
    switchTab("login");
  });

  setupToggle("toggleLoginPassword", "loginPassword");
  setupToggle("toggleRegPassword", "regPassword");
  setupToggle("toggleRegConfirm", "regConfirm");
  toggleBusinessFields();

  if (resendVerificationBtn) {
    resendVerificationBtn.addEventListener("click", async () => {
      if (!pendingVerificationCredentials) {
        setMessage(
          "loginMessage",
          "Enter your email and password, then try signing in again to resend verification.",
          "error"
        );
        return;
      }

      resendVerificationBtn.disabled = true;
      resendVerificationBtn.textContent = "Sending...";

      const result = await resendVerificationEmailForCredentials(
        pendingVerificationCredentials.email,
        pendingVerificationCredentials.password
      );

      resendVerificationBtn.disabled = false;
      resendVerificationBtn.textContent = "Resend verification email";

      setMessage(
        "loginMessage",
        result.success ? result.message : result.error,
        result.success ? "success" : "error"
      );
    });
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAllErrors();
    setResendVerificationState(false);

    const email = normalizeEmail(getInputValue("loginEmail"));
    const password = getInputValue("loginPassword");
    let isValid = true;

    const emailError = validateEmail(email);
    if (emailError) {
      showFieldError("loginEmail", emailError);
      isValid = false;
    }

    if (!password) {
      showFieldError("loginPassword", "Password is required.");
      isValid = false;
    }

    if (!isValid) return;

    setLoading("loginBtn", true, "Sign In", "Signing in...");

    const accessFields = buildDefaultDashboardAccessFields("admin", false);
    const result = await loginWithEmail(email, password, {
      role: accessFields.role,
      permissions: accessFields.permissions,
    });

    setLoading("loginBtn", false, "Sign In");

    if (!result.success) {
      if (result.requiresEmailVerification) {
        setResendVerificationState(true, { email, password });
      }

      setMessage("loginMessage", result.error, "error");
      return;
    }

    const { user, profile } = result;
    try {
      await hardRefreshServerSessionAfterLogin(user, profile, accessFields);
    } catch (error) {
      clearPersistedSession();
      if (typeof window.clearSessionRuntime === "function") {
        window.clearSessionRuntime("login_session_sync_failed");
      }
      setMessage(
        "loginMessage",
        "Login succeeded but workspace session sync failed. Please try signing in again.",
        "error"
      );
      return;
    }

    if (isVipEmail(user.email)) {
      persistTrialRecord(buildActiveRecord());
      if (typeof window.activateBusinessPlanAccess === "function") {
        window.activateBusinessPlanAccess();
      }
    } else {
      syncTrialFromRecord(profile);
      syncPlanFromRecord(profile);
    }

    await trackActivity("login", {
      actorEmail: user.email,
      actorName: profile?.name || user.displayName || user.email,
      message: "User logged in successfully.",
      metadata: {
        auth_provider: "firebase",
        source: "login_form",
      },
    });

    setMessage("loginMessage", "Login successful! Redirecting...", "success");
    setTimeout(() => {
      window.location.href = getPostLoginRedirect();
    }, 700);
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAllErrors();
    setResendVerificationState(false);

    const name = getInputValue("regName").trim();
    const email = normalizeEmail(getInputValue("regEmail"));
    const accountType = getInputValue("regAccountType");
    const businessEmail = normalizeEmail(getInputValue("regBusinessEmail"));
    const businessName = getInputValue("regBusinessName").trim();
    const businessAddress = getInputValue("regBusinessAddress").trim();
    const password = getInputValue("regPassword");
    const confirm = getInputValue("regConfirm");
    let isValid = true;

    const nameError = validateName(name);
    if (nameError) {
      showFieldError("regName", nameError);
      isValid = false;
    }

    const emailError = validateEmail(email);
    if (emailError) {
      showFieldError("regEmail", emailError);
      isValid = false;
    }

    const accountTypeError = validateRequired(accountType, "Account type");
    if (accountTypeError) {
      showFieldError("regAccountType", accountTypeError);
      isValid = false;
    }

    if (accountType === "business") {
      const businessEmailError = validateEmail(businessEmail);
      if (businessEmailError) {
        showFieldError("regBusinessEmail", businessEmailError);
        isValid = false;
      }

      const businessNameError = validateRequired(
        businessName,
        "Business/Company Name"
      );
      if (businessNameError) {
        showFieldError("regBusinessName", businessNameError);
        isValid = false;
      }

      const businessAddressError = validateRequired(
        businessAddress,
        "Business/Company Address"
      );
      if (businessAddressError) {
        showFieldError("regBusinessAddress", businessAddressError);
        isValid = false;
      }
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      showFieldError("regPassword", passwordError);
      isValid = false;
    }

    if (!confirm) {
      showFieldError("regConfirm", "Please confirm your password.");
      isValid = false;
    } else if (!passwordError && password !== confirm) {
      showFieldError("regConfirm", "Passwords do not match.");
      isValid = false;
    }

    if (!isValid) return;

    setLoading("registerBtn", true, "Create Account", "Creating account...");

    const accessFields = buildDefaultDashboardAccessFields("admin", true);
    const vip = isVipEmail(email);
    const trialRecord = vip ? buildActiveRecord() : buildTrialRecord();

    const result = await signUpWithEmail({
      email,
      password,
      displayName: name,
      profileData: {
        name,
        email,
        accountType,
        businessEmail: accountType === "business" ? businessEmail : "",
        businessName: accountType === "business" ? businessName : "",
        businessAddress: accountType === "business" ? businessAddress : "",
        trialStartedAt: trialRecord.startedAt || null,
        trialEndsAt: trialRecord.endsAt || null,
        planStatus: trialRecord.status,
        dashboardAccess: vip,
        allTemplatesAccess: vip,
        fullAccess: vip,
        currentPlan: vip ? "Business" : "Individual",
        planCode: vip ? "business" : "individual",
        planPaid: vip,
        role: accessFields.role,
        workspaceRole: accessFields.workspaceRole,
        isWorkspaceOwner: true,
        workspaceOwnerEmail: email,
        workspaceOwnerUserId: "",
        permissionKeys: accessFields.permissionKeys,
        permissionMode: "default",
        permissions: accessFields.permissions,
      },
    });

    setLoading("registerBtn", false, "Create Account");

    if (!result.success) {
      if (result.code === "auth/email-already-in-use") {
        showFieldError("regEmail", result.error);
      } else {
        setMessage("registerMessage", result.error, "error");
      }
      return;
    }

    await trackActivity("user_registered", {
      actorEmail: email,
      actorName: name,
      message: "User account created successfully.",
      metadata: {
        account_type: accountType,
        auth_provider: "firebase",
      },
    });

    switchTab("login");
    document.getElementById("loginEmail").value = email;
    document.getElementById("loginPassword").value = "";
    setMessage(
      "loginMessage",
      "Account created. Please verify your email before signing in.",
      "success"
    );
    setResendVerificationState(true, { email, password });
  });

  document.getElementById("sendResetBtn").addEventListener("click", async () => {
    clearFieldError("forgotEmail");
    setMessage("forgotMessage", "", "");

    const email = normalizeEmail(getInputValue("forgotEmail"));
    const emailError = validateEmail(email);

    if (emailError) {
      showFieldError("forgotEmail", emailError);
      return;
    }

    setLoading("sendResetBtn", true, "Send reset email", "Sending...");

    const result = await sendForgotPasswordEmail(email);

    setLoading("sendResetBtn", false, "Send reset email");
    setMessage(
      "forgotMessage",
      result.success ? result.message : result.error,
      result.success ? "success" : "error"
    );
  });

  document.getElementById("regName").addEventListener("blur", () => {
    const error = validateName(getInputValue("regName"));
    error ? showFieldError("regName", error) : clearFieldError("regName");
  });

  document.getElementById("regEmail").addEventListener("blur", () => {
    const error = validateEmail(getInputValue("regEmail"));
    error ? showFieldError("regEmail", error) : clearFieldError("regEmail");
  });

  document.getElementById("regAccountType").addEventListener("change", () => {
    clearFieldError("regAccountType");
    toggleBusinessFields();
  });

  document.getElementById("regPassword").addEventListener("input", () => {
    const password = getInputValue("regPassword");
    const confirm = getInputValue("regConfirm");
    const error = validatePassword(password);

    error ? showFieldError("regPassword", error) : clearFieldError("regPassword");

    if (confirm) {
      password !== confirm
        ? showFieldError("regConfirm", "Passwords do not match.")
        : clearFieldError("regConfirm");
    }
  });

  document.getElementById("regConfirm").addEventListener("input", () => {
    const password = getInputValue("regPassword");
    const confirm = getInputValue("regConfirm");

    if (!confirm) {
      clearFieldError("regConfirm");
      return;
    }

    password !== confirm
      ? showFieldError("regConfirm", "Passwords do not match.")
      : clearFieldError("regConfirm");
  });

  document.getElementById("loginEmail").addEventListener("blur", () => {
    const error = validateEmail(getInputValue("loginEmail"));
    error ? showFieldError("loginEmail", error) : clearFieldError("loginEmail");
  });

  document.getElementById("forgotEmail").addEventListener("blur", () => {
    const error = validateEmail(getInputValue("forgotEmail"));
    error ? showFieldError("forgotEmail", error) : clearFieldError("forgotEmail");
  });

  const regBusinessEmailEl = document.getElementById("regBusinessEmail");
  if (regBusinessEmailEl) {
    regBusinessEmailEl.addEventListener("blur", () => {
      if (getInputValue("regAccountType") !== "business") {
        clearFieldError("regBusinessEmail");
        return;
      }

      const error = validateEmail(regBusinessEmailEl.value);
      error
        ? showFieldError("regBusinessEmail", error)
        : clearFieldError("regBusinessEmail");
    });
  }

  const regBusinessNameEl = document.getElementById("regBusinessName");
  if (regBusinessNameEl) {
    regBusinessNameEl.addEventListener("blur", () => {
      if (getInputValue("regAccountType") !== "business") {
        clearFieldError("regBusinessName");
        return;
      }

      const error = validateRequired(regBusinessNameEl.value, "Business/Company Name");
      error
        ? showFieldError("regBusinessName", error)
        : clearFieldError("regBusinessName");
    });
  }

  const regBusinessAddressEl = document.getElementById("regBusinessAddress");
  if (regBusinessAddressEl) {
    regBusinessAddressEl.addEventListener("blur", () => {
      if (getInputValue("regAccountType") !== "business") {
        clearFieldError("regBusinessAddress");
        return;
      }

      const error = validateRequired(
        regBusinessAddressEl.value,
        "Business/Company Address"
      );
      error
        ? showFieldError("regBusinessAddress", error)
        : clearFieldError("regBusinessAddress");
    });
  }
});
