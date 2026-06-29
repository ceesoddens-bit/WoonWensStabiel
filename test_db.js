import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "de-woonwens-manager",
};

// We don't have the full config here easily, let's just grep the local files for the error.
