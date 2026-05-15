import { 
  auth, db, provider, signInWithPopup, onAuthStateChanged, signOut, 
  doc, setDoc, getDoc, collection, addDoc,
  query, where, getDocs, arrayUnion, arrayRemove,
  Timestamp, orderBy, limit as firestoreLimit
} from './firebase-setup.js';

// --- UI ELEMENTS & NAV ---
const loginSection = document.getElementById('login-section');
const appWrapper = document.getElementById('app-wrapper');
const mainNav = document.getElementById('main-nav');
let currentUser = null;
let radarChart = null; 
let historyChart = null;
let currentUserFriends = []; 
let activeProfileGames = []; // Stores games globally so chart toggles are instant

const tabs = {
  profile: { btn: document.getElementById('tab-profile'), content: document.getElementById('profile-section') },
  play: { btn: document.getElementById('tab-play'), content: document.getElementById('play-section') },
  friends: { btn: document.getElementById('tab-friends'), content: document.getElementById('friends-section') }
};

function switchTab(tabName) {
  Object.values(tabs).forEach(tab => {
    tab.btn.classList.remove('active');
    tab.content.classList.remove('active');
  });
  tabs[tabName].btn.classList.add('active');
  tabs[tabName].content.classList.add('active');
}

tabs.profile.btn.addEventListener('click', () => {
  if (currentUser) loadProfile(currentUser.uid);
  switchTab('profile');
});

tabs.play.btn.addEventListener('click', () => {
  switchTab('play');
});

tabs.friends.btn.addEventListener('click', () => {
  switchTab('friends');
  loadFriendsList();
});

// --- CHART TOGGLES ---
document.getElementById('limit-5-btn').addEventListener('click', (e) => updateHistoryChartLimit(e, 5));
document.getElementById('limit-10-btn').addEventListener('click', (e) => updateHistoryChartLimit(e, 10));
document.getElementById('limit-25-btn').addEventListener('click', (e) => updateHistoryChartLimit(e, 25));
document.getElementById('limit-50-btn').addEventListener('click', (e) => updateHistoryChartLimit(e, 50));
if(document.getElementById('limit-all-btn')) {
  document.getElementById('limit-all-btn').addEventListener('click', (e) => updateHistoryChartLimit(e, 'ALL'));
}

function updateHistoryChartLimit(e, newLimit) {
  document.querySelectorAll('#history-toggles .toggle-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  if (currentUser) updateDashboard(activeProfileGames, newLimit);
}

// --- MODALS & PWA ---
const helpModal = document.getElementById('help-modal');
const infoModal = document.getElementById('info-modal');

document.getElementById('tab-help').addEventListener('click', () => helpModal.style.display = 'block');
document.getElementById('close-help').addEventListener('click', () => helpModal.style.display = 'none');
document.getElementById('close-info').addEventListener('click', () => infoModal.style.display = 'none');

// NEW: Info button listener for the Bowler Web
if (document.getElementById('web-info-btn')) {
  document.getElementById('web-info-btn').addEventListener('click', () => {
    document.getElementById('info-title').innerText = 'Metric Definitions';
    document.getElementById('info-desc').innerHTML = `
      <div style="text-align: left; font-size: 0.9rem; line-height: 1.5;">
        <p><b>Avg:</b> Your average score per game.</p>
        <p><b>High:</b> Your highest recorded game score.</p>
        <p><b>Strike %:</b> Frames where your first throw was a strike.</p>
        <p><b>Spare %:</b> Makeable spare opportunities you converted.</p>
        <p><b>Fill %:</b> Frames where you scored a strike or spare (no open frames).</p>
        <p><b>1st Ball:</b> Average pins knocked down on the first throw.</p>
      </div>
    `;
    document.getElementById('info-modal').style.display = 'block';
  });
}

window.onclick = (e) => { 
  if (e.target == helpModal) helpModal.style.display = 'none'; 
  if (e.target == infoModal) infoModal.style.display = 'none'; 
}

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

// --- PROFILE PHOTO UPLOAD ---
const photoWrapper = document.getElementById('photo-wrapper');
const photoInput = document.getElementById('photo-upload');

photoWrapper.addEventListener('click', () => photoInput.click());

photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const MAX_SIZE = 250;
      let width = img.width; 
      let height = img.height;

      if (width > height) { 
        if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } 
      } else { 
        if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } 
      }
      
      canvas.width = width; 
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      document.getElementById('user-photo').src = dataUrl;
      setDoc(doc(db, "users", currentUser.uid), { customPhoto: dataUrl }, { merge: true });
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
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
    
    await setDoc(doc(db, "users", user.uid), { 
      name: user.displayName, 
      email: user.email.toLowerCase(), 
      defaultPhoto: user.photoURL, 
      lastLogin: Timestamp.now()
    }, { merge: true });
    
    loadProfile(currentUser.uid); 
    flatThrowsArray = [];
    splitIndices = [];
    renderScorecard(); 
  } else {
    currentUser = null;
    loginSection.style.display = 'block';
    appWrapper.style.display = 'none';
    mainNav.style.display = 'none';
  }
});

// --- PROFILE LOADER & DASHBOARD UPDATER ---
const MASTER_ACHIEVEMENTS = [
  { id: '200 Club 🎯', desc: 'Score 200 points or more in a single game.' },
  { id: 'Clean Game 🧼', desc: 'Complete a game without leaving any open frames.' },
  { id: 'Perfect Game 👑', desc: 'Bowl a flawless 300 game.' },
  { id: 'Double 🎳', desc: 'Bowl 2 strikes in a row.' },
  { id: 'Turkey 🦃', desc: 'Bowl 3 strikes in a row.' },
  { id: 'Hambone 🍖', desc: 'Bowl 4 strikes in a row.' },
  { id: 'Clutch Finisher 🧊', desc: 'Strike out the 10th frame (3 strikes).' },
  { id: 'Split Converter 🎳', desc: 'Successfully pick up a split spare.' },
  { id: 'Gutter-Free 🛡️', desc: 'Complete a game without throwing a single gutter ball.' }
];

document.getElementById('back-to-me-btn').addEventListener('click', () => loadProfile(currentUser.uid));

window.viewFriendProfile = (friendUid) => {
  loadProfile(friendUid);
  switchTab('profile');
};

async function loadProfile(targetUid) {
  const isMe = (targetUid === currentUser.uid);
  
  document.getElementById('back-to-me-btn').style.display = isMe ? 'none' : 'inline-block';
  document.getElementById('logout-btn').style.display = isMe ? 'block' : 'none';
  document.getElementById('photo-overlay').style.display = isMe ? '' : 'none';
  document.getElementById('photo-wrapper').style.pointerEvents = isMe ? 'auto' : 'none';

  const userDoc = await getDoc(doc(db, "users", targetUid));
  if (userDoc.exists()) {
    const data = userDoc.data();
    
    document.getElementById('user-name').innerText = data.name + (isMe ? "" : "'s Stats");
    document.getElementById('user-photo').src = data.customPhoto || data.defaultPhoto || '';
    
    if (isMe) currentUserFriends = data.friends || [];

    let achData = data.achievements || {};
    if (Array.isArray(achData)) {
      const migrated = {}; 
      achData.forEach(ach => migrated[ach] = 1); 
      achData = migrated;
    }

    const achContainer = document.getElementById('achievements-container');
    achContainer.innerHTML = MASTER_ACHIEVEMENTS.map((ach, idx) => {
      const count = achData[ach.id] || 0;
      const isUnlocked = count > 0;
      return `
        <div class="achievement-wrapper ${isUnlocked ? '' : 'ghosted'}" data-idx="${idx}">
          <div class="badge">${ach.id}</div>
          <div class="ach-count ${isUnlocked ? 'active-count' : ''}">${isUnlocked ? `x${count}` : '0'}</div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('.achievement-wrapper').forEach(wrapper => {
      wrapper.addEventListener('click', () => {
        const idx = wrapper.getAttribute('data-idx');
        const ach = MASTER_ACHIEVEMENTS[idx];
        document.getElementById('info-title').innerText = ach.id;
        document.getElementById('info-desc').innerText = ach.desc;
        document.getElementById('info-modal').style.display = 'block';
      });
    });

    const gamesRef = collection(db, "games");
    const userGamesQuery = query(gamesRef, where("userId", "==", targetUid));
    
    try {
      const gSnap = await getDocs(userGamesQuery);
      let allGames = [];
      gSnap.forEach(doc => allGames.push(doc.data()));
      
      allGames.sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
      activeProfileGames = allGames; 
      
      const activeBtn = document.querySelector('#history-toggles .toggle-btn.active');
      let limit = 10;
      if (activeBtn) {
        limit = activeBtn.innerText === 'ALL' ? 'ALL' : parseInt(activeBtn.innerText);
      }
      
      updateDashboard(activeProfileGames, limit); 
    } catch (err) {
      console.error("Error loading games for charts:", err);
    }
  }
}

function updateDashboard(allGames, requestedLimit) {
  const limitNum = requestedLimit === 'ALL' ? allGames.length : parseInt(requestedLimit);
  const displayGames = allGames.slice(-limitNum);
  
  let dTotalGames = displayGames.length;
  let dTotalPinfall = 0, dHighGame = 0, dFirstThrows = 0, dFirstBallPins = 0;
  let dStrikes = 0, dSpareOpps = 0, dSpares = 0, dOpenFrames = 0;

  displayGames.forEach(g => {
    dTotalPinfall += g.score;
    if (g.score > dHighGame) dHighGame = g.score;
    const frames = groupThrowsIntoFrames(g.throws || []);
    frames.forEach((f, i) => {
      if (f.length > 0 && i < 10) {
        dFirstThrows++;
        dFirstBallPins += f[0];
        if (f[0] === 10) dStrikes++;
        else {
          dSpareOpps++;
          if (f.length > 1 && f[0] + f[1] === 10) dSpares++;
          else if (f.length > 1) dOpenFrames++;
        }
      }
    });
  });

  const dAvg = dTotalGames > 0 ? Math.floor(dTotalPinfall / dTotalGames) : 0;
  const dFirstBallAvg = dFirstThrows > 0 ? (dFirstBallPins / dFirstThrows) : 0;
  const dStrikePct = dFirstThrows > 0 ? (dStrikes / dFirstThrows) * 100 : 0;
  const dSparePct = dSpareOpps > 0 ? (dSpares / dSpareOpps) * 100 : 0;
  const dOpenPct = dFirstThrows > 0 ? (dOpenFrames / dFirstThrows) * 100 : 0;
  const dFillPct = 100 - dOpenPct;

  document.getElementById('stat-avg').innerText = dAvg;
  document.getElementById('stat-high').innerText = dHighGame;
  document.getElementById('stat-first').innerText = dFirstBallAvg.toFixed(2);
  document.getElementById('stat-open').innerText = dOpenPct.toFixed(1) + '%';

  drawHistoryChart(displayGames, requestedLimit);
  drawRadarChart(dAvg, dHighGame, dFirstBallAvg, dStrikePct, dSparePct, dFillPct);
}

function getGameDetails(throws) {
  if (!throws || !Array.isArray(throws) || throws.length === 0) return { strikes: 'N/A', spares: 'N/A' };
  let strikes = 0, spares = 0;
  let throwIndex = 0;
  
  for (let frame = 0; frame < 10; frame++) {
    if (throws[throwIndex] === 10) { 
      strikes++;
      throwIndex++;
      if (frame === 9) { 
        if (throws[throwIndex] === 10) strikes++;
        if (throws[throwIndex+1] === 10) strikes++;
        else if (throws[throwIndex] !== undefined && throws[throwIndex] !== 10 && throws[throwIndex] + (throws[throwIndex+1]||0) === 10) spares++;
      }
    } else if ((throws[throwIndex] || 0) + (throws[throwIndex + 1] || 0) === 10) { 
      spares++;
      throwIndex += 2;
      if (frame === 9 && throws[throwIndex] === 10) strikes++;
    } else { 
      throwIndex += 2; 
    }
  }
  return { strikes, spares };
}

function drawHistoryChart(displayGames, requestedLimit) {
  const ctx = document.getElementById('historyChart').getContext('2d');
  const gameCount = displayGames.length;

  const labels = displayGames.map((g, i) => {
    if(g.date instanceof Timestamp) return g.date.toDate().toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
    return `G${i+1}`; 
  });
  
  const data = displayGames.map(g => g.score);
  const detailsData = displayGames.map(g => getGameDetails(g.throws));

  if (historyChart) historyChart.destroy();

  if (displayGames.length === 0) {
    historyChart = new Chart(ctx, {
      type: 'line',
      data: { labels: ['No Data'], datasets: [{ data: [] }] },
      options: { scales: { y: { display: false }, x: { display: false } }, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
    return;
  }

  const dynamicRadius = gameCount > 25 ? 2 : 4;
  const dynamicHover = gameCount > 25 ? 4 : 6;

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Score',
        data: data,
        gameDetails: detailsData, 
        borderColor: '#ff6f00',
        backgroundColor: 'rgba(255, 111, 0, 0.1)',
        borderWidth: 2,
        pointBackgroundColor: '#0b3260',
        pointBorderColor: '#ff6f00',
        pointRadius: dynamicRadius,
        pointHoverRadius: dynamicHover,
        pointHitRadius: 25, 
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        y: { beginAtZero: true, max: 300, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#95b8df' } },
        x: { grid: { display: false }, ticks: { color: '#95b8df', maxTicksLimit: 10 } }
      },
      plugins: { 
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(4, 26, 51, 0.9)',
          titleColor: '#ff6f00',
          bodyFont: { size: 13 },
          padding: 10,
          displayColors: false,
          callbacks: {
            title: function(context) { return context[0].label; },
            label: function(context) {
              const details = context.dataset.gameDetails[context.dataIndex];
              return [
                `Score: ${context.raw}`,
                `Strikes: ${details.strikes}`,
                `Spares: ${details.spares}`
              ];
            }
          }
        }
      }
    }
  });
}

function drawRadarChart(avg, high, firstBall, strikePct, sparePct, fillPct) {
  const ctx = document.getElementById('statsChart').getContext('2d');
  
  const nAvg = Number(avg) || 0;
  const nHigh = Number(high) || 0;
  const nFirstBall = Number(firstBall) || 0;
  const nStrikePct = Number(strikePct) || 0;
  const nSparePct = Number(sparePct) || 0;
  const nFillPct = Number(fillPct) || 0;

  // Reduced the High Game ceiling to 230 so an average high game actually pushes outward visually.
  const visAvg = Math.min(100, Math.sqrt(nAvg / 230) * 100); 
  const visHigh = Math.min(100, Math.sqrt(nHigh / 230) * 100); 
  const vis1st = Math.min(100, Math.sqrt(nFirstBall / 9.5) * 100); 
  const visStrike = Math.min(100, Math.sqrt(nStrikePct / 60) * 100); 
  const visSpare = Math.min(100, Math.sqrt(nSparePct / 85) * 100); 
  const visFill = Math.min(100, Math.sqrt(nFillPct / 90) * 100); 

  const chartData = [visAvg, visHigh, visStrike, visSpare, visFill, vis1st];
  
  const realData = [
    nAvg,
    nHigh,
    nStrikePct.toFixed(1) + '%',
    nSparePct.toFixed(1) + '%',
    nFillPct.toFixed(1) + '%',
    nFirstBall.toFixed(2)
  ];

  if (radarChart) radarChart.destroy(); 

  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Avg', 'High', 'Strike %', 'Spare %', 'Fill %', '1st Ball'],
      datasets: [{
        label: 'Bowler Profile',
        data: chartData,
        rawValues: realData,
        backgroundColor: 'rgba(255, 111, 0, 0.2)',
        borderColor: '#ff6f00',
        pointBackgroundColor: '#ff6f00',
        pointHoverRadius: 6,
        pointHitRadius: 20, 
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, 
      maintainAspectRatio: false,
      scales: { 
        r: { 
          angleLines: { color: 'rgba(255, 255, 255, 0.1)' }, 
          grid: { color: 'rgba(255, 255, 255, 0.1)' }, 
          pointLabels: { color: '#aaaaaa', font: { size: 11 } }, 
          ticks: { display: false, min: 0, max: 100 } 
        } 
      },
      plugins: { 
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(4, 26, 51, 0.9)',
          displayColors: false,
          bodyFont: { size: 14, weight: 'bold' },
          callbacks: {
            title: function() { return null; }, 
            label: function(context) {
              return `${context.chart.data.labels[context.dataIndex]}: ${context.dataset.rawValues[context.dataIndex]}`;
            }
          }
        }
      }
    }
  });
}

// --- FRIENDS ENGINE ---
const searchInput = document.getElementById('friend-search-input');
const searchBtn = document.getElementById('friend-search-btn');
const searchResults = document.getElementById('search-results');
const friendsListContainer = document.getElementById('friends-list');

searchBtn.addEventListener('click', async () => {
  const searchTerm = searchInput.value.trim().toLowerCase();
  if (!searchTerm) return;
  
  searchResults.innerHTML = '<p style="color: var(--text-muted);">Searching...</p>';

  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", searchTerm));
    const querySnapshot = await getDocs(q);
    
    searchResults.innerHTML = '';
    
    if (querySnapshot.empty) {
      searchResults.innerHTML = '<p style="color: var(--text-muted);">No bowler found with that email.</p>';
      return;
    }

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const uid = docSnap.id;
      
      if (uid === currentUser.uid) {
        searchResults.innerHTML = '<p style="color: var(--text-muted);">That is your email!</p>';
        return;
      }

      const isAlreadyFriend = currentUserFriends.includes(uid);
      const photoSrc = data.customPhoto || data.defaultPhoto || '';

      searchResults.innerHTML += `
        <div class="friend-card" onclick="viewFriendProfile('${uid}')">
          <div class="friend-info">
            <img src="${photoSrc}" alt="Avatar">
            <div class="friend-details">
              <h4>${data.name}</h4>
              <p>Avg: ${data.stats?.average || 0} | High: ${data.stats?.highGame || 0}</p>
            </div>
          </div>
          ${isAlreadyFriend 
            ? `<button disabled class="add-friend-btn" style="background:#555;" onclick="event.stopPropagation()">Added</button>`
            : `<button class="add-friend-btn" onclick="event.stopPropagation(); addFriend('${uid}')">Add</button>`
          }
        </div>
      `;
    });
  } catch (error) {
    console.error("Search Error:", error);
    searchResults.innerHTML = '<p style="color: #e53935;">Error searching for users.</p>';
  }
});

window.addFriend = async (friendUid) => {
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await setDoc(userRef, { friends: arrayUnion(friendUid) }, { merge: true });
    
    if (!currentUserFriends.includes(friendUid)) currentUserFriends.push(friendUid);
    
    searchInput.value = '';
    searchResults.innerHTML = '<p style="color: #4caf50;">Friend added successfully!</p>';
    setTimeout(() => { searchResults.innerHTML = ''; }, 2000);
    
    loadFriendsList();
  } catch (error) { console.error("Error adding friend:", error); }
};

window.removeFriend = async (friendUid) => {
  if(!confirm("Remove this friend?")) return;
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await setDoc(userRef, { friends: arrayRemove(friendUid) }, { merge: true });
    
    currentUserFriends = currentUserFriends.filter(id => id !== friendUid);
    loadFriendsList();
  } catch (error) { console.error("Error removing friend:", error); }
};

async function loadFriendsList() {
  const myDoc = await getDoc(doc(db, "users", currentUser.uid));
  if (myDoc.exists()) currentUserFriends = myDoc.data().friends || [];

  if (currentUserFriends.length === 0) {
    friendsListContainer.innerHTML = '<p style="color: var(--text-muted);">You haven\'t added any friends yet.</p>';
    return;
  }

  friendsListContainer.innerHTML = '<p style="color: var(--text-muted);">Loading leaderboard...</p>';
  let friendsData = [];

  try {
    for (const uid of currentUserFriends) {
      const friendDoc = await getDoc(doc(db, "users", uid));
      if (friendDoc.exists()) friendsData.push({ uid: uid, ...friendDoc.data() });
    }

    friendsData.sort((a, b) => (b.stats?.average || 0) - (a.stats?.average || 0));

    friendsListContainer.innerHTML = '';
    friendsData.forEach(f => {
      const photoSrc = f.customPhoto || f.defaultPhoto || '';
      friendsListContainer.innerHTML += `
        <div class="friend-card" onclick="viewFriendProfile('${f.uid}')">
          <div class="friend-info">
            <img src="${photoSrc}" alt="Avatar">
            <div class="friend-details">
              <h4>${f.name}</h4>
              <p>Avg: ${f.stats?.average || 0} | High: ${f.stats?.highGame || 0}</p>
            </div>
          </div>
          <button class="remove-friend-btn" onclick="event.stopPropagation(); removeFriend('${f.uid}')">Remove</button>
        </div>
      `;
    });
  } catch (error) {
    console.error("Error loading friends:", error);
    friendsListContainer.innerHTML = '<p style="color: #e53935;">Error loading friends list.</p>';
  }
}

// --- STATS & SCORECARD ENGINE ---
function calculateGameScore(throws) {
    let score = 0; 
    let throwIndex = 0;
    
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
    }
  }
  if (currentFrame.length > 0) frames.push(currentFrame);
  return frames;
}

function calculateNewStats(frames, currentStats, gameScore) {
  let sessionFirstThrows = 0, sessionFirstBallPins = 0, sessionOpenFrames = 0;
  let sessionStrikes = 0, sessionSpares = 0, sessionSpareOpps = 0;

  frames.forEach((frame, index) => {
    if (frame.length > 0 && index < 10) {
      sessionFirstThrows++; 
      sessionFirstBallPins += frame[0];
      
      if (frame[0] === 10) {
        sessionStrikes++;
      } else {
        sessionSpareOpps++;
        if (frame.length > 1 && frame[0] + frame[1] === 10) {
          sessionSpares++;
        } else if (frame.length > 1) {
          sessionOpenFrames++; 
        }
      }
    }
  });

  const totalGames = (currentStats.totalGames || 0) + 1;
  const totalPinfall = (currentStats.totalPinfall || 0) + gameScore;
  const totalFirstThrows = (currentStats.totalFirstThrows || 0) + sessionFirstThrows;
  const totalFirstBallPins = (currentStats.totalFirstBallPins || 0) + sessionFirstBallPins;
  const totalOpenFrames = (currentStats.totalOpenFrames || 0) + sessionOpenFrames;
  const totalStrikes = (currentStats.totalStrikes || 0) + sessionStrikes;
  const totalSpares = (currentStats.totalSpares || 0) + sessionSpares;
  const totalSpareOpps = (currentStats.totalSpareOpps || 0) + sessionSpareOpps;

  return {
    totalGames, totalPinfall, totalFirstThrows, totalFirstBallPins, totalOpenFrames, totalStrikes, totalSpares, totalSpareOpps,
    highGame: Math.max((currentStats.highGame || 0), gameScore),
    average: totalGames > 0 ? Math.floor(totalPinfall / totalGames) : 0,
    firstBallAvg: totalFirstThrows > 0 ? (totalFirstBallPins / totalFirstThrows).toFixed(2) : 0,
    openFrameRate: totalFirstThrows > 0 ? ((totalOpenFrames / totalFirstThrows) * 100).toFixed(1) : 0
  };
}

function checkIfSplit(standingPins) {
  if (standingPins.includes(1) || standingPins.length < 2) return false;
  
  const edges = { 
    2: [4, 5, 8], 3: [5, 6, 9], 4: [2, 7, 8], 5: [2, 3, 8, 9], 
    6: [3, 9, 10], 7: [4], 8: [2, 4, 5], 9: [3, 5, 6], 10: [6] 
  };
  
  let visited = new Set(); 
  let stack = [standingPins[0]]; 
  visited.add(standingPins[0]);
  
  while(stack.length > 0) {
    let current = stack.pop();
    if (edges[current]) {
      edges[current].forEach(neighbor => {
        if (standingPins.includes(neighbor) && !visited.has(neighbor)) { 
          visited.add(neighbor); 
          stack.push(neighbor); 
        }
      });
    }
  }
  return visited.size !== standingPins.length;
}

function checkAchievements(flatThrows, frames, score, splitIdxArray, currentAchievementsObj = {}) {
  let newAch = { ...currentAchievementsObj };
  const addAch = (id) => { newAch[id] = (newAch[id] || 0) + 1; };

  if (score >= 200) addAch('200 Club 🎯');
  if (score === 300) addAch('Perfect Game 👑');

  let isClean = true;
  let hasGutter = false;
  
  for (let i = 0; i < 10; i++) {
    const f = frames[i];
    if (!f || (f[0] !== 10 && (f.length < 2 || f[0] + f[1] !== 10))) isClean = false; 
  }
  if (isClean && frames.length === 10) addAch('Clean Game 🧼');

  flatThrows.forEach(t => { if (t === 0) hasGutter = true; });
  if (!hasGutter && flatThrows.length > 0) addAch('Gutter-Free 🛡️');

  let strikeStreak = 0;
  for (let t of flatThrows) {
    if (t === 10) { 
      strikeStreak++; 
      if (strikeStreak === 2) addAch('Double 🎳');
      if (strikeStreak === 3) addAch('Turkey 🦃'); 
      if (strikeStreak === 4) addAch('Hambone 🍖'); 
    } else { 
      strikeStreak = 0; 
    }
  }

  const tenth = frames[9];
  if (tenth && tenth[0] === 10 && tenth[1] === 10 && tenth[2] === 10) addAch('Clutch Finisher 🧊');

  splitIdxArray.forEach(idx => {
    if (flatThrows[idx + 1] === 10 - flatThrows[idx]) addAch('Split Converter 🎳');
  });

  return newAch;
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
        
        if (t1val === 10) { 
          t2 = 'X'; 
          throwIdx += 1; 
        } else { 
          t1 = t1val === 0 ? '-' : t1val; 
          if (splitIndices.includes(throwIdx)) t1 = `<span class="split-circle">${t1}</span>`;
          if (frameData.length > 1) t2 = (t1val + t2val === 10) ? '/' : (t2val === 0 ? '-' : t2val); 
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
        
        if (t1val !== undefined) {
          t1 = t1val === 10 ? 'X' : (t1val === 0 ? '-' : t1val);
          if (splitIndices.includes(throwIdx)) t1 = `<span class="split-circle">${t1}</span>`;
        }
        if (t2val !== undefined) {
          t2 = (t1val !== 10 && t1val + t2val === 10) ? '/' : (t2val === 10 ? 'X' : (t2val === 0 ? '-' : t2val));
          if (t2 !== '/' && splitIndices.includes(throwIdx + 1)) t2 = `<span class="split-circle">${t2}</span>`;
        }
        if (t3val !== undefined) {
          t3 = (t2val !== 10 && t2val !== '/' && t2val + t3val === 10) ? '/' : (t3val === 10 ? 'X' : (t3val === 0 ? '-' : t3val));
          if (t3 !== '/' && splitIndices.includes(throwIdx + 2)) t3 = `<span class="split-circle">${t3}</span>`;
        }

        if (flatThrowsArray.length >= throwIdx + (t1val === 10 || t1val+t2val===10 ? 3 : 2)) {
          runningScore += calculateGameScore(flatThrowsArray.slice(throwIdx)); 
          frameScoreDisplay = calculateGameScore(flatThrowsArray); 
        }
      }
    }

    container.innerHTML += `
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
  }
}

// --- PIN DECK LOGIC ---
let currentFrame = 1; 
let currentThrow = 1; 
let pinsStandingThisFrame = 10;
let flatThrowsArray = [];
let splitIndices = []; 

const pins = document.querySelectorAll('.pin');
const frameDisplay = document.getElementById('current-frame-display');
const throwDisplay = document.getElementById('current-throw-display');
const gameFeedback = document.getElementById('game-feedback');
const strikeBtn = document.getElementById('strike-btn');
const spareBtn = document.getElementById('spare-btn');

pins.forEach(pin => { 
  pin.addEventListener('click', () => { 
    if (!pin.classList.contains('locked-down')) pin.classList.toggle('down'); 
  }); 
});

function resetPins(fullReset = false) { 
  pins.forEach(pin => { 
    if (fullReset) pin.classList.remove('down', 'locked-down'); 
    else if (pin.classList.contains('down')) pin.classList.add('locked-down'); 
  }); 
}

function processThrow(pinsFallen) {
  const isFirstThrowOfRack = (pinsStandingThisFrame === 10);
  flatThrowsArray.push(pinsFallen); 
  pinsStandingThisFrame -= pinsFallen; 
  
  if (isFirstThrowOfRack && pinsFallen > 0 && pinsFallen < 10) {
    let standing = []; 
    document.querySelectorAll('.pin:not(.down)').forEach(p => standing.push(parseInt(p.dataset.pin)));
    if (checkIfSplit(standing)) splitIndices.push(flatThrowsArray.length - 1);
  }

  renderScorecard(); 

  if (currentFrame < 10) {
    if (pinsStandingThisFrame === 0 || currentThrow === 2) advanceFrame();
    else { currentThrow = 2; resetPins(false); updateUI(); }
  } else {
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
    } else {
      finishGame();
    }
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
  
  if (pinsStandingThisFrame === 10) { 
    strikeBtn.disabled = false; 
    spareBtn.disabled = true; 
  } else { 
    strikeBtn.disabled = true; 
    spareBtn.disabled = false; 
  }
}

document.getElementById('gutter-btn').addEventListener('click', () => processThrow(0));
document.getElementById('record-throw-btn').addEventListener('click', () => { processThrow(document.querySelectorAll('.pin.down:not(.locked-down)').length); });
strikeBtn.addEventListener('click', () => { document.querySelectorAll('.pin:not(.down)').forEach(p => p.classList.add('down')); processThrow(pinsStandingThisFrame); });
spareBtn.addEventListener('click', () => { document.querySelectorAll('.pin:not(.down)').forEach(p => p.classList.add('down')); processThrow(pinsStandingThisFrame); });

async function finishGame() {
  document.getElementById('record-throw-btn').disabled = true; 
  document.getElementById('gutter-btn').disabled = true; 
  strikeBtn.disabled = true; 
  spareBtn.disabled = true;
  gameFeedback.innerText = "Saving game...";

  const score = calculateGameScore(flatThrowsArray);
  const frames = groupThrowsIntoFrames(flatThrowsArray);

  try {
    await addDoc(collection(db, "games"), { 
      userId: currentUser.uid, 
      date: Timestamp.now(), 
      throws: flatThrowsArray, 
      splits: splitIndices, 
      score: score 
    });
    
    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    let userData = userSnap.exists() ? userSnap.data() : {};
    
    if (Array.isArray(userData.achievements)) { 
      const migrated = {}; 
      userData.achievements.forEach(ach => migrated[ach] = 1); 
      userData.achievements = migrated; 
    }

    const newStats = calculateNewStats(frames, userData.stats || {}, score);
    const newAchievements = checkAchievements(flatThrowsArray, frames, score, splitIndices, userData.achievements || {});

    await setDoc(userRef, { stats: newStats, achievements: newAchievements }, { merge: true });
    
    gameFeedback.innerText = `Game Saved! Score: ${score}`;
    loadProfile(currentUser.uid); 
  } catch (err) { 
    console.error("Save Error:", err); 
    gameFeedback.innerText = "Error saving game."; 
  }

  setTimeout(() => {
    flatThrowsArray = []; 
    splitIndices = []; 
    currentFrame = 1; 
    currentThrow = 1; 
    pinsStandingThisFrame = 10;
    resetPins(true); 
    updateUI(); 
    renderScorecard();
    
    document.getElementById('record-throw-btn').disabled = false; 
    document.getElementById('gutter-btn').disabled = false;
    gameFeedback.innerText = ""; 
    switchTab('profile'); 
  }, 3500);
}