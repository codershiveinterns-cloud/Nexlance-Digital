import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Shared Firebase configuration for the frontend auth flow.
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBmOse6NV9Gianc8IkOH_4UpjXYADj-xb4",
  authDomain: "nexlance-digital.firebaseapp.com",
  projectId: "nexlance-digital",
  storageBucket: "nexlance-digital.firebasestorage.app",
  messagingSenderId: "12126237565",
  appId: "1:12126237565:web:02b203c3989458aa35d214",
  measurementId: "G-C7H3GKMPWZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
// const firebaseConfig = {
//   apiKey: "AIzaSyCv56CN--eQLTCxomNItL2FgLRoIbdsdoM",
//   authDomain: "nexlance-df59e.firebaseapp.com",
//   projectId: "nexlance-df59e",
//   storageBucket: "nexlance-df59e.firebasestorage.app",
//   messagingSenderId: "480679982312",
//   appId: "1:480679982312:web:2eb0d840f03c81db49055d",
//   measurementId: "G-0XG3807L8Q",
// };

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Keep users signed in across refreshes in the browser.
const authReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Firebase auth persistence could not be applied:", error);
});

export { app, auth, authReady, db, firebaseConfig };
