import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Shared Firebase configuration for the frontend auth flow.
const firebaseConfig = {
  apiKey: "AIzaSyCv56CN--eQLTCxomNItL2FgLRoIbdsdoM",
  authDomain: "nexlance-df59e.firebaseapp.com",
  projectId: "nexlance-df59e",
  storageBucket: "nexlance-df59e.firebasestorage.app",
  messagingSenderId: "480679982312",
  appId: "1:480679982312:web:2eb0d840f03c81db49055d",
  measurementId: "G-0XG3807L8Q",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Keep users signed in across refreshes in the browser.
const authReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Firebase auth persistence could not be applied:", error);
});

export { app, auth, authReady, db, firebaseConfig };
