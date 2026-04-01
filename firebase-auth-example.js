import {
  listenToAuthState,
  loginWithEmail,
  logoutUser,
  resendVerificationEmailForCredentials,
  sendForgotPasswordEmail,
  signUpWithEmail,
} from "./authService.js";

function setMessage(text, type = "") {
  const message = document.getElementById("message");
  message.textContent = text;
  message.className = `message${type ? ` ${type}` : ""}`;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
  if (!email) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

function getFormValues() {
  return {
    fullName: document.getElementById("fullName").value.trim(),
    email: normalizeEmail(document.getElementById("email").value),
    password: document.getElementById("password").value,
    confirmPassword: document.getElementById("confirmPassword").value,
  };
}

function updateAuthState(user) {
  const authState = document.getElementById("authState");
  if (!user) {
    authState.textContent = "No active session.";
    return;
  }

  authState.innerHTML = `
    <strong>UID:</strong> ${user.uid}<br>
    <strong>Email:</strong> ${user.email}<br>
    <strong>Email Verified:</strong> ${user.emailVerified ? "Yes" : "No"}
  `;
}

document.getElementById("signupBtn").addEventListener("click", async () => {
  const { fullName, email, password, confirmPassword } = getFormValues();

  if (!fullName) {
    setMessage("Full name is required.", "error");
    return;
  }

  const emailError = validateEmail(email);
  if (emailError) {
    setMessage(emailError, "error");
    return;
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    setMessage(passwordError, "error");
    return;
  }

  if (password !== confirmPassword) {
    setMessage("Password and confirm password must match.", "error");
    return;
  }

  const result = await signUpWithEmail({
    email,
    password,
    displayName: fullName,
    profileData: {
      name: fullName,
      email,
      createdAt: new Date().toISOString(),
    },
  });

  setMessage(result.success ? result.message : result.error, result.success ? "success" : "error");
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  const { email, password } = getFormValues();

  const emailError = validateEmail(email);
  if (emailError) {
    setMessage(emailError, "error");
    return;
  }

  if (!password) {
    setMessage("Password is required.", "error");
    return;
  }

  const result = await loginWithEmail(email, password);
  setMessage(result.success ? result.message : result.error, result.success ? "success" : "error");
});

document.getElementById("forgotPasswordBtn").addEventListener("click", async () => {
  const { email } = getFormValues();

  const emailError = validateEmail(email);
  if (emailError) {
    setMessage(emailError, "error");
    return;
  }

  const result = await sendForgotPasswordEmail(email);
  setMessage(result.success ? result.message : result.error, result.success ? "success" : "error");
});

document.getElementById("resendVerificationBtn").addEventListener("click", async () => {
  const { email, password } = getFormValues();

  const emailError = validateEmail(email);
  if (emailError) {
    setMessage(emailError, "error");
    return;
  }

  if (!password) {
    setMessage("Enter the current password to resend verification.", "error");
    return;
  }

  const result = await resendVerificationEmailForCredentials(email, password);
  setMessage(result.success ? result.message : result.error, result.success ? "success" : "error");
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  const result = await logoutUser();
  setMessage(result.success ? result.message : result.error, result.success ? "success" : "error");
});

listenToAuthState(updateAuthState);
