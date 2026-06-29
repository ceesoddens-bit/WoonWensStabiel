const admin = require('firebase-admin');
const serviceAccount = require('./firebase-admin.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function test() {
  const snapshot = await db.collection('huizen').orderBy('scNummer', 'desc').limit(2).get();
  snapshot.forEach(doc => {
    console.log(doc.id, '=>', doc.data().Datum, doc.data().scNummer);
  });
}

test().catch(console.error);
