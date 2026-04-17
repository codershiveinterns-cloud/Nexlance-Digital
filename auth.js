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

async function fetchUserMemberships(user) {
  const idToken = await user.getIdToken();
  const response = await fetch("/api/me/workspaces", {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { memberships: [], activeWorkspaceId: "" };
  return {
    memberships: Array.isArray(payload.memberships) ? payload.memberships : [],
    activeWorkspaceId: String(payload.activeWorkspaceId || "").trim(),
  };
}

async function switchActiveWorkspace(user, workspaceId) {
  const idToken = await user.getIdToken();
  const response = await fetch("/api/me/workspaces", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ workspaceId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not switch workspace.");
  return payload;
}

function roleDisplayLabel(role) {
  if (window.NexlanceAccessControl && typeof window.NexlanceAccessControl.getRoleDisplayLabel === "function") {
    return window.NexlanceAccessControl.getRoleDisplayLabel(role);
  }
  return String(role || "member").replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstInitial(value) {
  const source = String(value || "").trim();
  if (!source) return "W";
  return source[0].toUpperCase();
}

async function maybeShowWorkspacePicker(user) {
  const { memberships } = await fetchUserMemberships(user);
  const container = document.getElementById("workspacePicker");
  const list = document.getElementById("workspacePickerList");
  if (!container || !list) return false;

  // Show the picker if the user has 2+ memberships.
  // Single-membership users proceed normally (preserves existing UX).
  if (memberships.length < 2) return false;

  // Build tiles
  list.innerHTML = "";
  memberships.forEach((m) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "ws-picker-item";
    const name = m.workspaceName || m.workspaceOwnerEmail || m.workspaceId;
    const roleLabel = m.isWorkspaceOwner ? "Admin · Owner" : roleDisplayLabel(m.role);
    tile.innerHTML = `
      <div class="ws-picker-item-avatar">${firstInitial(name)}</div>
      <div class="ws-picker-item-body">
        <div class="ws-picker-item-name">${name}</div>
        <div class="ws-picker-item-role">${roleLabel}</div>
      </div>
      <div class="ws-picker-item-badge">${m.isWorkspaceOwner ? "Owner" : "Member"}</div>
    `;
    tile.addEventListener("click", async () => {
      const messageEl = document.getElementById("workspacePickerMessage");
      if (messageEl) { messageEl.textContent = "Preparing your workspace…"; messageEl.className = "ws-picker-message success"; }
      try {
        await switchActiveWorkspace(user, m.workspaceId);
        // Refresh persisted session
        const idToken = await user.getIdToken(true);
        const me = await fetch("/api/me", { headers: { Authorization: `Bearer ${idToken}` }, credentials: "same-origin" });
        const payload = await me.json().catch(() => ({}));
        if (me.ok && payload.user) {
          persistSession({ ...payload.user, emailVerified: user.emailVerified });
        }
        window.location.href = getPostLoginRedirect();
      } catch (err) {
        if (messageEl) { messageEl.textContent = err.message || "Could not open workspace."; messageEl.className = "ws-picker-message error"; }
      }
    });
    list.appendChild(tile);
  });

  const createBtn = document.getElementById("workspacePickerCreate");
  if (createBtn) {
    createBtn.onclick = async () => {
      const messageEl = document.getElementById("workspacePickerMessage");
      if (messageEl) { messageEl.textContent = "Opening admin workspace…"; messageEl.className = "ws-picker-message success"; }
      try {
        // If an admin (owner) membership already exists, switch to it; otherwise
        // fall through to the current auto-bootstrap path on /api/me which
        // creates a workspace for the user when they have none.
        const adminMembership = memberships.find((m) => m.isWorkspaceOwner === true);
        if (adminMembership) {
          await switchActiveWorkspace(user, adminMembership.workspaceId);
        }
        const idToken = await user.getIdToken(true);
        const me = await fetch("/api/me", { headers: { Authorization: `Bearer ${idToken}` }, credentials: "same-origin" });
        const payload = await me.json().catch(() => ({}));
        if (me.ok && payload.user) {
          persistSession({ ...payload.user, emailVerified: user.emailVerified });
        }
        window.location.href = "dashboard.html";
      } catch (err) {
        if (messageEl) { messageEl.textContent = err.message || "Could not open admin workspace."; messageEl.className = "ws-picker-message error"; }
      }
    };
  }

  container.style.display = "grid";
  return true;
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

  // ALWAYS use the modular SDK user object directly to get the token.
  // Do NOT rely on supabase-config.js / compat SDK — they may not share auth state.
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 400;
  let response;
  let payload;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const token = await user.getIdToken(attempt > 0);
    response = await fetch("/api/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: "same-origin",
    });
    payload = await response.json().catch(() => ({}));

    if (response.ok && payload && payload.user) break;

    if (response.status === 401 && attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }

    const errorMessage = response.status === 500
      ? "Server error during workspace setup. Please try again in a moment."
      : "Could not refresh workspace session from server.";
    throw new Error(errorMessage);
  }

  // Validate that backend returned a workspaceId
  if (!String(payload.user.workspaceId || "").trim()) {
    throw new Error("Workspace could not be created. Please contact support.");
  }

  // Also update NexlanceSessionState if available so supabase-config.js is in sync
  const sessionApi =
    typeof window !== "undefined" && window.NexlanceSessionState
      ? window.NexlanceSessionState
      : null;
  if (sessionApi && typeof sessionApi.writeSessionFromAuthFlow === "function") {
    sessionApi.writeSessionFromAuthFlow(payload.user, { persist: true });
  }

  // Clear stale entity caches from previous session to prevent ghost project IDs
  ["nexlance_projects", "nexlance_tasks", "nexlance_clients", "nexlance_invoices", "nexlance_services", "nexlance_team_members"].forEach((key) => {
    localStorage.removeItem(key);
  });

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

  // Email verification is no longer required to access the dashboard.  As long
  // as a persisted session exists, forward the user to their post-login page;
  // do NOT clear the session just because emailVerified is false.  Verification
  // emails are sent only at account-creation time and are informational, not a
  // gate to access.
  const storedUser = getStoredSessionUser();
  if (localStorage.getItem("nexlance_auth") === "1" && storedUser) {
    window.location.href = getPostLoginRedirect();
    return;
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
        error.message || "Login succeeded but workspace session sync failed. Please try signing in again.",
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

    // Multi-workspace membership check before redirect
    try {
      const shouldShowPicker = await maybeShowWorkspacePicker(user);
      if (shouldShowPicker) {
        // Picker handles its own redirect.
        return;
      }
    } catch (pickerError) {
      console.warn("[Login] workspace picker check failed", pickerError);
    }

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
