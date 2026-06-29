import admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

const serviceAccountPath = path.join(process.cwd(), 'firebase-admin.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error("Fout: firebase-admin.json bestaat niet.");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function readMatches() {
  console.log("Ophalen van 'matches' collectie via Firebase Admin SDK...");
  try {
    const matchesRef = db.collection('matches');
    const snapshot = await matchesRef.get();
    
    console.log(`Succes! Aantal documenten gevonden: ${snapshot.size}`);
    
    const matches: any[] = [];
    snapshot.forEach(doc => {
      matches.push({
        id: doc.id,
        ...doc.data()
      });
    });

    console.log("Voorbeeld van de eerste 3 matches:");
    console.dir(matches.slice(0, 3), { depth: null });
    
    fs.writeFileSync('matches_from_firebase_admin.json', JSON.stringify(matches, null, 2));
    console.log("Alle matches succesvol opgeslagen in 'matches_from_firebase_admin.json'");
    
    process.exit(0);
  } catch (error) {
    console.error("Fout bij ophalen matches via Admin SDK:", error);
    process.exit(1);
  }
}

readMatches();
