import { auth, db, provider, signInWithPopup, onAuthStateChanged, signOut, doc, setDoc, getDoc, collection, addDoc } from './firebase-setup.js';

// --- UI ELEMENTS ---
const loginSection = document.getElementById('login-section');
const appWrapper = document.getElementById('app-wrapper');
const mainNav = document.getElementById('main-nav');
let currentUser = null;

// --- NAVIGATION & TABS ---
const tabs = {
  profile: { btn: document.getElementById('tab-profile'), content: document.getElementById('profile-section') },
  play: { btn: document.getElementById('tab-play'), content: document.getElementById('play-section') }
};

function switchTab(tabName) {
  Object.values(tabs).forEach(tab => {
    tab.btn.classList.remove('active');
    tab.content.classList.remove('active');
  });
  tabs[tabName].btn.classList.add('active');
  tabs[tabName].content.classList.add('active');
}

tabs.profile.btn.addEventListener('click', () => switchTab('profile'));
tabs.play.btn.addEventListener('click', () => switchTab('play'));

// --- MODAL & PWA INSTALL ---
const helpModal = document.getElementById('help-modal');
document.getElementById('tab-help').addEventListener('click', () => helpModal.style.display = 'block');
document.getElementById('close-help').addEventListener('click', () => helpModal.style.display = 'none');
window.onclick = (e) => { if (e.target == helpModal) helpModal.style.display = 'none'; }

let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'block'; 
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') installBtn.style.display = 'none';
    deferredPrompt = null;
  }
});

// --- AUTHENTICATION ---
document.getElementById('login-btn').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    loginSection.style.display = 'none';
    appWrapper.style.display = 'block';
    mainNav.style.display = 'flex';
    
    document.getElementById('user-photo').src = user.photoURL;
    document.getElementById('user-name').innerText = user.displayName;
    
    await setDoc(doc(db, "users", user.uid), { name: user.displayName, lastLogin: new Date() }, { merge: true });
    loadUserData();
    
    // Draw the empty scorecard immediately
    flatThrowsArray = [];
    renderScorecard(); 
  } else {
    currentUser = null;
    loginSection.style.display = 'block';
    appWrapper.style.display = 'none';
    mainNav.style.display = 'none';
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
    const achContainer = document.getElementById('achievements-container');
    if (data.achievements && data.achievements.length > 0) {
      achContainer.innerHTML = data.achievements.map(ach => `<div class="badge">${ach}</div>`).join('');
    } else {
      achContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">Play games to unlock achievements!</p>';
    }
  }
}

// --- STATS & ACHIEVEMENT ENGINE ---
function calculateGameScore(throws) {
    let score = 0; let throwIndex = 0;
    for (let frame = 0; frame < 10; frame++) {
        if (throws[throwIndex] === 10) { 
            score += 10 + (throws[throwIndex + 1] || 0) + (throws[throwIndex + 2] || 0);
            throwIndex++;
        } else if ((throws[throwIndex] || 0) + (throws[throwIndex + 1] || 0) === 10) {
            score += 10 + (throws[throwIndex + 2] || 0);
            throwIndex += 2;
        } else {
            score += (throws[throwIndex] || 0) + (throws[throwIndex + 1] || 0);
            throwIndex += 2;
        }
    }
    return score;
}

// FIX: Now pushes incomplete frames so the scoreboard updates instantly!
function groupThrowsIntoFrames(throws) {
  let frames = []; let currentFrame = [];
  for (let i = 0; i < throws.length; i++) {
    currentFrame.push(throws[i]);
    if (frames.length < 9) {
      if (throws[i] === 10 || currentFrame.length === 2) { frames.push(currentFrame); currentFrame = []; }
    }
  }
  if (currentFrame.length > 0) frames.push(currentFrame);
  return frames;
}

function calculateNewStats(frames, currentStats, gameScore) {
  let sessionFirstThrows = 0, sessionFirstBallPins = 0, sessionOpenFrames = 0;
  frames.forEach((frame, index) => {
    if (frame.length > 0 && index < 10) {
      sessionFirstThrows++; sessionFirstBallPins += frame[0];
      if (frame[0] !== 10 && (frame.length === 1 || frame[0] + frame[1] !== 10)) { sessionOpenFrames++; }
    }
  });

  const totalGames = (currentStats.totalGames || 0) + 1;
  const totalPinfall = (currentStats.totalPinfall || 0) + gameScore;
  const totalFirstThrows = (currentStats.totalFirstThrows || 0) + sessionFirstThrows;
  const totalFirstBallPins = (currentStats.totalFirstBallPins || 0) + sessionFirstBallPins;
  const totalOpenFrames = (currentStats.totalOpenFrames || 0) + sessionOpenFrames;

  return {
    totalGames, totalPinfall, totalFirstThrows, totalFirstBallPins, totalOpenFrames,
    highGame: Math.max((currentStats.highGame || 0), gameScore),
    average: totalGames > 0 ? Math.floor(totalPinfall / totalGames) : 0,
    firstBallAvg: totalFirstThrows > 0 ? (totalFirstBallPins / totalFirstThrows).toFixed(2) : 0,
    openFrameRate: totalFirstThrows > 0 ? ((totalOpenFrames / totalFirstThrows) * 100).toFixed(1) : 0
  };
}

function checkAchievements(flatThrows, frames, score, currentAchievements = []) {
  let unlocked = new Set(currentAchievements);
  if (score >= 200) unlocked.add('200 Club 🎯');
  let isClean = true;
  for (let i = 0; i < 10; i++) {
    const f = frames[i];
    if (!f || (f[0] !== 10 && (f.length < 2 || f[0] + f[1] !== 10))) { isClean = false; break; }
  }
  if (isClean && frames.length === 10) unlocked.add('Clean Game 🧼');
  let strikeStreak = 0;
  for (let t of flatThrows) {
    if (t === 10) {
      strikeStreak++;
      if (strikeStreak >= 3) unlocked.add('Turkey 🦃');
    } else { strikeStreak = 0; }
  }
  const tenth = frames[9];
  if (tenth && tenth[0] === 10 && tenth[1] === 10 && tenth[2] === 10) unlocked.add('Clutch Finisher 🧊');
  return Array.from(unlocked);
}

// --- SCORECARD RENDERER ---
function renderScorecard() {
  const container = document.getElementById('scorecard');
  container.innerHTML = '';
  const frames = groupThrowsIntoFrames(flatThrowsArray);
  
  let runningScore = 0;
  let throwIdx = 0;

  for (let i = 1; i <= 10; i++) {
    const frameData = frames[i - 1] || [];
    let t1 = '', t2 = '', t3 = '';
    let frameScoreDisplay = '';

    if (frameData.length > 0) {
      if (i < 10) {
        let t1val = flatThrowsArray[throwIdx];
        let t2val = flatThrowsArray[throwIdx + 1];
        
        if (t1val === 10) { t2 = 'X'; throwIdx += 1; } 
        else {
          t1 = t1val === 0 ? '-' : t1val;
          if (frameData.length > 1) {
            t2 = (t1val + t2val === 10) ? '/' : (t2val === 0 ? '-' : t2val);
          }
          throwIdx += 2;
        }

        if ((t2 === 'X' && flatThrowsArray[throwIdx] !== undefined && flatThrowsArray[throwIdx+1] !== undefined) || 
            (t2 === '/' && flatThrowsArray[throwIdx] !== undefined) || 
            (t2 !== 'X' && t2 !== '/' && frameData.length === 2)) {
            let fScore = 0;
            if (t2 === 'X') fScore = 10 + flatThrowsArray[throwIdx] + flatThrowsArray[throwIdx+1];
            else if (t2 === '/') fScore = 10 + flatThrowsArray[throwIdx];
            else fScore = t1val + t2val;
            
            runningScore += fScore;
            frameScoreDisplay = runningScore;
        }

      } else {
        let t1val = flatThrowsArray[throwIdx];
        let t2val = flatThrowsArray[throwIdx + 1];
        let t3val = flatThrowsArray[throwIdx + 2];

        if (t1val !== undefined) t1 = t1val === 10 ? 'X' : (t1val === 0 ? '-' : t1val);
        if (t2val !== undefined) t2 = (t1val !== 10 && t1val + t2val === 10) ? '/' : (t2val === 10 ? 'X' : (t2val === 0 ? '-' : t2val));
        if (t3val !== undefined) t3 = (t2val !== 10 && t2val !== '/' && t2val + t3val === 10) ? '/' : (t3val === 10 ? 'X' : (t3val === 0 ? '-' : t3val));

        if (flatThrowsArray.length >= throwIdx + (t1val === 10 || t1val+t2val===10 ? 3 : 2)) {
          runningScore += calculateGameScore(flatThrowsArray.slice(throwIdx)); 
          frameScoreDisplay = calculateGameScore(flatThrowsArray); 
        }
      }
    }

    const frameHtml = `
      <div class="score-frame">
        <div class="frame-num">${i}</div>
        <div class="frame-throws">
          <div class="throw-box">${t1}</div>
          <div class="throw-box">${t2}</div>
          ${i === 10 ? `<div class="throw-box">${t3}</div>` : ''}
        </div>
        <div class="frame-score">${frameScoreDisplay}</div>
      </div>
    `;
    container.innerHTML += frameHtml;
  }
}

// --- PIN DECK LOGIC ---
let currentFrame = 1; let currentThrow = 1; let pinsStandingThisFrame = 10;
let flatThrowsArray = [];

const pins = document.querySelectorAll('.pin');
const frameDisplay = document.getElementById('current-frame-display');
const throwDisplay = document.getElementById('current-throw-display');
const gameFeedback = document.getElementById('game-feedback');

const strikeBtn = document.getElementById('strike-btn');
const spareBtn = document.getElementById('spare-btn');

pins.forEach(pin => { pin.addEventListener('click', () => { if (!pin.classList.contains('locked-down')) pin.classList.toggle('down'); }); });

function resetPins(fullReset = false) {
  pins.forEach(pin => {
    if (fullReset) pin.classList.remove('down', 'locked-down');
    else if (pin.classList.contains('down')) pin.classList.add('locked-down');
  });
}

function processThrow(pinsFallen) {
  flatThrowsArray.push(pinsFallen);
  pinsStandingThisFrame -= pinsFallen;
  renderScorecard(); 

  if (currentFrame < 10) {
    if (pinsStandingThisFrame === 0 || currentThrow === 2) advanceFrame();
    else { currentThrow = 2; resetPins(false); updateUI(); }
  } else {
    if (currentThrow === 1) {
      currentThrow = 2;
      if (pinsStandingThisFrame === 0) { pinsStandingThisFrame = 10; resetPins(true); } else resetPins(false);
      updateUI();
    } else if (currentThrow === 2) {
      if (flatThrowsArray[flatThrowsArray.length - 2] === 10 || pinsStandingThisFrame === 0) {
        currentThrow = 3;
        if (pinsStandingThisFrame === 0) { pinsStandingThisFrame = 10; resetPins(true); } else resetPins(false);
        updateUI();
      } else finishGame();
    } else finishGame();
  }
}

function advanceFrame() { currentFrame++; currentThrow = 1; pinsStandingThisFrame = 10; resetPins(true); updateUI(); }

function updateUI() { 
  frameDisplay.innerText = `Frame: ${currentFrame}`; 
  throwDisplay.innerText = `Throw: ${currentThrow}`; 

  // Smart Button Toggling
  if (pinsStandingThisFrame === 10) {
      strikeBtn.disabled = false;
      spareBtn.disabled = true;
  } else {
      strikeBtn.disabled = true;
      spareBtn.disabled = false;
  }
}

// Action Buttons
document.getElementById('gutter-btn').addEventListener('click', () => processThrow(0));

document.getElementById('record-throw-btn').addEventListener('click', () => {
  const newlyDown = document.querySelectorAll('.pin.down:not(.locked-down)').length;
  processThrow(newlyDown);
});

strikeBtn.addEventListener('click', () => {
  document.querySelectorAll('.pin:not(.down)').forEach(p => p.classList.add('down'));
  processThrow(pinsStandingThisFrame);
});

spareBtn.addEventListener('click', () => {
  document.querySelectorAll('.pin:not(.down)').forEach(p => p.classList.add('down'));
  processThrow(pinsStandingThisFrame);
});

async function finishGame() {
  document.getElementById('record-throw-btn').disabled = true;
  document.getElementById('gutter-btn').disabled = true;
  strikeBtn.disabled = true;
  spareBtn.disabled = true;
  gameFeedback.innerText = "Saving game...";

  const score = calculateGameScore(flatThrowsArray);
  const frames = groupThrowsIntoFrames(flatThrowsArray);

  try {
    await addDoc(collection(db, "games"), { userId: currentUser.uid, date: new Date(), frames: frames, score: score });
    
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};
    
    const newStats = calculateNewStats(frames, userData.stats || {}, score);
    const newAchievements = checkAchievements(flatThrowsArray, frames, score, userData.achievements || []);

    await setDoc(userRef, { 
      stats: newStats,
      achievements: newAchievements
    }, { merge: true });
    
    gameFeedback.innerText = `Game Saved! Score: ${score}`;
    loadUserData(); 
  } catch (err) { 
    console.error("Save Error:", err); 
    gameFeedback.innerText = "Error saving game. Check Firebase Rules!"; 
  }

  setTimeout(() => {
    flatThrowsArray = []; currentFrame = 1; currentThrow = 1; pinsStandingThisFrame = 10;
    resetPins(true); updateUI(); renderScorecard();
    document.getElementById('record-throw-btn').disabled = false;
    document.getElementById('gutter-btn').disabled = false;
    gameFeedback.innerText = "";
    switchTab('profile'); 
  }, 3500);
}