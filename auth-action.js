import {
  applyEmailVerificationCode,
  confirmPasswordResetWithCode,
  getAuthActionConfig,
  getFriendlyAuthError,
  inspectActionCode,
  validatePasswordResetCode,
} from "./authService.js";

function showState(stateId) {
  document.querySelectorAll(".action-state").forEach((element) => {
    element.classList.toggle("active", element.id === stateId);
  });
}

function setFieldError(fieldId, message = "") {
  const errorElement = document.getElementById(`${fieldId}Error`);
  const inputElement = document.getElementById(fieldId);

  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = message ? "block" : "none";
  }

  if (inputElement) {
    inputElement.classList.toggle("input-error", Boolean(message));
  }
}

function setMessage(id, message = "", type = "") {
  const element = document.getElementById(id);
  if (!element) return;

  element.textContent = message;
  element.className = `action-message${type ? ` ${type}` : ""}`;
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

document.addEventListener("DOMContentLoaded", async () => {
  setupToggle("toggleNewPassword", "newPassword");
  setupToggle("toggleConfirmPassword", "confirmPassword");

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const actionCode = params.get("oobCode");
  const continueUrl = params.get("continueUrl");
  const { loginUrl } = getAuthActionConfig();

  const targetLoginUrl = continueUrl || loginUrl;
  document.getElementById("verifyLoginLink").href = targetLoginUrl;

  if (!mode || !actionCode) {
    showState("errorState");
    document.getElementById("errorDescription").textContent =
      "This action link is missing required Firebase parameters.";
    return;
  }

  if (mode === "verifyEmail") {
    try {
      await applyEmailVerificationCode(actionCode);
      showState("verifySuccessState");
      setTimeout(() => {
        window.location.href = targetLoginUrl;
      }, 2500);
    } catch (error) {
      showState("errorState");
      document.getElementById("errorDescription").textContent =
        getFriendlyAuthError(error) || "Verification link is invalid or expired.";
    }
    return;
  }

  if (mode === "resetPassword") {
    try {
      await validatePasswordResetCode(actionCode);
      showState("resetState");
    } catch (error) {
      showState("errorState");
      document.getElementById("errorDescription").textContent =
        getFriendlyAuthError(error) || "Password reset link is invalid or expired.";
      return;
    }

    document.getElementById("resetPasswordBtn").addEventListener("click", async () => {
      const password = document.getElementById("newPassword").value;
      const confirmPassword = document.getElementById("confirmPassword").value;

      setFieldError("newPassword");
      setFieldError("confirmPassword");
      setMessage("resetMessage");

      const passwordError = validatePassword(password);
      if (passwordError) {
        setFieldError("newPassword", passwordError);
        return;
      }

      if (password !== confirmPassword) {
        setFieldError("confirmPassword", "Passwords do not match.");
        return;
      }

      try {
        await confirmPasswordResetWithCode(actionCode, password);
        setMessage("resetMessage", "Password reset successful. You can sign in now.", "success");
        setTimeout(() => {
          window.location.href = targetLoginUrl;
        }, 2500);
      } catch (error) {
        setMessage("resetMessage", getFriendlyAuthError(error), "error");
      }
    });
    return;
  }

  if (mode === "recoverEmail") {
    try {
      const info = await inspectActionCode(actionCode);
      await applyEmailVerificationCode(actionCode);
      showState("recoverState");
      if (info?.data?.email) {
        document.getElementById("recoverDescription").textContent =
          `Your email address ${info.data.email} has been restored successfully.`;
      }
    } catch (error) {
      showState("errorState");
      document.getElementById("errorDescription").textContent =
        getFriendlyAuthError(error) || "Recover email link is invalid or expired.";
    }
    return;
  }

  showState("errorState");
  document.getElementById("errorDescription").textContent =
    `Unsupported Firebase action mode: ${mode}`;
});
