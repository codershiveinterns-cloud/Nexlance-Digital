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

  // If the same user is already logged in, silently accept.
  // Email verification is not required for invitation acceptance — the
  // invitation token proves email ownership.
  if (
    auth.currentUser
    && String(auth.currentUser.email || "").toLowerCase() === String(invitation.email || "").toLowerCase()
  ) {
    showState("loadingState");
    try {
      await acceptFlow(token, "signupMessage");
      return;
    } catch (err) {
      console.warn("[InviteAccept] silent accept failed, falling back", err);
      // If the invitation has already been used, the user is already part of
      // the workspace — just rebuild their session and send them to their
      // dashboard instead of showing a confusing error.
      const errMsg = String(err && err.message || "");
      if (/already been used|already accepted|already used/i.test(errMsg)) {
        try {
          const finalSession = await rebuildSessionAfterAccept({});
          window.location.href = getPostAcceptRedirect(finalSession);
          return;
        } catch (_) {
          window.location.href = "login.html";
          return;
        }
      }
      // Any other failure: fall through to the login/signup form so the user
      // can re-authenticate manually.
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

  // Signup handler — creates the Firebase account ONLY, then signs out and
  // redirects to the login page.  The invitation stays pending in Firestore;
  // when the user logs in with their new credentials, the backend's
  // session-repair (ensureWorkspaceAccessProfile → findPendingInvitationForEmail
  // → acceptInvitation) will automatically accept the invitation and assign
  // the workspace.  This split avoids the race where a partial acceptance
  // marks the invitation as used before the UI can redirect, which previously
  // caused users to see "This invitation has already been used" on retry.
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

      // Sign out the freshly-created user so the login page asks for their
      // new credentials.  Also clear any persisted session from localStorage
      // so the login page's auto-redirect does not fire on stale data.
      await auth.signOut().catch(() => undefined);
      clearPersistedSession();

      setMessage("signupMessage", "Account created! Redirecting you to sign in…", "success");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 900);
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
      const result = await loginWithEmail(invitation.email, password, {}, { skipEmailVerification: true });
      if (!result.success) throw new Error(result.error || "Sign in failed.");
      await acceptFlow(token, "loginMessage");
    } catch (error) {
      setMessage("loginMessage", error.message || "Sign in failed.", "error");
    } finally {
      btn.disabled = false;
    }
  });
});
