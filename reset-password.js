import {
  confirmPasswordResetWithCode,
  getFriendlyAuthError,
  validatePasswordResetCode,
} from "./authService.js";

function showState(state, elements) {
  elements.loading.style.display = state === "loading" ? "block" : "none";
  elements.error.style.display = state === "error" ? "block" : "none";
  elements.success.style.display = state === "success" ? "block" : "none";
  elements.form.style.display = state === "form" ? "block" : "none";
}

function validatePassword(password) {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Must contain at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Must contain at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "Must contain at least one number.";
  if (!/[!@#$%^&*()\-_=+\[\]{}|;:'\",.<>?/`~\\]/.test(password)) {
    return "Must contain at least one special character.";
  }
  return null;
}

function setFieldError(fieldId, message = "") {
  const errorEl = document.getElementById(`${fieldId}Error`);
  const inputEl = document.getElementById(fieldId);

  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = message ? "block" : "none";
  }

  if (inputEl) {
    inputEl.classList.toggle("input-error", Boolean(message));
  }
}

function setMessage(message, type = "") {
  const messageEl = document.getElementById("resetMessage");
  if (!messageEl) return;
  messageEl.textContent = message;
  messageEl.className = `form-message${type ? ` ${type}` : ""}`;
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

document.addEventListener("DOMContentLoaded", async () => {
  const elements = {
    loading: document.getElementById("loadingState"),
    error: document.getElementById("errorState"),
    success: document.getElementById("successState"),
    form: document.getElementById("resetForm"),
  };

  setupToggle("toggleNew", "newPassword");
  setupToggle("toggleConfirm", "confirmPassword");

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const oobCode = params.get("oobCode");

  if (mode !== "resetPassword" || !oobCode) {
    showState("error", elements);
    return;
  }

  showState("loading", elements);

  try {
    await validatePasswordResetCode(oobCode);
    showState("form", elements);
  } catch (error) {
    console.warn("Password reset code verification failed:", error);
    showState("error", elements);
    return;
  }

  document.getElementById("confirmPassword").addEventListener("input", () => {
    const password = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (!confirmPassword) {
      setFieldError("confirmPassword");
      return;
    }

    setFieldError(
      "confirmPassword",
      password !== confirmPassword ? "Passwords do not match." : ""
    );
  });

  document.getElementById("updatePasswordBtn").addEventListener("click", async () => {
    const password = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const updateButton = document.getElementById("updatePasswordBtn");

    setFieldError("newPassword");
    setFieldError("confirmPassword");
    setMessage("");

    const passwordError = validatePassword(password);
    if (passwordError) {
      setFieldError("newPassword", passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setFieldError("confirmPassword", "Passwords do not match.");
      return;
    }

    updateButton.disabled = true;
    updateButton.textContent = "Updating...";

    try {
      await confirmPasswordResetWithCode(oobCode, password);
      showState("success", elements);
      setTimeout(() => {
        window.location.href = "login.html";
      }, 3000);
    } catch (error) {
      console.error("Password reset confirmation failed:", error);
      updateButton.disabled = false;
      updateButton.textContent = "Update Password";

      if (
        error?.code === "auth/expired-action-code" ||
        error?.code === "auth/invalid-action-code"
      ) {
        showState("error", elements);
        return;
      }

      setMessage(getFriendlyAuthError(error), "error");
    }
  });
});
