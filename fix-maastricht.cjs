const admin = require('firebase-admin');
const serviceAccount = require('./firebase-admin.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("Fetching Maastricht houses...");
  const snapshot = await db.collection('NieuweHuizenPerScrape')
                           .where('Plaats', '==', 'Maastricht')
                           .get();
                           
  console.log(`Found ${snapshot.size} houses in Maastricht. Clearing Wijk...`);
  
  let batch = db.batch();
  let count = 0;
  
  for (const doc of snapshot.docs) {
    batch.update(doc.ref, { Wijk: admin.firestore.FieldValue.delete() });
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  
  if (count > 0) {
    await batch.commit();
  }
  
  console.log("Done!");
}

run().catch(console.error);
