import { auth, db, provider, signInWithPopup, onAuthStateChanged, signOut, doc, setDoc, getDoc, collection, addDoc } from './firebase-setup.js';

// DOM Elements
const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const submitGameBtn = document.getElementById('submit-game-btn');
const gameThrowsInput = document.getElementById('game-throws');
const gameFeedback = document.getElementById('game-feedback');

let currentUser = null;

// -- AUTHENTICATION --
loginBtn.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Login failed", error);
  }
});

logoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    loginSection.style.display = 'none';
    appSection.style.display = 'block';
    
    // Update UI Profile
    document.getElementById('user-photo').src = user.photoURL;
    document.getElementById('user-name').innerText = user.displayName;
    
    // Ensure user document exists
    await setDoc(doc(db, "users", user.uid), {
      name: user.displayName,
      email: user.email,
      lastLogin: new Date()
    }, { merge: true });

    loadUserData();
  } else {
    currentUser = null;
    loginSection.style.display = 'block';
    appSection.style.display = 'none';
  }
});

// -- DATA & STATS --
async function loadUserData() {
  const userDoc = await getDoc(doc(db, "users", currentUser.uid));
  if (userDoc.exists()) {
    const data = userDoc.data();
    if (data.stats) {
      document.getElementById('stat-strike').innerText = `${data.stats.strikeRate || 0}%`;
      document.getElementById('stat-spare').innerText = `${data.stats.spareRate || 0}%`;
    }
    
    // Render Achievements
    const achContainer = document.getElementById('achievements-container');
    achContainer.innerHTML = '';
    if (data.achievements) {
        data.achievements.forEach(ach => {
            const span = document.createElement('span');
            span.className = 'achievement-badge';
            span.innerText = ach;
            achContainer.appendChild(span);
        });
    }
  }
}

// Convert comma string "10, 7, 3" into frames array [[10], [7, 3]]
function parseThrowsToFrames(throwString) {
  const throws = throwString.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
  let frames = [];
  let currentFrame = [];
  
  for (let i = 0; i < throws.length; i++) {
    currentFrame.push(throws[i]);
    if (frames.length < 9) {
      if (throws[i] === 10 || currentFrame.length === 2) {
        frames.push(currentFrame);
        currentFrame = [];
      }
    } else {
      // 10th frame holds all remaining throws (2 or 3 throws)
      if (i === throws.length - 1) {
        frames.push(currentFrame);
      }
    }
  }
  return frames;
}

function calculateNewStats(frames, currentStats) {
  let firstThrows = 0, strikes = 0, spareOpps = 0, spares = 0;

  frames.forEach((frame, index) => {
    if (frame.length > 0 && index < 10) {
      firstThrows++;
      if (frame[0] === 10) strikes++;
      else if (frame.length > 1) {
        spareOpps++;
        if (frame[0] + frame[1] === 10) spares++;
      }
    }
  });

  const sessionStrikeRate = firstThrows > 0 ? (strikes / firstThrows) * 100 : 0;
  const sessionSpareRate = spareOpps > 0 ? (spares / spareOpps) * 100 : 0;

  // In a real app, you'd pull ALL historic games to recalculate. 
  // For simplicity, we are just overriding with the latest session's stats here.
  return { 
    strikeRate: sessionStrikeRate.toFixed(1), 
    spareRate: sessionSpareRate.toFixed(1) 
  };
}

function checkAchievements(frames, currentAchievements = []) {
  let newAchievements = [...currentAchievements];
  let strikes = frames.filter(f => f[0] === 10).length;
  
  if (strikes >= 3 && !newAchievements.includes("Turkey! (3+ Strikes)")) {
    newAchievements.push("Turkey! (3+ Strikes)");
  }
  return newAchievements;
}

// -- SUBMIT GAME --
submitGameBtn.addEventListener('click', async () => {
  const inputVal = gameThrowsInput.value;
  if (!inputVal) return;

  submitGameBtn.innerText = "Saving...";
  
  const frames = parseThrowsToFrames(inputVal);
  
  try {
    // 1. Save game to games collection
    await addDoc(collection(db, "games"), {
      userId: currentUser.uid,
      date: new Date(),
      frames: frames
    });

    // 2. Fetch current user data to update stats
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};
    
    const newStats = calculateNewStats(frames, userData.stats || {});
    const newAchievements = checkAchievements(frames, userData.achievements || []);

    // 3. Update user profile
    await setDoc(userRef, {
      stats: newStats,
      achievements: newAchievements
    }, { merge: true });

    gameThrowsInput.value = '';
    gameFeedback.innerText = "Game saved successfully! (Even if offline)";
    submitGameBtn.innerText = "Save Game";
    
    // Refresh UI
    loadUserData();
    
    setTimeout(() => { gameFeedback.innerText = ''; }, 3000);
  } catch (error) {
    console.error("Error saving game", error);
    gameFeedback.innerText = "Error saving game.";
    submitGameBtn.innerText = "Save Game";
  }
});