import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Shared Firebase configuration for the frontend auth flow.
const firebaseConfig = {
  apiKey: "AIzaSyBmOse6NV9Gianc8IkOH_4UpjXYADj-xb4",
  authDomain: "nexlance-digital.firebaseapp.com",
  projectId: "nexlance-digital",
  storageBucket: "nexlance-digital.firebasestorage.app",
  messagingSenderId: "12126237565",
  appId: "1:12126237565:web:02b203c3989458aa35d214",
  measurementId: "G-C7H3GKMPWZ"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Keep users signed in across refreshes in the browser.
const authReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Firebase auth persistence could not be applied:", error);
});

export { app, auth, authReady, db, firebaseConfig };
