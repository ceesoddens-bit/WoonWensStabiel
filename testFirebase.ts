import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, query, where, getDocs } from "firebase/firestore";

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

const N8N_KLANTEN_URL = 'https://woonwensmakelaar.app.n8n.cloud/webhook/69dda1df-46e0-4fc4-bcb8-cade9d33f5a8';

async function runMigration() {
  console.log("Start migratie van Google Sheets (N8N) naar Firebase Firestore...");
  
  try {
    // 1. Fetch from N8N
    const res = await fetch(N8N_KLANTEN_URL);
    const data = await res.json();
    const klantenLijst = Array.isArray(data) ? data : (data.klanten || []);
    
    console.log(`Er zijn ${klantenLijst.length} klanten gevonden in de sheet.`);

    let successCount = 0;
    const errors = [];

    // 2. Loop through customers and add them to Firestore
    for (const klant of klantenLijst) {
      if (!klant.Naam) continue; // Skip leeg profiel

      try {
        // Controleer of de klant al bestaat om dubbelingen te voorkomen
        const q = query(collection(db, 'klanten'), where("Naam", "==", klant.Naam));
        const existing = await getDocs(q);
        
        if (existing.empty) {
          await addDoc(collection(db, "klanten"), {
            ...klant,
            migratedAt: new Date().toISOString()
          });
          console.log(`✅ Toegevoegd: ${klant.Naam}`);
          successCount++;
        } else {
          console.log(`⏩ Overgeslagen (bestaat al): ${klant.Naam}`);
        }
      } catch (err) {
        console.error(`❌ Fout bij toevoegen ${klant.Naam}:`, err);
        errors.push(klant.Naam);
      }
    }

    console.log("\n==================================");
    console.log("MIGRATIE VOLTOOID");
    console.log(`Succesvol toegevoegd: ${successCount}`);
    if (errors.length > 0) {
      console.log("Fouten bij:", errors);
    }
    console.log("==================================\n");

    process.exit(0);
  } catch (e) {
    console.error("Fatale fout tijdens migratie: ", e);
    process.exit(1);
  }
}

runMigration();
