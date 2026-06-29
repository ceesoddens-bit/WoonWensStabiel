import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD2YXI2UeU5LRzQhCDbskd_oj9NPmI0iJI",
  authDomain: "de-woonwens-manager.firebaseapp.com",
  projectId: "de-woonwens-manager",
  storageBucket: "de-woonwens-manager.firebasestorage.app",
  messagingSenderId: "388894037920",
  appId: "1:388894037920:web:ebe4d0888df2d90e1b36c5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function readMatches() {
  console.log("Ophalen van 'matches' collectie uit Firestore...");
  try {
    const querySnapshot = await getDocs(collection(db, 'matches'));
    console.log(`Aantal documenten in 'matches': ${querySnapshot.size}`);
    
    const matches: any[] = [];
    querySnapshot.forEach((doc) => {
      matches.push({
        id: doc.id,
        ...doc.data()
      });
    });

    console.log("Voorbeeld van matches (eerste 3):");
    console.dir(matches.slice(0, 3), { depth: null });
    
    // Save to scratch for persistence
    const fs = require('fs');
    fs.writeFileSync('matches_from_firebase.json', JSON.stringify(matches, null, 2));
    console.log("Alle matches opgeslagen in 'matches_from_firebase.json'");
    
    process.exit(0);
  } catch (error) {
    console.error("Fout bij uitlezen matches:", error);
    process.exit(1);
  }
}

readMatches();
