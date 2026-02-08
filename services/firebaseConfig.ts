import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

// Nigeria Diaspora Radio Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCS4zbka2jXE4QyVnfFaOTxTP6NuSkSRlA",
    authDomain: "diasporaradio-553e8.firebaseapp.com",
    projectId: "diasporaradio-553e8",
    storageBucket: "diasporaradio-553e8.firebasestorage.app",
    messagingSenderId: "696780313534",
    appId: "1:696780313534:web:3d070f288f3d1e824f9fef"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize Analytics (optional, with safe check for browser environment)
export const analytics = typeof window !== "undefined" ? getAnalytics(app) : null;
