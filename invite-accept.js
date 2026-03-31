import { auth, authReady } from "./firebase.js";
import {
  createInvitedAccountSession,
  loginWithEmail,
  persistSession,
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
  summary.innerHTML = `
    <strong>Email:</strong> ${invitation.email}<br>
    <strong>Role:</strong> ${roleLabel}<br>
    <strong>Access:</strong> ${invitation.inviteType === "client" ? "Assigned projects only" : "Role-based team access"}
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
    document.getElementById("acceptCurrentSessionBtn").style.display = "block";
  }

  document.getElementById("showSignupBtn").addEventListener("click", () => {
    showForm("signupFormWrap");
    setMessage("");
  });

  document.getElementById("showLoginBtn").addEventListener("click", () => {
    showForm("loginFormWrap");
    setMessage("");
  });

  document.getElementById("acceptCurrentSessionBtn").addEventListener("click", async () => {
    try {
      setMessage("Accepting invitation...", "success");
      const sessionUser = await acceptInvitationWithSession(token);
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

      const sessionUser = await acceptInvitationWithSession(token);
      persistSession({
        ...sessionUser,
        emailVerified: Boolean(auth.currentUser && auth.currentUser.emailVerified),
      });
      showState("successState");
      window.setTimeout(() => {
        window.location.href = getPostAcceptRedirect(sessionUser);
      }, 900);
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
        throw new Error(result.error || "Sign in failed.");
      }

      const sessionUser = await acceptInvitationWithSession(token);
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
