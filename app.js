import { auth, db, provider, signInWithPopup, onAuthStateChanged, signOut, doc, setDoc, getDoc, collection, addDoc } from './firebase-setup.js';

// --- UI ELEMENTS ---
const loginSection = document.getElementById('login-section');
const appSection = document.getElementById('app-section');
let currentUser = null;

// --- AUTHENTICATION ---
document.getElementById('login-btn').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    loginSection.style.display = 'none';
    appSection.style.display = 'block';
    
    document.getElementById('user-photo').src = user.photoURL;
    document.getElementById('user-name').innerText = user.displayName;
    
    await setDoc(doc(db, "users", user.uid), { name: user.displayName, lastLogin: new Date() }, { merge: true });
    loadUserData();
  } else {
    currentUser = null;
    loginSection.style.display = 'block';
    appSection.style.display = 'none';
  }
});

async function loadUserData() {
  const userDoc = await getDoc(doc(db, "users", currentUser.uid));
  if (userDoc.exists()) {
    const data = userDoc.data();
    if (data.stats) {
      document.getElementById('stat-avg').innerText = data.stats.average || 0;
      document.getElementById('stat-high').innerText = data.stats.highGame || 0;
      document.getElementById('stat-first').innerText = data.stats.firstBallAvg || 0;
      document.getElementById('stat-open').innerText = `${data.stats.openFrameRate || 0}%`;
    }
  }
}

// --- STATS MATH ENGINE ---
function calculateGameScore(throws) {
    let score = 0;
    let throwIndex = 0;
    for (let frame = 0; frame < 10; frame++) {
        if (throws[throwIndex] === 10) { // Strike
            score += 10 + (throws[throwIndex + 1] || 0) + (throws[throwIndex + 2] || 0);
            throwIndex++;
        } else if ((throws[throwIndex] || 0) + (throws[throwIndex + 1] || 0) === 10) { // Spare
            score += 10 + (throws[throwIndex + 2] || 0);
            throwIndex += 2;
        } else { // Open
            score += (throws[throwIndex] || 0) + (throws[throwIndex + 1] || 0);
            throwIndex += 2;
        }
    }
    return score;
}

function groupThrowsIntoFrames(throws) {
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
      if (i === throws.length - 1) frames.push(currentFrame);
    }
  }
  return frames;
}

function calculateNewStats(frames, currentStats, gameScore) {
  let sessionFirstThrows = 0, sessionFirstBallPins = 0, sessionOpenFrames = 0;

  frames.forEach((frame, index) => {
    if (frame.length > 0 && index < 10) {
      sessionFirstThrows++;
      sessionFirstBallPins += frame[0];
      if (frame[0] !== 10 && (frame.length === 1 || frame[0] + frame[1] !== 10)) {
          sessionOpenFrames++; 
      }
    }
  });

  const totalGames = (currentStats.totalGames || 0) + 1;
  const totalPinfall = (currentStats.totalPinfall || 0) + gameScore;
  const totalFirstThrows = (currentStats.totalFirstThrows || 0) + sessionFirstThrows;
  const totalFirstBallPins = (currentStats.totalFirstBallPins || 0) + sessionFirstBallPins;
  const totalOpenFrames = (currentStats.totalOpenFrames || 0) + sessionOpenFrames;

  const highGame = Math.max((currentStats.highGame || 0), gameScore);
  const average = totalGames > 0 ? Math.floor(totalPinfall / totalGames) : 0;
  const firstBallAvg = totalFirstThrows > 0 ? (totalFirstBallPins / totalFirstThrows).toFixed(2) : 0;
  const openFrameRate = totalFirstThrows > 0 ? ((totalOpenFrames / totalFirstThrows) * 100).toFixed(1) : 0;

  return {
    totalGames, totalPinfall, totalFirstThrows, totalFirstBallPins, totalOpenFrames,
    highGame, average, firstBallAvg, openFrameRate
  };
}

// --- PIN DECK LOGIC ---
let currentFrame = 1;
let currentThrow = 1;
let pinsStandingThisFrame = 10;
let flatThrowsArray = [];

const pins = document.querySelectorAll('.pin');
const recordThrowBtn = document.getElementById('record-throw-btn');
const gutterBtn = document.getElementById('gutter-btn');
const frameDisplay = document.getElementById('current-frame-display');
const throwDisplay = document.getElementById('current-throw-display');
const gameFeedback = document.getElementById('game-feedback');

pins.forEach(pin => {
  pin.addEventListener('click', () => {
    if (!pin.classList.contains('locked-down')) pin.classList.toggle('down');
  });
});

function resetPins(fullReset = false) {
  pins.forEach(pin => {
    if (fullReset) {
      pin.classList.remove('down', 'locked-down');
    } else if (pin.classList.contains('down')) {
      pin.classList.add('locked-down');
    }
  });
}

function processThrow(pinsFallen) {
  flatThrowsArray.push(pinsFallen);
  pinsStandingThisFrame -= pinsFallen;

  if (currentFrame < 10) {
    if (pinsStandingThisFrame === 0 || currentThrow === 2) advanceFrame();
    else { currentThrow = 2; resetPins(false); updateUI(); }
  } else {
    // 10th Frame
    if (currentThrow === 1) {
      currentThrow = 2;
      if (pinsStandingThisFrame === 0) { pinsStandingThisFrame = 10; resetPins(true); } 
      else resetPins(false);
      updateUI();
    } else if (currentThrow === 2) {
      if (flatThrowsArray[flatThrowsArray.length - 2] === 10 || pinsStandingThisFrame === 0) {
        currentThrow = 3;
        if (pinsStandingThisFrame === 0) { pinsStandingThisFrame = 10; resetPins(true); } 
        else resetPins(false);
        updateUI();
      } else finishGame();
    } else finishGame();
  }
}

function advanceFrame() {
  currentFrame++;
  currentThrow = 1;
  pinsStandingThisFrame = 10;
  resetPins(true);
  updateUI();
}

function updateUI() {
  frameDisplay.innerText = `Frame: ${currentFrame}`;
  throwDisplay.innerText = `Throw: ${currentThrow}`;
}

gutterBtn.addEventListener('click', () => processThrow(0));

recordThrowBtn.addEventListener('click', () => {
  const newlyDown = document.querySelectorAll('.pin.down:not(.locked-down)').length;
  processThrow(newlyDown);
});

async function finishGame() {
  recordThrowBtn.disabled = true;
  gutterBtn.disabled = true;
  gameFeedback.innerText = "Saving game...";

  const score = calculateGameScore(flatThrowsArray);
  const frames = groupThrowsIntoFrames(flatThrowsArray);

  try {
    await addDoc(collection(db, "games"), { userId: currentUser.uid, date: new Date(), frames: frames, score: score });
    
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};
    
    const newStats = calculateNewStats(frames, userData.stats || {}, score);
    await setDoc(userRef, { stats: newStats }, { merge: true });

    gameFeedback.innerText = `Game Saved! Score: ${score}`;
    loadUserData(); // Refresh UI
  } catch (err) {
    console.error(err);
    gameFeedback.innerText = "Error saving game.";
  }

  setTimeout(() => {
    flatThrowsArray = [];
    currentFrame = 1;
    currentThrow = 1;
    pinsStandingThisFrame = 10;
    resetPins(true);
    updateUI();
    recordThrowBtn.disabled = false;
    gutterBtn.disabled = false;
    gameFeedback.innerText = "";
  }, 4000);
}