import { auth, authReady, db } from "./firebase.js";
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  verifyPasswordResetCode,
} from "firebase/auth";

// Bridge modular auth to global scope so supabase-config.js can access the token
// This is necessary because supabase-config.js uses the compat SDK which may not
// share auth state with the modular SDK on the login page.
if (typeof window !== "undefined") {
  window.__nexlance_modular_auth = auth;
}
import { doc, getDoc, setDoc } from "firebase/firestore";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

const AUTH_ACTION_URL = "https://nexlancedigital.com/auth-action.html";
const LOGIN_URL = "https://nexlancedigital.com/login.html";
const actionCodeSettings = {
  url: "https://nexlancedigital.com/auth-action.html",
  handleCodeInApp: true,
};

export function getAuthActionConfig() {
  return {
    actionHandlerUrl: AUTH_ACTION_URL,
    loginUrl: LOGIN_URL,
    actionCodeSettings,
  };
}

export function getFriendlyAuthError(error) {
  switch (error?.code) {
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-not-found":
    case "auth/account-not-registered":
      return "No account found with this email. Please create an account first.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Check your internet connection and try again.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is not enabled in Firebase.";
    case "auth/expired-action-code":
      return "This link has expired. Please request a new one.";
    case "auth/invalid-action-code":
      return "This link is invalid or has already been used.";
    case "auth/email-not-verified":
      return "Please verify your email address before logging in.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "Login succeeded, but Firestore blocked access to your profile data. Check your users/{uid} rules.";
    default:
      return error?.message || "Something went wrong. Please try again.";
  }
}

function buildFailure(error, extras = {}) {
  return {
    success: false,
    code: error?.code || extras.code || "auth/unknown",
    error: extras.error || getFriendlyAuthError(error),
    ...extras,
  };
}

async function ensureUserProfile(uid, defaults = {}) {
  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);
  const existingData = snapshot.exists() ? snapshot.data() : {};
  const nextData = { ...defaults, ...existingData };

  const missingDefaults = Object.entries(defaults).reduce((accumulator, [key, value]) => {
    if (existingData[key] === undefined) {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});

  if (!snapshot.exists() || Object.keys(missingDefaults).length > 0) {
    await setDoc(
      userRef,
      {
        ...(snapshot.exists() ? missingDefaults : nextData),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  }

  return nextData;
}

export function persistSession(sessionUser) {
  localStorage.setItem("nexlance_auth", "1");
  try {
    if (
      typeof window !== "undefined" &&
      window.NexlanceSessionState &&
      typeof window.NexlanceSessionState.writeSessionFromAuthFlow === "function"
    ) {
      const result = window.NexlanceSessionState.writeSessionFromAuthFlow(sessionUser, {
        persist: true,
      });
      if (result && result.user) {
        return result.user;
      }
    }
  } catch (error) {
    console.warn("Could not write session through NexlanceSessionState:", error);
  }
  localStorage.setItem("nexlance_user", JSON.stringify(sessionUser));
  return sessionUser;
}

export function clearPersistedSession() {
  localStorage.removeItem("nexlance_auth");
  localStorage.removeItem("nexlance_user");
}

export async function signUpWithEmail({
  email,
  password,
  displayName = "",
  profileData = {},
  skipEmailVerification = false,
  keepSignedIn = false,
}) {
  try {
    await authReady;

    const normalizedEmail = normalizeEmail(email);
    const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    const { user } = userCredential;

    if (displayName) {
      await updateProfile(user, { displayName });
    }

    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          email: normalizedEmail,
          name: displayName || normalizedEmail,
          createdAt: profileData.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...profileData,
        },
        { merge: true }
      );
    } catch (error) {
      await signOut(auth).catch(() => undefined);
      return buildFailure(error, {
        error:
          error?.code === "permission-denied" || error?.code === "firestore/permission-denied"
            ? "Account created in Firebase Authentication, but Firestore blocked writing users/{uid}. Update your Firestore rules to allow the signed-in user to create their own profile document."
            : undefined,
      });
    }

    if (!skipEmailVerification) {
      await sendEmailVerification(user, getAuthActionConfig().actionCodeSettings);
    }

    if (!keepSignedIn) {
      await signOut(auth);
    }

    return {
      success: true,
      user: auth.currentUser || user,
      message: "Account created. Please verify your email before signing in.",
    };
  } catch (error) {
    return buildFailure(error);
  }
}

export async function createInvitedAccountSession({
  email,
  password,
  displayName = "",
  profileData = {},
}) {
  return signUpWithEmail({
    email,
    password,
    displayName,
    profileData,
    skipEmailVerification: true,
    keepSignedIn: true,
  });
}

export async function loginWithEmail(email, password, profileDefaults = {}, options = {}) {
  try {
    await authReady;

    const normalizedEmail = normalizeEmail(email);
    const userCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    const { user } = userCredential;

    await reload(user);

    let profile = null;
    try {
      profile = await ensureUserProfile(user.uid, profileDefaults);
    } catch (error) {
      await signOut(auth).catch(() => undefined);
      return buildFailure(error, {
        error:
          error?.code === "permission-denied" || error?.code === "firestore/permission-denied"
            ? "Login succeeded, but Firestore blocked reading or updating users/{uid}. Update your Firestore rules so each signed-in user can access their own profile document."
            : undefined,
      });
    }

    // Email verification is NOT required to log in.  Verification emails are
    // only sent at account-creation time (self-signup).  Once an account
    // exists, the user can sign in with their credentials — verification
    // status does not gate access.  The `options.skipEmailVerification` and
    // `requiresEmailVerification` paths are kept for backwards compatibility
    // with any caller that still passes them, but they are no longer used to
    // block login.

    return {
      success: true,
      user: auth.currentUser,
      profile,
      message: "Login successful.",
    };
  } catch (error) {
    const credentialErrorCodes = new Set([
      "auth/invalid-credential",
      "auth/wrong-password",
      "auth/user-not-found",
    ]);

    if (credentialErrorCodes.has(error?.code)) {
      const accountExists = await checkAccountExists(email);
      if (accountExists === false) {
        return buildFailure(error, {
          code: "auth/account-not-registered",
          accountMissing: true,
          error: "No account found with this email. Please create an account first.",
        });
      }
    }

    return buildFailure(error);
  }
}

async function checkAccountExists(email) {
  try {
    const methods = await fetchSignInMethodsForEmail(auth, normalizeEmail(email));
    if (Array.isArray(methods) && methods.length > 0) return true;
    return false;
  } catch (error) {
    // Network errors or unexpected SDK errors — don't claim the account is missing.
    return null;
  }
}

export async function resendVerificationEmailForCredentials(email, password) {
  try {
    await authReady;

    const normalizedEmail = normalizeEmail(email);
    const userCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    const { user } = userCredential;

    await reload(user);

    if (user.emailVerified) {
      await signOut(auth);
      return {
        success: true,
        alreadyVerified: true,
        message: "This email is already verified. You can sign in now.",
      };
    }

    await sendEmailVerification(user, getAuthActionConfig().actionCodeSettings);
    await signOut(auth);

    return {
      success: true,
      message: "Verification email sent. Please check your inbox and spam folder.",
    };
  } catch (error) {
    return buildFailure(error);
  }
}

export async function sendForgotPasswordEmail(email) {
  try {
    await authReady;
    await sendPasswordResetEmail(
      auth,
      normalizeEmail(email),
      getAuthActionConfig().actionCodeSettings
    );

    return {
      success: true,
      message: "Password reset email sent. Please check your inbox and spam folder.",
    };
  } catch (error) {
    return buildFailure(error);
  }
}

export async function validatePasswordResetCode(actionCode) {
  await authReady;
  return verifyPasswordResetCode(auth, actionCode);
}

export async function confirmPasswordResetWithCode(actionCode, newPassword) {
  await authReady;
  return confirmPasswordReset(auth, actionCode, newPassword);
}

export async function resendVerificationEmailForCurrentUser() {
  try {
    await authReady;

    if (!auth.currentUser) {
      return buildFailure(
        { code: "auth/user-not-found" },
        { error: "Please sign in first to resend the verification email." }
      );
    }

    await reload(auth.currentUser);

    if (auth.currentUser.emailVerified) {
      return {
        success: true,
        alreadyVerified: true,
        message: "This email is already verified.",
      };
    }

    await sendEmailVerification(auth.currentUser, getAuthActionConfig().actionCodeSettings);

    return {
      success: true,
      message: "Verification email sent. Please check your inbox and spam folder.",
    };
  } catch (error) {
    return buildFailure(error);
  }
}

export async function logoutUser() {
  try {
    await authReady;
    await signOut(auth);
    clearPersistedSession();

    return {
      success: true,
      message: "Logged out successfully.",
    };
  } catch (error) {
    return buildFailure(error);
  }
}

export function listenToAuthState(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        await reload(user);
      } catch (error) {
        console.warn("Could not refresh auth state user:", error);
      }
    }

    callback(user);
  });
}

export async function applyEmailVerificationCode(actionCode) {
  await authReady;
  return applyActionCode(auth, actionCode);
}

export async function inspectActionCode(actionCode) {
  await authReady;
  return checkActionCode(auth, actionCode);
}
