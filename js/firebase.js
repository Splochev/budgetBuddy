// js/firebase.js — Firebase initialization and exports
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCIJlxyWuBSUMepIfPGKaeBvcHDsdFVftY",
  authDomain: "personalbudy-2f735.firebaseapp.com",
  projectId: "personalbudy-2f735",
  storageBucket: "personalbudy-2f735.firebasestorage.app",
  messagingSenderId: "138709908215",
  appId: "1:138709908215:web:b0b390f1d2f9b252bfb1f2",
  measurementId: "G-7L69KXWXD2",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
