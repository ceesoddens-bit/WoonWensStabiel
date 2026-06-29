import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, limit, query } from "firebase/firestore";

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

async function test() {
  try {
    const q = query(collection(db, "huizen"), limit(2));
    const querySnapshot = await getDocs(q);
    console.log("Total docs found:", querySnapshot.size);
    querySnapshot.forEach((doc) => {
      console.log(doc.id, " => ", doc.data());
    });
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}
test();
