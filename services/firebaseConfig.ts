import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

// Nigeria Diaspora Radio Firebase Configuration
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase only if the API key is present to avoid top-level crashes
const isFirebaseReady = !!firebaseConfig.apiKey && firebaseConfig.apiKey !== "undefined";

export const app = isFirebaseReady ? initializeApp(firebaseConfig) : null;

// DEPRECATED: Disabled Analytics to prevent illegal media tracking collision (nt.getCurrentTime error)
export const analytics = null;

