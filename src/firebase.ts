import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD2YXI2UeU5LRzQhCDbskd_oj9NPmI0iJI",
  authDomain: "de-woonwens-manager.firebaseapp.com",
  projectId: "de-woonwens-manager",
  storageBucket: "de-woonwens-manager.firebasestorage.app",
  messagingSenderId: "388894037920",
  appId: "1:388894037920:web:ebe4d0888df2d90e1b36c5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore and get a reference to the service
export const db = getFirestore(app);
export const auth = getAuth(app);
