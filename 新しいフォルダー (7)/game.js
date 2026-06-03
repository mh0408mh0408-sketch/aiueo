try {
// Safe localStorage wrapper for local file:// loading
const safeLocalStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      if (!window.memoryLocalStorage) window.memoryLocalStorage = {};
      return window.memoryLocalStorage[key] || null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (!window.memoryLocalStorage) window.memoryLocalStorage = {};
      window.memoryLocalStorage[key] = value;
    }
  }
};

// Access database adapter defined in firebase-db.js
const {
  createRoom,
  joinRoom,
  subscribeToRoom,
  updateTheme,
  startSetup,
  submitWord,
  attackLetter,
  sendChatMessage,
  resetToLobby,
  rematchGame,
  getOrCreatePlayerId
} = window.dbAdapter;

// Sound effects control
let soundEnabled = true;
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const now = ctx.currentTime;
    
    if (type === "click") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.1);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === "hit") {
      // Satisfying hit sound (two pitch-increasing beeps)
      osc.type = "triangle";
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.00, now + 0.08); // A5
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === "miss") {
      // Disappointing miss sound (descending buzz)
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.linearRampToValueAtTime(110, now + 0.2); // A2
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === "join") {
      // Arpeggio
      osc.type = "sine";
      const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
      notes.forEach((f, i) => {
        osc.frequency.setValueAtTime(f, now + i * 0.06);
      });
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === "start") {
      // Upbeat fanfare
      osc.type = "square";
      const notes = [349.23, 440.00, 523.25, 698.46]; // F4, A4, C5, F5
      notes.forEach((f, i) => {
        osc.frequency.setValueAtTime(f, now + i * 0.08);
      });
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.55);
    } else if (type === "turn") {
      // Turn indicator (bubbly bell sound)
      osc.type = "sine";
      osc.frequency.setValueAtTime(987.77, now); // B5
      osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.12); // E6
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === "defeat") {
      // Downbeat fail chime
      osc.type = "sine";
      osc.frequency.setValueAtTime(293.66, now); // D4
      osc.frequency.setValueAtTime(277.18, now + 0.15); // C#4
      osc.frequency.setValueAtTime(261.63, now + 0.3); // C4
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.55);
    } else if (type === "winner") {
      // Happy victory fanfare
      osc.type = "square";
      const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; // C5, E5, G5, C6, E6, G6
      notes.forEach((f, i) => {
        osc.frequency.setValueAtTime(f, now + i * 0.08);
      });
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc.start(now);
      osc.stop(now + 0.7);
    }
  } catch (err) {
    console.warn("Audio Context setup failed/blocked by browser.", err);
  }
}

// Japanese Character mappings for normalizations
const KANA_MAP = {
  "ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お",
  "ゃ": "や", "ゅ": "ゆ", "ょ": "よ", "っ": "つ", "ゎ": "わ",
  "が": "か", "ぎ": "き", "ぐ": "く", "げ": "け", "ご": "こ",
  "ざ": "さ", "じ": "し", "ず": "す", "ぜ": "せ", "ぞ": "そ",
  "だ": "た", "ぢ": "ち", "づ": "つ", "で": "て", "ど": "と",
  "ば": "は", "び": "ひ", "ぶ": "ふ", "べ": "へ", "ぼ": "ほ",
  "ぱ": "は", "ぴ": "ひ", "ぷ": "ふ", "ぺ": "へ", "ぽ": "ほ",
  "ゔ": "う",
  // Katakana equivalents (in case first step missed any mapping details)
  "ァ": "あ", "ィ": "い", "ゥ": "う", "ェ": "え", "ォ": "お",
  "ャ": "や", "ュ": "ゆ", "ョ": "よ", "ッ": "つ", "ヮ": "わ",
  "ガ": "か", "ギ": "き", "グ": "く", "ゲ": "け", "ゴ": "こ",
  "ザ": "さ", "ジ": "し", "ズ": "す", "ゼ": "せ", "ゾ": "そ",
  "ダ": "た", "ヂ": "ち", "ヅ": "つ", "デ": "て", "ド": "と",
  "バ": "は", "ビ": "ひ", "ブ": "ふ", "ベ": "へ", "ボ": "ほ",
  "パ": "は", "ピ": "ひ", "プ": "ふ", "ペ": "へ", "ポ": "ほ",
  "ヴ": "う"
};

// Katakana to Hiragana conversion
function katakanaToHiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (match) => {
    return String.fromCharCode(match.charCodeAt(0) - 0x60);
  });
}

// Full normalization function for "Aiue Battle"
function normalizeWord(word) {
  let temp = katakanaToHiragana(word);
  let result = "";
  for (let i = 0; i < temp.length; i++) {
    const char = temp[i];
    if (KANA_MAP[char]) {
      result += KANA_MAP[char];
    } else {
      result += char;
    }
  }
  // Keep only Hiragana and prolonged sound mark (ー)
  return result.split("").filter(char => {
    const code = char.charCodeAt(0);
    return (code >= 0x3041 && code <= 0x3093) || char === "ー";
  }).join("");
}

// 50-on table definition
const KANA_BOARD = [
  ["あ", "か", "さ", "た", "な", "は", "ま", "や", "ら", "わ"],
  ["い", "き", "し", "ち", "に", "ひ", "み",  "", "り", "を"],
  ["う", "く", "す", "つ", "ぬ", "ふ", "む", "ゆ", "る", "ん"],
  ["え", "け", "せ", "て", "ね", "へ", "め",  "", "れ", "ー"],
  ["お", "こ", "そ", "と", "の", "ほ", "も", "よ", "ろ",  ""]
];

// Preset Themes Suggestion list
const THEME_PRESETS = [
  // 生き物・自然
  "どうぶつ", "うみのいきもの", "すいぞくかんのいきもの", "どうぶつえんのいきもの", 
  "むし", "とり", "さかな", "はな", "き", "むかしのいきもの（きょうりゅうなど）",
  
  // 食べ物・飲み物
  "たべもの", "のみもの", "くだもの", "やさい", "おにぎりのぐ", "おかし", "パンのしゅるい", 
  "すしのねた", "めんるい", "ちょうみりょう", "ちゅうかりょうり", "あまいもの", 
  "あついべんとう・おかず", "やきにくだのぐ", "れすとらんのメニュー",
  
  // 家・身の回り・場所
  "いえにあるもの", "れいぞうこのなかみ", "おふろにあるもの", "だいどころにあるもの", 
  "こんびににあるもの", "すーぱーにあるもの", "ひゃくえんしょっぷにあるもの", 
  "がっこうにあるもの", "こうえんにあるもの", "ゆうえんちにあるもの", "いきたいばしょ",
  
  // 衣類・所持品
  "かばんのなかみ", "ふでばこのなかみ", "ぶんぼうぐ", "ようふく", "はきもの", 
  "ぼうし", "でんかせいひん", "かぐ", "おもちゃ", "がっき", "もちあるくもの",
  
  // 乗り物・スポーツ・娯楽
  "のりもの", "はやいのりもの", "そらをとぶのりもの", "すぽーつ", "げーむのなまえ", 
  "えいがのたいとる", "あにめのたいとる", "まんがのなまえ", "すきなきゃらくたー", 
  "ディズニー", "すたじおじぶり", "とくさつ・ひーろー",
  
  // 色・特徴・属性
  "あかいもの", "あおいもの", "みどりいろのもの", "きいろいもの", "しろいもの", 
  "くろいもの", "まるいもの", "しかくいもの", "かるいもの", "おもいもの", 
  "かたいもの", "やわらかいもの", "あついもの", "つめたいもの", "ひかるもの", 
  "おとがでるもの", "においがつよいもの", "とぶいきもの", "おおきいいきもの", 
  "ちいさいいきもの",
  
  // 地理・歴史・社会
  "にっぽんのどうふけん", "せかいのくに", "にっぽんのめいぶつ", "しょくぎょう", 
  "れきしのじんぶつ", "うちゅうにあるもの",
  
  // 季節・イベント
  "はるといえば", "なつといえば", "あきといえば", "ふゆといえば", 
  "クリスマス", "おしょうがつ", "ハロウィン", "おまつり",
  
  // 文字数・縛り言葉
  "４もじのことば", "３もじのどうぶつ", "５もじのたべもの", 
  "ひらがな３もじのたんご", "ひらがな４もじのたんご", "カタカナのことば", 
  "べんりなもの", "からだのぶい"
];

// Game State Tracking
let currentRoomId = null;
let myPlayerId = null;
let currentRoomState = null;
let mySecretLettersRevealed = false; // Toggle to view own secret word
let lastStatus = null;
let lastTurnPlayerId = null;

// DOM Elements
const screens = {
  welcome: document.getElementById("screen-welcome"),
  lobby: document.getElementById("screen-lobby"),
  setup: document.getElementById("screen-setup"),
  battle: document.getElementById("screen-battle"),
  gameover: document.getElementById("screen-gameover")
};

// Transition between screens
function showScreen(screenId) {
  Object.keys(screens).forEach(key => {
    if (key === screenId) {
      screens[key].classList.add("active");
    } else {
      screens[key].classList.remove("active");
    }
  });
}

// Initialize application events
document.addEventListener("DOMContentLoaded", () => {
  myPlayerId = getOrCreatePlayerId();
  
  // Try to load cached player name
  const cachedName = safeLocalStorage.getItem("aiue_player_name");
  if (cachedName) {
    document.getElementById("player-name-input").value = cachedName;
  }

  // --- WELCOME SCREEN EVENTS ---
  document.getElementById("btn-create-room").addEventListener("click", async () => {
    playSound("click");
    const name = document.getElementById("player-name-input").value.trim();
    const customCode = document.getElementById("room-id-input").value.trim();
    if (!name) {
      alert("名前を入力してください。");
      return;
    }
    safeLocalStorage.setItem("aiue_player_name", name);
    
    try {
      const result = await createRoom(name, customCode);
      currentRoomId = result.roomId;
      myPlayerId = result.playerId;
      startLobbySubscription(currentRoomId);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("btn-join-room").addEventListener("click", async () => {
    playSound("click");
    const name = document.getElementById("player-name-input").value.trim();
    const code = document.getElementById("room-id-input").value.trim();
    if (!name) {
      alert("名前を入力してください。");
      return;
    }
    if (!code) {
      alert("合言葉を入力してください。");
      return;
    }
    safeLocalStorage.setItem("aiue_player_name", name);
    
    try {
      const result = await joinRoom(code, name);
      currentRoomId = result.roomId;
      myPlayerId = result.playerId;
      startLobbySubscription(currentRoomId);
    } catch (e) {
      alert(e.message);
    }
  });

  // --- LOBBY SCREEN EVENTS ---
  document.getElementById("btn-copy-code").addEventListener("click", () => {
    playSound("click");
    navigator.clipboard.writeText(currentRoomId).then(() => {
      alert("部屋コードをコピーしました！");
    }).catch(err => {
      console.error("Copy failed", err);
    });
  });

  document.getElementById("btn-suggest-theme").addEventListener("click", () => {
    playSound("click");
    if (!currentRoomState || currentRoomState.hostId !== myPlayerId) return;
    const randomTheme = THEME_PRESETS[Math.floor(Math.random() * THEME_PRESETS.length)];
    document.getElementById("theme-input").value = randomTheme;
    updateTheme(currentRoomId, randomTheme);
  });

  document.getElementById("theme-input").addEventListener("change", (e) => {
    if (!currentRoomState || currentRoomState.hostId !== myPlayerId) return;
    updateTheme(currentRoomId, e.target.value.trim() || "どうぶつ");
  });

  document.querySelectorAll(".preset-tag").forEach(tag => {
    tag.addEventListener("click", (e) => {
      playSound("click");
      if (!currentRoomState || currentRoomState.hostId !== myPlayerId) return;
      const themeVal = e.target.textContent;
      document.getElementById("theme-input").value = themeVal;
      updateTheme(currentRoomId, themeVal);
    });
  });

  document.getElementById("btn-start-setup").addEventListener("click", () => {
    playSound("click");
    if (!currentRoomState || currentRoomState.hostId !== myPlayerId) return;
    startSetup(currentRoomId);
  });

  // Chat send buttons
  const sendChatMsg = () => {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text || !currentRoomId) return;
    const me = currentRoomState.players[myPlayerId];
    sendChatMessage(currentRoomId, me.name, text);
    input.value = "";
    playSound("click");
  };
  document.getElementById("btn-send-chat").addEventListener("click", sendChatMsg);
  document.getElementById("chat-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChatMsg();
  });

  // --- SETUP WORD SCREEN EVENTS ---
  const wordInput = document.getElementById("secret-word-input");
  wordInput.addEventListener("input", (e) => {
    const rawVal = e.target.value;
    const norm = normalizeWord(rawVal);
    
    // Update raw input value display clean (just convert katakana to hiragana so they see clean letters)
    const previewCards = document.getElementById("word-preview-cards");
    previewCards.innerHTML = "";

    const letters = norm.split("");
    // Fill up to 7 characters
    const paddedLetters = [...letters];
    while (paddedLetters.length < 7) {
      paddedLetters.push("×");
    }

    // Render blocks
    paddedLetters.forEach((char, idx) => {
      const block = document.createElement("div");
      block.className = `card-block ${char === "×" ? "cross" : "active"}`;
      block.textContent = char;
      previewCards.appendChild(block);
    });

    const len = letters.length;
    document.getElementById("word-length-info").textContent = `文字数: ${len}/7 (残り ${7 - len} 個の ×)`;

    // Enable button only if length is 2-7
    const btnSubmit = document.getElementById("btn-submit-word");
    if (len >= 2 && len <= 7) {
      btnSubmit.classList.remove("disabled");
      btnSubmit.removeAttribute("disabled");
    } else {
      btnSubmit.classList.add("disabled");
      btnSubmit.setAttribute("disabled", "true");
    }
  });

  document.getElementById("btn-submit-word").addEventListener("click", () => {
    playSound("click");
    const orig = wordInput.value.trim();
    
    // ひらがな・カタカナ・伸ばし棒のみか検証 (カタカナはひらがなに変換した上で判定)
    const converted = katakanaToHiragana(orig);
    const isValid = /^[\u3041-\u309f\u30fc]+$/.test(converted);
    if (!isValid) {
      alert("エラー: ひらがな、カタカナ、伸ばし棒（ー）以外の文字（漢字、英数字、記号、スペースなど）が含まれています。");
      return;
    }

    const norm = normalizeWord(orig);
    if (norm.length < 2 || norm.length > 7) return;

    const letters = norm.split("");
    const paddedLetters = [...letters];
    while (paddedLetters.length < 7) {
      paddedLetters.push("×");
    }

    submitWord(currentRoomId, myPlayerId, orig, paddedLetters);
    document.getElementById("btn-submit-word").classList.add("disabled");
    document.getElementById("btn-submit-word").setAttribute("disabled", "true");
    wordInput.value = "";
  });

  // --- BATTLE SCREEN EVENTS ---
  const sendBattleChatMsg = () => {
    const input = document.getElementById("battle-chat-input");
    const text = input.value.trim();
    if (!text || !currentRoomId) return;
    const me = currentRoomState.players[myPlayerId];
    sendChatMessage(currentRoomId, me.name, text);
    input.value = "";
    playSound("click");
  };
  document.getElementById("btn-send-battle-chat").addEventListener("click", sendBattleChatMsg);
  document.getElementById("battle-chat-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendBattleChatMsg();
  });

  // --- GAMEOVER SCREEN EVENTS ---
  document.getElementById("btn-rematch").addEventListener("click", () => {
    playSound("click");
    if (!currentRoomState || currentRoomState.hostId !== myPlayerId) return;
    rematchGame(currentRoomId);
  });

  document.getElementById("btn-return-lobby").addEventListener("click", () => {
    playSound("click");
    if (!currentRoomState || currentRoomState.hostId !== myPlayerId) return;
    resetToLobby(currentRoomId);
  });

  // --- SOUND TOGGLE FLOATING BTN ---
  document.getElementById("btn-toggle-sound").addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    const icon = document.getElementById("sound-icon");
    if (soundEnabled) {
      icon.className = "fa-solid fa-volume-high";
      playSound("click");
    } else {
      icon.className = "fa-solid fa-volume-xmark";
    }
  });
});

// Initialize Subscription to Room in Firebase RTDB
let unsubscribe = null;
function startLobbySubscription(roomId) {
  if (unsubscribe) unsubscribe();

  unsubscribe = subscribeToRoom(roomId, (roomData) => {
    if (!roomData) {
      alert("部屋が存在しないか、削除されました。");
      showScreen("welcome");
      if (unsubscribe) unsubscribe();
      return;
    }
    
    currentRoomState = roomData;
    updateGameUI();
  });
}

// Main rendering loops based on status
function updateGameUI() {
  if (!currentRoomState) return;

  const status = currentRoomState.status;
  const isHost = currentRoomState.hostId === myPlayerId;

  // Sound triggering on room state transitions
  if (status !== lastStatus) {
    if (status === "SETUP") {
      playSound("start");
    } else if (status === "BATTLE") {
      playSound("start");
    } else if (status === "GAMEOVER") {
      const activePlayers = Object.values(currentRoomState.players).filter(p => !p.isDefeated);
      const wonMe = activePlayers.some(p => p.id === myPlayerId);
      if (wonMe) {
        playSound("winner");
      } else {
        playSound("defeat");
      }
    }
    lastStatus = status;
  }

  // Route screen based on room state
  if (status === "LOBBY") {
    renderLobbyScreen(isHost);
    showScreen("lobby");
  } else if (status === "SETUP") {
    renderSetupScreen();
    showScreen("setup");
  } else if (status === "BATTLE") {
    renderBattleScreen();
    showScreen("battle");
  } else if (status === "GAMEOVER") {
    renderGameOverScreen(isHost);
    showScreen("gameover");
  }
}

// 1. Render Lobby
function renderLobbyScreen(isHost) {
  document.getElementById("room-code-display").textContent = currentRoomState.roomId;
  
  // Theme input (enable only for host)
  const themeInput = document.getElementById("theme-input");
  const diceBtn = document.getElementById("btn-suggest-theme");
  themeInput.value = currentRoomState.theme || "";
  
  if (isHost) {
    themeInput.removeAttribute("disabled");
    diceBtn.classList.remove("disabled");
    diceBtn.removeAttribute("disabled");
  } else {
    themeInput.setAttribute("disabled", "true");
    diceBtn.classList.add("disabled");
    diceBtn.setAttribute("disabled", "true");
  }

  // Player count & list
  const players = currentRoomState.players || {};
  const playerCount = Object.keys(players).length;
  document.getElementById("player-count").textContent = playerCount;

  const grid = document.getElementById("lobby-players-grid");
  grid.innerHTML = "";

  Object.values(players).forEach(p => {
    const card = document.createElement("div");
    card.className = `player-card ${p.id === myPlayerId ? "is-me" : ""} ${p.isHost ? "is-host" : ""}`;
    
    // First letter for avatar
    const firstChar = p.name ? p.name.charAt(0) : "?";
    
    card.innerHTML = `
      <div class="player-avatar">${firstChar}</div>
      <div class="player-info">
        <span class="player-name">${p.name}</span>
        <span class="player-status">${p.isHost ? "ホスト" : "参加者"}</span>
      </div>
    `;
    grid.appendChild(card);
  });

  // Start setup button (enable only for host, and if players >= 2)
  const btnStart = document.getElementById("btn-start-setup");
  const warnText = document.getElementById("start-warning");
  
  if (isHost) {
    warnText.style.display = playerCount >= 2 ? "none" : "block";
    if (playerCount >= 2) {
      btnStart.classList.remove("disabled");
      btnStart.removeAttribute("disabled");
    } else {
      btnStart.classList.add("disabled");
      btnStart.setAttribute("disabled", "true");
    }
  } else {
    btnStart.classList.add("disabled");
    btnStart.setAttribute("disabled", "true");
    btnStart.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ホストの開始待ち...`;
    warnText.style.display = "none";
  }

  // Chat messages
  renderChat(currentRoomState.chat, "chat-messages");
}

// Helper to render chat messages
function renderChat(chatObj, targetId) {
  const container = document.getElementById(targetId);
  if (!container) return;

  const atBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 40;

  container.innerHTML = "";
  if (!chatObj) return;

  // Convert map to array and sort by time
  const msgs = Object.values(chatObj).sort((a, b) => a.time - b.time);

  msgs.forEach(m => {
    const wrapper = document.createElement("div");
    if (m.sender === "システム") {
      wrapper.className = "chat-msg system";
      wrapper.innerHTML = `<div class="text">${m.text}</div>`;
    } else {
      const isMe = m.sender === currentRoomState.players[myPlayerId]?.name;
      wrapper.className = `chat-msg ${isMe ? "me" : ""}`;
      wrapper.innerHTML = `
        <span class="sender">${m.sender}</span>
        <div class="text">${m.text}</div>
      `;
    }
    container.appendChild(wrapper);
  });

  // Smooth scroll to bottom if client was already near bottom
  if (atBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

// 2. Render Setup
function renderSetupScreen() {
  document.getElementById("setup-theme-display").textContent = currentRoomState.theme;

  const p = currentRoomState.players[myPlayerId];
  const btnSubmit = document.getElementById("btn-submit-word");
  const wordInput = document.getElementById("secret-word-input");

  if (p.status === "ready") {
    wordInput.setAttribute("disabled", "true");
    btnSubmit.classList.add("disabled");
    btnSubmit.setAttribute("disabled", "true");
    btnSubmit.innerHTML = `<i class="fa-solid fa-circle-check"></i> 決定済み`;
  } else {
    wordInput.removeAttribute("disabled");
    // Ensure input matches input field state (avoid overriding typing)
    if (!wordInput.value) {
      // Clear preview
      const previewCards = document.getElementById("word-preview-cards");
      previewCards.innerHTML = "";
      for (let i = 0; i < 7; i++) {
        const block = document.createElement("div");
        block.className = "card-block cross";
        block.textContent = "×";
        previewCards.appendChild(block);
      }
      document.getElementById("word-length-info").textContent = "文字数: 0/7 (残り 7 個の ×)";
    }
    btnSubmit.innerHTML = `<i class="fa-solid fa-check"></i> この言葉で決定する`;
  }

  // Render players and their ready status
  const statusContainer = document.getElementById("setup-players-status");
  statusContainer.innerHTML = "";

  Object.values(currentRoomState.players).forEach(player => {
    const badge = document.createElement("span");
    const isReady = player.status === "ready";
    badge.className = `status-badge ${isReady ? "ready" : ""}`;
    badge.innerHTML = `
      <i class="fa-solid ${isReady ? "fa-circle-check" : "fa-clock"}"></i> 
      ${player.name} (${isReady ? "OK" : "入力中..."})
    `;
    statusContainer.appendChild(badge);
  });
}

// 3. Render Battle Area
function renderBattleScreen() {
  document.getElementById("battle-theme-display").textContent = currentRoomState.theme;
  document.getElementById("battle-combo-display").textContent = currentRoomState.combos || 0;

  const turnPlayerId = currentRoomState.turnPlayerId;
  const isMyTurn = turnPlayerId === myPlayerId;
  const activeTurnName = currentRoomState.players[turnPlayerId]?.name || "誰か";

  // Trigger turn sound on turn transition
  if (turnPlayerId !== lastTurnPlayerId) {
    if (isMyTurn) {
      playSound("turn");
    }
    lastTurnPlayerId = turnPlayerId;
  }

  // Turn Text indicator
  const turnIndicator = document.getElementById("battle-turn-indicator");
  if (isMyTurn) {
    turnIndicator.className = "turn-announcement info-item flex-grow text-center your-turn";
    turnIndicator.innerHTML = `
      <span class="label">ステータス</span>
      <span class="val"><i class="fa-solid fa-triangle-exclamation"></i> あなたのターンです！</span>
    `;
    document.getElementById("keyboard-action-desc").textContent = "文字を選んで他のプレイヤーを攻撃してください！";
  } else {
    turnIndicator.className = "turn-announcement info-item flex-grow text-center";
    turnIndicator.innerHTML = `
      <span class="label">ステータス</span>
      <span class="val">${activeTurnName} さんのターン</span>
    `;
    document.getElementById("keyboard-action-desc").textContent = `${activeTurnName}さんが考え中...`;
  }

  // Render Player Cards
  const grid = document.getElementById("battle-players-grid");
  grid.innerHTML = "";

  Object.values(currentRoomState.players).forEach(p => {
    const card = document.createElement("div");
    const isCurrentTurn = p.id === turnPlayerId;
    card.className = `battle-player-card glass-panel ${isCurrentTurn ? "active-turn" : ""} ${p.isDefeated ? "defeated" : ""}`;

    // Header info (e.g. Alive/Defeated/Letters remaining)
    const hitLettersCount = p.revealed.filter((val, i) => val === true && p.letters[i] !== "×").length;
    const totalLettersCount = p.letters.filter(char => char !== "×").length;
    
    // Determine title text
    let titleHtml = `<span class="player-avatar-sm">${p.name.charAt(0)}</span> ${p.name}`;
    if (p.id === myPlayerId) {
      titleHtml += ` <span class="badge-me">(あなた)</span>`;
    }

    let subHtml = `ライフ: ${totalLettersCount - hitLettersCount} / ${totalLettersCount}`;

    let blocksHtml = "";
    p.letters.forEach((char, idx) => {
      const isRev = p.revealed[idx];
      const isCross = char === "×";

      if (p.id === myPlayerId) {
        // 自分のカード
        if (isCross) {
          blocksHtml += `<div class="battle-block empty-slot">×</div>`;
        } else if (isRev) {
          blocksHtml += `<div class="battle-block own-word revealed">${char}</div>`;
        } else {
          if (mySecretLettersRevealed) {
            blocksHtml += `<div class="battle-block own-word hidden-char">?</div>`;
          } else {
            blocksHtml += `<div class="battle-block own-word">${char}</div>`;
          }
        }
      } else {
        // 他のプレイヤーのカード
        if (p.isDefeated) {
          // 脱落している場合はすべて公開
          if (isCross) {
            blocksHtml += `<div class="battle-block empty-slot">×</div>`;
          } else {
            blocksHtml += `<div class="battle-block revealed">${char}</div>`;
          }
        } else {
          // 生存している場合、「×」は隠して「？」に見せる（文字数がバレないようにする）
          if (isCross) {
            blocksHtml += `<div class="battle-block hidden-char">?</div>`;
          } else if (isRev) {
            blocksHtml += `<div class="battle-block revealed">${char}</div>`;
          } else {
            blocksHtml += `<div class="battle-block hidden-char">?</div>`;
          }
        }
      }
    });

    let toggleBtnHtml = "";
    if (p.id === myPlayerId) {
      toggleBtnHtml = `
        <div class="card-control">
          <button class="btn-link" id="btn-toggle-secret-visibility">
            ${mySecretLettersRevealed ? "言葉を表示する" : "言葉を隠す"}
          </button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-header-info">
        <h4 class="card-title">${titleHtml}</h4>
        <span class="card-sub">${subHtml}</span>
      </div>
      <div class="battle-blocks">
        ${blocksHtml}
      </div>
      ${toggleBtnHtml}
    `;

    grid.appendChild(card);

    // Bind visibility toggle event immediately
    if (p.id === myPlayerId) {
      const btnToggle = card.querySelector("#btn-toggle-secret-visibility");
      if (btnToggle) {
        btnToggle.addEventListener("click", () => {
          mySecretLettersRevealed = !mySecretLettersRevealed;
          renderBattleScreen();
        });
      }
    }
  });

  // Render Keyboard
  renderKeyboard(isMyTurn);

  // Render Battle logs (system logs filter) & Chat
  renderBattleHistory();
  renderChat(currentRoomState.chat, "battle-chat-messages");
}

// Render Keyboard grid
function renderKeyboard(isMyTurn) {
  const keyboard = document.getElementById("kana-keyboard");
  keyboard.innerHTML = "";

  const guessedList = currentRoomState.guessedLetters ? currentRoomState.guessedLetters.split(",") : [];

  // Flatten the board and count hit/misses to show
  // We need to know which guessed letters are hits or misses.
  // Hit means it is in at least one other player's letters.
  const hits = new Set();
  const misses = new Set();

  guessedList.forEach(letter => {
    let wasHit = false;
    Object.values(currentRoomState.players).forEach(p => {
      if (p.id === currentRoomState.turnPlayerId) return; // Ignore turn player (attacker doesn't hit themselves)
      // Check if letter exists in player letters
      if (p.letters && p.letters.includes(letter)) {
        wasHit = true;
      }
    });
    if (wasHit) {
      hits.add(letter);
    } else {
      misses.add(letter);
    }
  });

  KANA_BOARD.forEach(row => {
    row.forEach(char => {
      if (char === "") {
        const placeholder = document.createElement("div");
        placeholder.className = "key-placeholder";
        keyboard.appendChild(placeholder);
      } else {
        const key = document.createElement("button");
        key.className = "key-btn";
        key.textContent = char;

        // Is guessed already?
        const isGuessed = guessedList.includes(char);

        if (isGuessed) {
          // Double check if hit or miss (we search if it matches any letters in active opponents)
          // To cover edge cases, we recalculate live
          let isHit = false;
          Object.values(currentRoomState.players).forEach(opponent => {
            // Find if opponent has this character in their original set
            if (opponent.letters && opponent.letters.includes(char)) {
              isHit = true;
            }
          });

          if (isHit) {
            key.classList.add("hit");
          } else {
            key.classList.add("miss");
          }
          key.setAttribute("disabled", "true");
        } else {
          // Interactive only if my turn
          if (isMyTurn) {
            key.addEventListener("click", () => handleAttack(char));
          } else {
            key.setAttribute("disabled", "true");
          }
        }
        keyboard.appendChild(key);
      }
    });
  });
}

// Action: Handle Attack selection
async function handleAttack(letter) {
  if (!currentRoomId || !myPlayerId || !currentRoomState) return;

  // すでに選ばれている文字の場合は処理を行わない
  const guessedList = currentRoomState.guessedLetters ? currentRoomState.guessedLetters.split(",") : [];
  if (guessedList.includes(letter)) return;

  playSound("click");
  
  // Disable all keys immediately to prevent double submits during sync lag
  document.querySelectorAll(".key-btn").forEach(btn => btn.setAttribute("disabled", "true"));

  try {
    const result = await attackLetter(currentRoomId, letter, myPlayerId);
    if (result === "hit") {
      playSound("hit");
    } else if (result === "miss") {
      playSound("miss");
    }
  } catch (err) {
    console.error("Attack failed", err);
  }
}

// Sync logs into the Battle log sidebar (system only)
function renderBattleHistory() {
  const container = document.getElementById("battle-logs-container");
  if (!container || !currentRoomState.chat) return;

  const atBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 40;
  container.innerHTML = "";

  // Filter only system logs
  const logs = Object.values(currentRoomState.chat)
    .filter(m => m.sender === "システム")
    .sort((a, b) => a.time - b.time);

  logs.forEach(l => {
    const item = document.createElement("div");
    item.className = "log-item";
    item.textContent = l.text;

    // Apply color styling matching contents
    if (l.text.includes("ヒット")) {
      item.classList.add("hit");
    } else if (l.text.includes("ミス")) {
      item.classList.add("miss");
    } else if (l.text.includes("脱落")) {
      item.classList.add("eliminated");
    }
    
    container.appendChild(item);
  });

  if (atBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

// 4. Render Game Over Screen
function renderGameOverScreen(isHost) {
  const winnerId = currentRoomState.winnerId;
  const winner = currentRoomState.players[winnerId];
  const winnerName = winner ? winner.name : "誰か";

  document.getElementById("winner-announcement").textContent = `${winnerName} さんの勝利！`;

  // Answer reveals list
  const list = document.getElementById("gameover-words-list");
  list.innerHTML = "";

  Object.values(currentRoomState.players).forEach(p => {
    const row = document.createElement("div");
    const isWinner = p.id === winnerId;
    row.className = `revealed-word-row ${isWinner ? "winner" : ""}`;

    // Clean padding out of original word representation
    const cleanWord = p.originalWord || "未設定";
    const lettersRep = p.letters.filter(char => char !== "×").join("");

    row.innerHTML = `
      <div class="player-info-go">
        <span class="player-avatar-sm">${p.name.charAt(0)}</span>
        <strong>${p.name}</strong> 
        ${isWinner ? `<span class="text-yellow"><i class="fa-solid fa-crown"></i> WINNER</span>` : ""}
      </div>
      <div class="word-display">
        <span class="orig">${cleanWord}</span>
        <span class="norm">(${lettersRep})</span>
      </div>
    `;
    list.appendChild(row);
  });

  // Rematch and Return buttons (enable only for host)
  const btnRematch = document.getElementById("btn-rematch");
  const btnReturn = document.getElementById("btn-return-lobby");
  const warnText = document.getElementById("return-warning");

  if (isHost) {
    btnRematch.classList.remove("disabled");
    btnRematch.removeAttribute("disabled");
    btnRematch.innerHTML = `<i class="fa-solid fa-gamepad"></i> 連戦する（同じお題で再戦）`;
    
    btnReturn.classList.remove("disabled");
    btnReturn.removeAttribute("disabled");
    btnReturn.innerHTML = `<i class="fa-solid fa-arrow-rotate-left"></i> ロビーに戻る`;
    warnText.style.display = "none";
  } else {
    btnRematch.classList.add("disabled");
    btnRematch.setAttribute("disabled", "true");
    btnRematch.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 連戦を待っています...`;
    
    btnReturn.classList.add("disabled");
    btnReturn.setAttribute("disabled", "true");
    btnReturn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ホストの操作待ち...`;
    warnText.style.display = "block";
  }
}
} catch (e) {
  alert("game.js エラー:\n" + e.message + "\n\n" + e.stack);
}
