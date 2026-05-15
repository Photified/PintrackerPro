import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager,
  doc, setDoc, getDoc, collection, addDoc,
  query, where, getDocs, arrayUnion, arrayRemove,
  Timestamp, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// REPLACE THESE WITH YOUR ACTUAL FIREBASE PROJECT KEYS
const firebaseConfig = {
  apiKey: "AIzaSyDNAvU5UmGJXr5xCjeMw8vct1Wmeef-GTY",
  authDomain: "pintrackerpro.firebaseapp.com",
  projectId: "pintrackerpro",
  storageBucket: "pintrackerpro.firebasestorage.app",
  messagingSenderId: "1026895971482",
  appId: "1:1026895971482:web:44be7f67caba60f2434b23"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Enable offline persistence for the PWA
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const provider = new GoogleAuthProvider();

export { 
  auth, db, provider, signInWithPopup, onAuthStateChanged, signOut, 
  doc, setDoc, getDoc, collection, addDoc,
  query, where, getDocs, arrayUnion, arrayRemove,
  Timestamp, orderBy, limit 
};