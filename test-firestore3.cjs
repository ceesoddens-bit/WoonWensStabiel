const admin = require('firebase-admin');
const serviceAccount = require('./firebase-admin.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function test() {
  const snapshot = await db.collection('NieuweHuizenPerScrape').count().get();
  console.log('Total documents:', snapshot.data().count);
}

test().catch(console.error);
