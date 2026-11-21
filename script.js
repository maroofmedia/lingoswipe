// --- CONFIG ---
const API_URL = "https://text.pollinations.ai/";
const BATCH_SIZE = 10;       // Fetch 10 words at a time
const FETCH_THRESHOLD = 3;   // Fetch more when only 3 words are left

// --- STATE ---
let state = {
    difficulty: localStorage.getItem('sl_diff') || 'Medium',
    goal: localStorage.getItem('sl_goal'),
    history: [], 
    currentWord: null,
    wordBuffer: [], 
    isFetching: false
};

const LOADING_MSGS = [
    "Initial setup: Mining 10 fresh words...",
    "Consulting the dictionary...",
    "Refilling the library...",
    "Grabbing fresh vocab...",
    "Asking the linguists..."
];

// --- 1. SETUP & NAVIGATION ---

window.onload = () => {
    checkRoute();
    window.addEventListener('hashchange', checkRoute);
    updateDiffUI();
    setupGlobalInput();
};

function checkRoute() {
    const hash = window.location.hash;
    if (hash === '#feed' && state.goal) {
        showApp();
    } else {
        showHome();
    }
}

function showApp() {
    showScreen('app-screen');
    updateDiffUI();
    // If starting fresh (no current word and empty buffer), load initial batch
    if(!state.currentWord && state.wordBuffer.length === 0) {
        loadNextWord(); 
    }
}

function showHome() {
    showScreen('homepage-screen');
    closeModal('settings-modal');
    closeModal('saved-modal');
    if(window.location.hash === '#feed') history.replaceState(null, null, ' '); 
}

// --- 2. GLOBAL FUNCTIONS ---

window.selectGoal = (goal) => {
    // CRITICAL FIX: WIPE EVERYTHING ON CHANGE
    state.history = [];
    state.wordBuffer = [];
    state.currentWord = null;
    state.isFetching = false; // Reset fetch lock
    
    localStorage.setItem('sl_goal', goal);
    state.goal = goal;
    window.location.hash = 'feed';
};

window.goHome = () => { window.location.hash = ''; };

window.setDiff = (level) => {
    state.difficulty = level;
    localStorage.setItem('sl_diff', level);
    updateDiffUI();
    state.wordBuffer = []; // Clear buffer so next fetch respects new difficulty
};

window.openSettings = () => document.getElementById('settings-modal').classList.add('open');
window.closeModal = (id) => document.getElementById(id).classList.remove('open');
window.saveSettings = () => { };

window.openSaved = () => {
    const list = document.getElementById('saved-list');
    const saved = getSaved();
    if (saved.length === 0) {
        list.innerHTML = `<p style="text-align:center; color:#666; margin-top:50px;">Collection is empty.</p>`;
    } else {
        list.innerHTML = saved.map(w => `
            <div class="saved-item">
                <div class="saved-info"><h4>${w.word}</h4><p>${w.definition}</p></div>
                <button class="unsave-btn" onclick="removeFromList('${w.word}')"><span class="material-icons-round">delete_outline</span></button>
            </div>
        `).join('');
    }
    document.getElementById('saved-modal').classList.add('open');
};

// --- 3. UI HELPERS ---

function updateDiffUI() {
    document.querySelectorAll('.segment').forEach(b => {
        if (b.dataset.val === state.difficulty) b.classList.add('active');
        else b.classList.remove('active');
    });
    const pill = document.getElementById('goal-badge-pill');
    if (pill && state.goal) {
        pill.className = `pill-badge ${state.difficulty}`;
        pill.innerHTML = `<span class="dot-indicator"></span> ${state.goal}`;
    }
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// --- 4. BATCH DATA FETCHING (SMART) ---

async function fetchBatchLogic(retryCount = 0) {
    if (state.isFetching) return null;
    state.isFetching = true;

    // Capture the goal when we STARTED fetching
    const requestGoal = state.goal; 

    // Only update UI text if it's the very first load (user is waiting)
    if (state.wordBuffer.length === 0 && !state.currentWord) {
        const msgEl = document.getElementById('loading-text');
        if (msgEl) msgEl.innerText = "Initial Setup: Curating 10 words... (takes ~5s)";
    }

    const seed = Math.floor(Math.random() * 1000000);

    const prompt = `
        You are a Dictionary API. 
        Task: Provide a JSON Object containing an array of ${BATCH_SIZE} unique English words related to category "${state.goal}" (Difficulty: ${state.difficulty}).
        Constraint: Return ONLY valid JSON.
        Random Seed: ${seed}.
        Format:
        {
            "items": [
                {
                    "word": "Word",
                    "type": "noun/verb",
                    "pronunciation": "/phonetic/",
                    "definition": "Short definition",
                    "example": "Short sentence"
                }
            ]
        }
    `;

    try {
        const url = API_URL + encodeURIComponent(prompt) + "?t=" + Date.now();
        const response = await fetch(url, { cache: "no-store" });
        
        if (!response.ok) throw new Error(`Server Error: ${response.status}`);
        
        let text = await response.text();
        
        // Clean up JSON
        const firstChar = text.indexOf('{');
        const lastChar = text.lastIndexOf('}');
        if (firstChar !== -1 && lastChar !== -1) {
            text = text.substring(firstChar, lastChar + 1);
        }
        
        const data = JSON.parse(text);
        state.isFetching = false;
        
        // CRITICAL FIX: CROSS-CONTAMINATION CHECK
        // If the user changed the goal while we were fetching, DISCARD this batch.
        if (requestGoal !== state.goal) {
            console.log("Goal changed during fetch. Discarding old batch.");
            return null;
        }

        if (data.items && Array.isArray(data.items)) {
            return data.items;
        } else {
            throw new Error("Invalid format received");
        }

    } catch (e) {
        console.warn(`Batch failed:`, e.message);
        
        if (retryCount < 2) {
            if (state.wordBuffer.length === 0) {
                const msgEl = document.getElementById('loading-text');
                if (msgEl) msgEl.innerText = "Traffic high... retrying batch...";
            }
            await new Promise(r => setTimeout(r, 2000));
            state.isFetching = false; 
            return fetchBatchLogic(retryCount + 1); 
        }

        state.isFetching = false;
        return null; 
    }
}

window.loadNextWord = async () => {
    const stack = document.getElementById('card-stack');

    // 1. USE BUFFER IF AVAILABLE
    if (state.wordBuffer.length > 0) {
        if (state.currentWord) state.history.push(state.currentWord);
        
        const nextData = state.wordBuffer.shift(); 
        state.currentWord = nextData;
        renderCard(state.currentWord, 'next');

        // BACKGROUND FETCH TRIGGER
        // If we drop below threshold (e.g., 3 words left), fetch next 10
        if (state.wordBuffer.length <= FETCH_THRESHOLD && !state.isFetching) {
            console.log("Buffer low. Background fetching next batch...");
            fetchBatchLogic().then(newItems => {
                if(newItems) state.wordBuffer.push(...newItems);
            });
        }
        return;
    }

    // 2. BUFFER EMPTY? (First Load)
    stack.innerHTML = `<div class="card" id="loading-card"><div class="loader-spinner"></div><p id="loading-text" style="color:#666">Starting engine...</p></div>`;

    const newBatch = await fetchBatchLogic();
    
    if (newBatch && newBatch.length > 0) {
        const firstWord = newBatch.shift(); // Take 1
        state.wordBuffer = newBatch;        // Store 9
        
        if (state.currentWord) state.history.push(state.currentWord);
        state.currentWord = firstWord;
        renderCard(firstWord, 'next');
    } else {
        // Error only if we have NO data to show
        const tmpl = document.getElementById('error-template');
        if(tmpl) {
            stack.innerHTML = '';
            stack.appendChild(tmpl.content.cloneNode(true));
        } else {
            stack.innerHTML = `<div class="card"><div class="card-content"><p>Connection Failed. Try again.</p><button class="btn btn-primary" onclick="loadNextWord()">Retry</button></div></div>`;
        }
    }
};

window.loadPreviousWord = () => {
    if (state.history.length === 0) return false;
    
    if (state.currentWord) {
        // Put current word back to start of buffer
        state.wordBuffer.unshift(state.currentWord);
    }

    const prev = state.history.pop();
    state.currentWord = prev;
    renderCard(prev, 'prev');
    return true;
};

// --- 5. RENDER & INTERACTION ---

function renderCard(data, direction) {
    const stack = document.getElementById('card-stack');
    const isAlreadySaved = checkSaved(data.word);
    const startY = direction === 'next' ? '120vh' : '-120vh';

    const html = `
    <div class="card" id="active-card" style="transform: translateY(${startY}); opacity: 1;">
        <div class="card-content">
            <div class="top-meta">
                <span class="word-type">${data.type}</span>
                <button class="tts-btn-hero" onclick="speakWord()"><span class="material-icons-round">volume_up</span></button>
            </div>
            <h1 class="word-hero">${data.word}</h1>
            <div class="pronounce-row">${data.pronunciation}</div>
            <div class="def-block"><p class="def-text">${data.definition}</p></div>
            <div class="example-block"><p class="ex-text">"${data.example}"</p></div>
        </div>
        <div class="card-footer">
            <div class="input-area">
                <input type="text" id="user-sentence" placeholder="Use '${data.word}' in a sentence...">
                <div id="feedback-msg" class="feedback-box"></div>
            </div>
            <div class="btn-row">
                <button class="btn btn-primary" id="check-btn" onclick="checkSentence()">Check</button>
                <button class="btn btn-icon ${isAlreadySaved ? 'saved' : ''}" id="save-btn" onclick="toggleSave()">
                    <span class="material-icons-round">${isAlreadySaved ? 'bookmark' : 'bookmark_border'}</span>
                </button>
            </div>
        </div>
    </div>`;

    stack.innerHTML = html;
    updateDiffUI();

    const c = document.getElementById('active-card');
    void c.offsetWidth;
    c.style.transform = 'translateY(0)';
    makeSwipeable(c);
}

function setupGlobalInput() {
    window.addEventListener('keydown', (e) => {
        if (document.getElementById('app-screen').classList.contains('active')) {
            if (e.key === 'ArrowUp') window.loadNextWord();
            if (e.key === 'ArrowDown') window.loadPreviousWord();
        }
    });

    let wheelTimeout;
    window.addEventListener('wheel', (e) => {
        if (!document.getElementById('app-screen').classList.contains('active')) return;
        clearTimeout(wheelTimeout);
        wheelTimeout = setTimeout(() => {
            if (e.deltaY > 50) window.loadNextWord();
            if (e.deltaY < -50) window.loadPreviousWord();
        }, 50);
    });
}

window.checkSentence = async () => {
    const input = document.getElementById('user-sentence').value;
    const btn = document.getElementById('check-btn');
    const box = document.getElementById('feedback-msg');

    if (input.length < 3) return;
    btn.innerText = "...";
    btn.disabled = true;

    try {
        const prompt = `Word: "${state.currentWord.word}", Sentence: "${input}". Validate in JSON: {"correct": boolean, "message": "Short feedback"}. No Markdown.`;
        const url = API_URL + encodeURIComponent(prompt);
        const response = await fetch(url);
        let text = await response.text();
        
        const firstChar = text.indexOf('{');
        const lastChar = text.lastIndexOf('}');
        if (firstChar !== -1 && lastChar !== -1) text = text.substring(firstChar, lastChar + 1);

        const data = JSON.parse(text);

        box.style.display = "block";
        box.innerText = data.message;
        box.className = data.correct ? "feedback-box" : "feedback-box wrong";
        if (data.correct) {
            confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
            btn.innerText = "Nice!";
        } else {
            btn.innerText = "Check";
            btn.disabled = false;
        }
        setTimeout(() => { box.style.display = 'none'; }, 3500);
    } catch (e) {
        box.style.display = "block";
        box.innerText = "Error checking. Try again.";
        box.className = "feedback-box wrong";
        btn.innerText = "Check";
        btn.disabled = false;
        setTimeout(() => { box.style.display = 'none'; }, 3000);
    }
};

window.speakWord = () => {
    const u = new SpeechSynthesisUtterance(state.currentWord.word);
    u.rate = 0.9;
    speechSynthesis.speak(u);
};

// --- 6. DATA & GESTURES ---

function getSaved() { return JSON.parse(localStorage.getItem('sl_saved') || '[]'); }
function checkSaved(word) { return getSaved().some(w => w.word === word); }

window.toggleSave = () => {
    if (!state.currentWord) return;
    let list = getSaved();
    const idx = list.findIndex(w => w.word === state.currentWord.word);
    const btn = document.getElementById('save-btn');
    if (idx >= 0) {
        list.splice(idx, 1);
        btn.classList.remove('saved');
        btn.innerHTML = `<span class="material-icons-round">bookmark_border</span>`;
    } else {
        list.unshift(state.currentWord);
        btn.classList.add('saved');
        btn.innerHTML = `<span class="material-icons-round">bookmark</span>`;
        confetti({ particleCount: 20, spread: 30, origin: { x: 0.85, y: 0.9 } });
    }
    localStorage.setItem('sl_saved', JSON.stringify(list));
};

window.removeFromList = (word) => {
    let list = getSaved();
    list = list.filter(w => w.word !== word);
    localStorage.setItem('sl_saved', JSON.stringify(list));
    window.openSaved();
};

function makeSwipeable(card) {
    let startY = 0;
    card.addEventListener('touchstart', e => { startY = e.touches[0].clientY; card.style.transition = 'none'; });
    card.addEventListener('touchmove', e => handleMove(e.touches[0].clientY - startY, card));
    card.addEventListener('touchend', e => handleEnd(e.changedTouches[0].clientY - startY, card));
    let isMouseDown = false;
    card.addEventListener('mousedown', e => { isMouseDown = true; startY = e.clientY; card.style.transition = 'none'; });
    window.addEventListener('mousemove', e => { if (!isMouseDown) return; handleMove(e.clientY - startY, card); });
    window.addEventListener('mouseup', e => { if (!isMouseDown) return; isMouseDown = false; handleEnd(e.clientY - startY, card); });
}

function handleMove(diff, card) {
    card.style.transform = `translateY(${diff}px) scale(${1 - Math.abs(diff) / 5000})`;
}

function handleEnd(diff, card) {
    card.style.transition = 'transform 0.3s ease';
    if (diff < -100) {
        card.style.transform = `translateY(-120vh)`;
        setTimeout(() => window.loadNextWord(), 250);
    } else if (diff > 100) {
        if (state.history.length > 0) {
            card.style.transform = `translateY(120vh)`;
            setTimeout(() => window.loadPreviousWord(), 250);
        } else {
            card.style.transform = `translateY(0)`;
        }
    } else {
        card.style.transform = `translateY(0)`;
    }
}