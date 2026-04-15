import { auth, authReady } from "./firebase.js";
import {
  clearPersistedSession,
  createInvitedAccountSession,
  loginWithEmail,
  persistSession,
} from "./authService.js";

const STATES = ["loadingState", "signupState", "loginState", "successState", "errorState"];

function showState(stateId) {
  STATES.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", id === stateId);
  });
}

function setMessage(target, message = "", type = "") {
  const el = document.getElementById(target);
  if (!el) return;
  el.textContent = message;
  el.className = `invite-message${type ? ` ${type}` : ""}`;
}

function renderInvitationSummary(invitation) {
  const roleLabel = window.NexlanceAccessControl
    ? window.NexlanceAccessControl.getRoleDisplayLabel(invitation.role)
    : invitation.role;
  const selectedCount = Array.isArray(invitation.assignedProjectIds) ? invitation.assignedProjectIds.length : 0;
  const accessLabel = invitation.allProjectsAccess
    ? "All projects in the workspace"
    : selectedCount
      ? `${selectedCount} assigned project${selectedCount === 1 ? "" : "s"}`
      : "Projects assigned to you";
  const html = `
    <div class="line"><span class="label">Email</span><span class="value">${invitation.email || ""}</span></div>
    <div class="line"><span class="label">Role</span><span class="value">${roleLabel || ""}</span></div>
    <div class="line"><span class="label">Access</span><span class="value">${accessLabel}</span></div>
  `;
  ["inviteSummarySignup", "inviteSummaryLogin"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

async function resolveInvitation(token) {
  const response = await fetch(`/api/invitations/resolve?token=${encodeURIComponent(token)}`, {
    method: "GET",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.invitation) {
    throw new Error(payload.error || "Invitation could not be loaded.");
  }
  return payload.invitation;
}

async function callAcceptInvitation(token) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Please sign in first to accept this invitation.");
  const idToken = await currentUser.getIdToken();
  const response = await fetch("/api/invitations/accept", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.sessionUser) {
    throw new Error(payload.error || "Invitation could not be accepted.");
  }
  return payload.sessionUser;
}

async function rebuildSessionAfterAccept(initialSessionUser) {
  const currentUser = auth.currentUser;
  if (!currentUser) return initialSessionUser;
  const idToken = await currentUser.getIdToken(true);
  const headers = { Authorization: `Bearer ${idToken}` };

  let finalSession = initialSessionUser;
  try {
    const meResponse = await fetch("/api/me", { method: "GET", headers, credentials: "same-origin" });
    const payload = await meResponse.json().catch(() => ({}));
    if (meResponse.ok && payload.user) finalSession = payload.user;
  } catch (err) {
    console.warn("[InviteAccept] /api/me rebuild failed", err);
  }

  const assignedIds = Array.isArray(finalSession.assignedProjectIds) ? finalSession.assignedProjectIds : [];
  if (!assignedIds.length && !finalSession.allProjectsAccess) {
    try {
      await fetch("/api/sync-project-assignments", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        credentials: "same-origin",
      });
      const retry = await fetch("/api/me", { method: "GET", headers, credentials: "same-origin" });
      const retryPayload = await retry.json().catch(() => ({}));
      if (retry.ok && retryPayload.user) finalSession = retryPayload.user;
    } catch (err) {
      console.warn("[InviteAccept] sync fallback failed", err);
    }
  }

  persistSession({ ...finalSession, emailVerified: Boolean(currentUser.emailVerified) });
  return finalSession;
}

function getPostAcceptRedirect(sessionUser) {
  const ac = window.NexlanceAccessControl;
  if (ac && ac.canViewDashboard(sessionUser)) return "dashboard.html";
  return "projects.html";
}

async function acceptFlow(token, messageTarget) {
  setMessage(messageTarget, "Accepting invitation…", "success");
  const sessionUser = await callAcceptInvitation(token);
  setMessage(messageTarget, "Finalizing your access…", "success");
  const finalSession = await rebuildSessionAfterAccept(sessionUser);
  showState("successState");
  window.setTimeout(() => {
    window.location.href = getPostAcceptRedirect(finalSession);
  }, 900);
}

async function emailAlreadyRegistered(email) {
  try {
    const methods = await import("https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js")
      .then((mod) => mod.fetchSignInMethodsForEmail(auth, email))
      .catch(() => []);
    return Array.isArray(methods) && methods.length > 0;
  } catch {
    return false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await authReady;

  const params = new URLSearchParams(window.location.search);
  const token = String(params.get("token") || "").trim();
  if (!token) {
    showState("errorState");
    document.getElementById("errorDescription").textContent = "Invitation token is missing.";
    return;
  }

  let invitation = null;
  try {
    invitation = await resolveInvitation(token);
  } catch (error) {
    showState("errorState");
    document.getElementById("errorDescription").textContent = error.message || "Invitation could not be loaded.";
    return;
  }

  renderInvitationSummary(invitation);
  document.getElementById("signupEmail").value = invitation.email;
  document.getElementById("loginEmail").value = invitation.email;
  document.getElementById("signupName").value = invitation.inviteeName || "";

  // If the same user is already logged in and verified, silently accept.
  if (
    auth.currentUser
    && String(auth.currentUser.email || "").toLowerCase() === String(invitation.email || "").toLowerCase()
    && auth.currentUser.emailVerified
  ) {
    showState("loadingState");
    try {
      await acceptFlow(token, "signupMessage");
      return;
    } catch (err) {
      console.warn("[InviteAccept] silent accept failed, falling back to modal", err);
    }
  }

  // Choose initial state based on whether the email is already registered.
  const alreadyRegistered = await emailAlreadyRegistered(invitation.email);
  showState(alreadyRegistered ? "loginState" : "signupState");

  // Toggle wiring
  document.getElementById("switchToLogin").addEventListener("click", () => {
    setMessage("signupMessage", "");
    setMessage("loginMessage", "");
    showState("loginState");
  });
  document.getElementById("switchToSignup").addEventListener("click", () => {
    setMessage("signupMessage", "");
    setMessage("loginMessage", "");
    showState("signupState");
  });

  // Signup handler — creates Firebase user inline and attempts immediate acceptance
  document.getElementById("createAccountBtn").addEventListener("click", async () => {
    const btn = document.getElementById("createAccountBtn");
    const name = document.getElementById("signupName").value.trim() || invitation.inviteeName || invitation.email;
    const password = document.getElementById("signupPassword").value;

    if (!name) { setMessage("signupMessage", "Name is required.", "error"); return; }
    if (!password || password.length < 8) {
      setMessage("signupMessage", "Password must be at least 8 characters.", "error");
      return;
    }

    btn.disabled = true;
    setMessage("signupMessage", "Creating your account…", "success");

    try {
      const result = await createInvitedAccountSession({
        email: invitation.email,
        password,
        displayName: name,
        profileData: {
          name,
          email: invitation.email,
          inviteType: invitation.inviteType,
          membershipStatus: "pending",
          role: invitation.role,
          workspaceRole: invitation.role,
        },
      });
      if (!result.success) throw new Error(result.error || "Account could not be created.");

      // If Firebase requires email verification, we cannot accept yet.
      if (auth.currentUser && !auth.currentUser.emailVerified) {
        clearPersistedSession();
        await auth.signOut().catch(() => undefined);
        setMessage(
          "signupMessage",
          "Account created. Please check your inbox, verify your email, then sign in here to finish accepting.",
          "success"
        );
        setTimeout(() => showState("loginState"), 1500);
        return;
      }

      // Accept immediately
      await acceptFlow(token, "signupMessage");
    } catch (error) {
      const msg = String(error && error.message || "Account setup failed.");
      if (/email.*(already|in use|exists)/i.test(msg)) {
        setMessage("signupMessage", "An account already exists for this email. Please sign in.", "error");
        setTimeout(() => showState("loginState"), 900);
      } else {
        setMessage("signupMessage", msg, "error");
      }
    } finally {
      btn.disabled = false;
    }
  });

  // Login handler
  document.getElementById("signInAcceptBtn").addEventListener("click", async () => {
    const btn = document.getElementById("signInAcceptBtn");
    const password = document.getElementById("loginPassword").value;
    if (!password) { setMessage("loginMessage", "Password is required.", "error"); return; }

    btn.disabled = true;
    setMessage("loginMessage", "Signing you in…", "success");

    try {
      const result = await loginWithEmail(invitation.email, password, {});
      if (!result.success) throw new Error(result.error || "Sign in failed.");
      await acceptFlow(token, "loginMessage");
    } catch (error) {
      setMessage("loginMessage", error.message || "Sign in failed.", "error");
    } finally {
      btn.disabled = false;
    }
  });
});
