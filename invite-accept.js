import { auth, authReady } from "./firebase.js";
import {
  clearPersistedSession,
  createInvitedAccountSession,
  loginWithEmail,
  persistSession,
  resendVerificationEmailForCredentials,
} from "./authService.js";

function showState(stateId) {
  document.querySelectorAll(".invite-state").forEach((element) => {
    element.classList.toggle("active", element.id === stateId);
  });
}

function setMessage(message = "", type = "") {
  const element = document.getElementById("inviteMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `invite-message${type ? ` ${type}` : ""}`;
}

function showForm(formId) {
  document.querySelectorAll(".invite-form").forEach((element) => {
    element.classList.toggle("active", element.id === formId);
  });
}

let pendingVerificationCredentials = null;

function setResendVerificationState(visible, credentials = null) {
  pendingVerificationCredentials = visible ? credentials : null;
  const button = document.getElementById("resendInviteVerificationBtn");
  if (!button) return;
  button.style.display = visible ? "block" : "none";
  button.disabled = false;
  button.textContent = "Resend verification email";
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

async function acceptInvitationWithSession(token) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Please sign in first to accept this invitation.");
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch("/api/invitations/accept", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify({ token }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.sessionUser) {
    throw new Error(payload.error || "Invitation could not be accepted.");
  }
  return payload.sessionUser;
}

function getPostAcceptRedirect(sessionUser) {
  const accessControl = window.NexlanceAccessControl;
  if (accessControl && accessControl.canViewDashboard(sessionUser)) {
    return "dashboard.html";
  }
  return "projects.html";
}

function renderInvitationSummary(invitation) {
  const summary = document.getElementById("inviteSummary");
  if (!summary) return;
  const roleLabel = window.NexlanceAccessControl
    ? window.NexlanceAccessControl.getRoleDisplayLabel(invitation.role)
    : invitation.role;
  const accessLabel = invitation.allProjectsAccess
    ? "All projects"
    : (invitation.inviteType === "client"
      ? `${(invitation.assignedProjectIds || []).length || 0} selected project(s)`
      : "Role-based team access");
  summary.innerHTML = `
    <strong>Email:</strong> ${invitation.email}<br>
    <strong>Role:</strong> ${roleLabel}<br>
    <strong>Access:</strong> ${accessLabel}
  `;
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
  document.getElementById("existingEmail").value = invitation.email;
  document.getElementById("inviteName").value = invitation.inviteeName || "";
  showForm("signupFormWrap");
  showState("acceptState");

  if (auth.currentUser && String(auth.currentUser.email || "").toLowerCase() === String(invitation.email || "").toLowerCase()) {
    if (auth.currentUser.emailVerified) {
      document.getElementById("acceptCurrentSessionBtn").style.display = "block";
    } else {
      setMessage("Verify your email address before accepting this invitation.", "error");
    }
  }

  document.getElementById("showSignupBtn").addEventListener("click", () => {
    showForm("signupFormWrap");
    setMessage("");
    setResendVerificationState(false);
  });

  document.getElementById("showLoginBtn").addEventListener("click", () => {
    showForm("loginFormWrap");
    setMessage("");
    setResendVerificationState(false);
  });

  const resendInviteVerificationBtn = document.getElementById("resendInviteVerificationBtn");
  if (resendInviteVerificationBtn) {
    resendInviteVerificationBtn.addEventListener("click", async () => {
      if (!pendingVerificationCredentials) {
        setMessage(
          "Enter your invite email and password, then try signing in again to resend verification.",
          "error"
        );
        return;
      }

      resendInviteVerificationBtn.disabled = true;
      resendInviteVerificationBtn.textContent = "Sending...";

      const result = await resendVerificationEmailForCredentials(
        pendingVerificationCredentials.email,
        pendingVerificationCredentials.password
      );

      resendInviteVerificationBtn.disabled = false;
      resendInviteVerificationBtn.textContent = "Resend verification email";
      setMessage(result.success ? result.message : result.error, result.success ? "success" : "error");
    });
  }

  document.getElementById("acceptCurrentSessionBtn").addEventListener("click", async () => {
    try {
      setMessage("Accepting invitation...", "success");
      const sessionUser = await acceptInvitationWithSession(token);
      console.info("[InviteAccept] Applied invitation scope", {
        workspaceId: String(sessionUser.workspaceId || "").trim(),
        assignedProjectIds: Array.isArray(sessionUser.assignedProjectIds) ? sessionUser.assignedProjectIds : [],
      });
      persistSession({
        ...sessionUser,
        emailVerified: Boolean(auth.currentUser && auth.currentUser.emailVerified),
      });
      showState("successState");
      window.setTimeout(() => {
        window.location.href = getPostAcceptRedirect(sessionUser);
      }, 900);
    } catch (error) {
      setMessage(error.message || "Invitation could not be accepted.", "error");
    }
  });

  document.getElementById("createAccountBtn").addEventListener("click", async () => {
    const name = document.getElementById("inviteName").value.trim() || invitation.inviteeName || invitation.email;
    const password = document.getElementById("invitePassword").value;
    if (!password || password.length < 8) {
      setMessage("Password must be at least 8 characters.", "error");
      return;
    }

    try {
      setMessage("Creating your account...", "success");
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

      if (!result.success) {
        throw new Error(result.error || "Account could not be created.");
      }

      setResendVerificationState(true, { email: invitation.email, password });
      showForm("loginFormWrap");
      document.getElementById("existingPassword").value = "";
      clearPersistedSession();
      await auth.signOut().catch(() => undefined);
      setMessage(
        "Account created. We sent a verification email to your inbox. Verify your email, then sign in here to accept the invitation.",
        "success"
      );
    } catch (error) {
      setMessage(error.message || "Account setup failed.", "error");
    }
  });

  document.getElementById("signInAcceptBtn").addEventListener("click", async () => {
    const password = document.getElementById("existingPassword").value;
    if (!password) {
      setMessage("Password is required.", "error");
      return;
    }

    try {
      setMessage("Signing you in...", "success");
      const result = await loginWithEmail(invitation.email, password, {});
      if (!result.success) {
        if (result.requiresEmailVerification) {
          setResendVerificationState(true, { email: invitation.email, password });
        }
        throw new Error(result.error || "Sign in failed.");
      }

      setResendVerificationState(false);
      const sessionUser = await acceptInvitationWithSession(token);
      console.info("[InviteAccept] Applied invitation scope", {
        workspaceId: String(sessionUser.workspaceId || "").trim(),
        assignedProjectIds: Array.isArray(sessionUser.assignedProjectIds) ? sessionUser.assignedProjectIds : [],
      });
      persistSession({
        ...sessionUser,
        emailVerified: Boolean(auth.currentUser && auth.currentUser.emailVerified),
      });
      showState("successState");
      window.setTimeout(() => {
        window.location.href = getPostAcceptRedirect(sessionUser);
      }, 900);
    } catch (error) {
      setMessage(error.message || "Sign in failed.", "error");
    }
  });
});
