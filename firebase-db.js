// Firebase Realtime Database Client (Compat Mode for file:// double-click support)

try {
// Initialize Firebase using global firebase object loaded from script tags
const app = firebase.initializeApp(window.firebaseConfig);
const db = firebase.database();

// Connection state listener
const connectedRef = db.ref(".info/connected");
connectedRef.on("value", (snap) => {
  const statusIndicator = document.getElementById("connection-status");
  if (snap.val() === true) {
    statusIndicator.className = "status-indicator online";
    statusIndicator.querySelector(".status-text").textContent = "接続中";
  } else {
    statusIndicator.className = "status-indicator offline";
    statusIndicator.querySelector(".status-text").textContent = "切断されました";
  }
});

// Helper: Generate random 4-letter room code
function generateRoomCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Safe sessionStorage wrapper for local file:// loading
const safeSessionStorage = {
  getItem(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      if (!window.memorySessionStorage) window.memorySessionStorage = {};
      return window.memorySessionStorage[key] || null;
    }
  },
  setItem(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      if (!window.memorySessionStorage) window.memorySessionStorage = {};
      window.memorySessionStorage[key] = value;
    }
  }
};

// Generate a persistent or temporary player ID
function getOrCreatePlayerId() {
  let playerId = safeSessionStorage.getItem("aiue_player_id");
  if (!playerId) {
    playerId = "p_" + Math.random().toString(36).substring(2, 11);
    safeSessionStorage.setItem("aiue_player_id", playerId);
  }
  return playerId;
}

// Export database operations globally via window object
window.dbAdapter = {
  getOrCreatePlayerId: getOrCreatePlayerId,

  // 1. Create Room
  createRoom: async function(hostName, customRoomId) {
    const playerId = getOrCreatePlayerId();
    let roomId = customRoomId ? customRoomId.trim().toUpperCase() : "";

    if (roomId) {
      // Validate custom passcode
      const roomRef = db.ref(`rooms/${roomId}`);
      const snapshot = await roomRef.get();
      if (snapshot.exists()) {
        throw new Error("この合言葉はすでに他の部屋で使用されています。別の合言葉を入力してください。");
      }
    } else {
      // Verify room uniqueness for auto generated 4-letter code
      let unique = false;
      while (!unique) {
        roomId = generateRoomCode();
        const roomRef = db.ref(`rooms/${roomId}`);
        const snapshot = await roomRef.get();
        if (!snapshot.exists()) {
          unique = true;
        }
      }
    }

    const roomRef = db.ref(`rooms/${roomId}`);
    const newRoom = {
      roomId: roomId,
      status: "LOBBY",
      theme: "どうぶつ",
      hostId: playerId,
      players: {
        [playerId]: {
          id: playerId,
          name: hostName,
          isHost: true,
          status: "waiting",
          originalWord: "",
          letters: [],
          revealed: [],
          isDefeated: false
        }
      },
      playerOrder: [playerId],
      turnPlayerId: "",
      guessedLetters: "", 
      winnerId: "",
      combos: 0,
      chat: {
        initial: {
          sender: "システム",
          text: `${hostName}さんが部屋を作成しました。合言葉: ${roomId} / テーマ: どうぶつ`,
          time: firebase.database.ServerValue.TIMESTAMP
        }
      },
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    await roomRef.set(newRoom);
    return { roomId, playerId };
  },

  // 2. Join Room (with Reconnection support based on Room ID + Name)
  joinRoom: async function(roomId, playerName) {
    roomId = roomId.toUpperCase();
    const playerId = getOrCreatePlayerId();
    const roomRef = db.ref(`rooms/${roomId}`);
    const snapshot = await roomRef.get();

    if (!snapshot.exists()) {
      throw new Error("部屋が見つかりません。合言葉を確認してください。");
    }

    const roomData = snapshot.val();
    const players = roomData.players || {};

    // 1. 同名プレイヤーの存在チェック (再接続の判定)
    let existingPlayerId = null;
    for (let pid in players) {
      if (players[pid].name === playerName) {
        existingPlayerId = pid;
        break;
      }
    }

    // 2. 新規参加時の制限チェック (ゲーム開始後は新規参加不可)
    if (!existingPlayerId) {
      if (roomData.status !== "LOBBY") {
        throw new Error("このゲームはすでに開始されています。ゲーム途中の新規参加はできません。");
      }
      if (Object.keys(players).length >= 6) {
        throw new Error("部屋が満員です（最大6人）。");
      }
    }

    // トランザクションでプレイヤーリストを更新
    await roomRef.transaction((currentRoom) => {
      if (!currentRoom) return null;

      if (!currentRoom.players) {
        currentRoom.players = {};
      }

      if (existingPlayerId) {
        // 同名プレイヤーが見つかったら、playerIdを上書きして再接続
        safeSessionStorage.setItem("aiue_player_id", existingPlayerId);

        // 再接続システムログを挿入
        const chatRef = db.ref(`rooms/${roomId}/chat`);
        const newChatKey = chatRef.push().key;
        if (!currentRoom.chat) currentRoom.chat = {};
        currentRoom.chat[newChatKey] = {
          sender: "システム",
          text: `${playerName}さんが再接続しました。`,
          time: Date.now()
        };
      } else {
        // 新規プレイヤーとして追加
        currentRoom.players[playerId] = {
          id: playerId,
          name: playerName,
          isHost: false,
          status: "waiting",
          originalWord: "",
          letters: [],
          revealed: [],
          isDefeated: false
        };

        if (!currentRoom.playerOrder) currentRoom.playerOrder = [];
        currentRoom.playerOrder.push(playerId);

        // 参加システムログを挿入
        const chatRef = db.ref(`rooms/${roomId}/chat`);
        const newChatKey = chatRef.push().key;
        if (!currentRoom.chat) currentRoom.chat = {};
        currentRoom.chat[newChatKey] = {
          sender: "システム",
          text: `${playerName}さんが参加しました。`,
          time: Date.now()
        };
      }

      return currentRoom;
    });

    return { roomId, playerId: existingPlayerId || playerId };
  },

  // 3. Listen to Room Updates
  subscribeToRoom: function(roomId, callback) {
    const roomRef = db.ref(`rooms/${roomId}`);
    const listener = roomRef.on("value", (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.val());
      } else {
        callback(null);
      }
    });
    // Return unsubscribe function
    return () => roomRef.off("value", listener);
  },

  // 4. Update Theme
  updateTheme: async function(roomId, theme) {
    const roomRef = db.ref(`rooms/${roomId}`);
    await roomRef.transaction((room) => {
      if (!room) return null;
      room.theme = theme;
      
      const chatKey = "sys_" + Date.now();
      if (!room.chat) room.chat = {};
      room.chat[chatKey] = {
        sender: "システム",
        text: `お題が「${theme}」に変更されました。`,
        time: Date.now()
      };
      return room;
    });
  },

  // 5. Start Setup (Start Game from Lobby)
  startSetup: async function(roomId) {
    const roomRef = db.ref(`rooms/${roomId}`);
    await roomRef.transaction((room) => {
      if (!room) return null;
      
      room.status = "SETUP";
      for (let pid in room.players) {
        room.players[pid].status = "waiting";
        room.players[pid].originalWord = "";
        room.players[pid].letters = [];
        room.players[pid].revealed = [];
        room.players[pid].isDefeated = false;
      }
      room.winnerId = "";
      room.guessedLetters = "";
      room.combos = 0;

      const chatKey = "sys_" + Date.now();
      if (!room.chat) room.chat = {};
      room.chat[chatKey] = {
        sender: "システム",
        text: `ゲーム開始！ お題は『${room.theme}』です。言葉を決定してください。`,
        time: Date.now()
      };

      return room;
    });
  },

  // 6. Submit Secret Word
  submitWord: async function(roomId, playerId, originalWord, normalizedLetters) {
    const roomRef = db.ref(`rooms/${roomId}`);
    await roomRef.transaction((room) => {
      if (!room) return null;
      if (!room.players || !room.players[playerId]) return room;

      const p = room.players[playerId];
      p.originalWord = originalWord;
      p.letters = normalizedLetters;
      p.revealed = normalizedLetters.map(char => char === "×");
      p.status = "ready";
      p.isDefeated = false;

      // Check if all players are ready
      let allReady = true;
      for (let pid in room.players) {
        if (room.players[pid].status !== "ready") {
          allReady = false;
          break;
        }
      }

      if (allReady) {
        room.status = "BATTLE";
        const startPlayerId = room.playerOrder[Math.floor(Math.random() * room.playerOrder.length)];
        room.turnPlayerId = startPlayerId;
        room.guessedLetters = "";
        room.combos = 0;

        const chatKey = "sys_" + Date.now();
        if (!room.chat) room.chat = {};
        room.chat[chatKey] = {
          sender: "システム",
          text: `全員の言葉が決まりました！ バトル開始！ 先手は ${room.players[startPlayerId].name} さんです。`,
          time: Date.now()
        };
      }

      return room;
    });
  },

  // 7. Make an Attack (Choose letter in turn)
  attackLetter: async function(roomId, letter, playerId) {
    const roomRef = db.ref(`rooms/${roomId}`);
    let resultStatus = null;
    
    await roomRef.transaction((room) => {
      if (!room) return null;
      if (room.status !== "BATTLE") return room;
      if (room.turnPlayerId !== playerId) return room;

      let guessed = room.guessedLetters ? room.guessedLetters.split(",") : [];
      if (guessed.includes(letter)) return room;

      guessed.push(letter);
      room.guessedLetters = guessed.filter(Boolean).join(",");

      let hitCount = 0;
      let newlyDefeated = [];

      for (let pid in room.players) {
        if (pid === playerId) continue;
        const p = room.players[pid];
        if (p.isDefeated) continue;

        let playerHit = false;
        for (let i = 0; i < p.letters.length; i++) {
          if (p.letters[i] === letter && !p.revealed[i]) {
            p.revealed[i] = true;
            playerHit = true;
            hitCount++;
          }
        }

        if (playerHit) {
          const isDefeated = p.revealed.every(val => val === true);
          if (isDefeated) {
            p.isDefeated = true;
            newlyDefeated.push(p.name);
          }
        }
      }

      const attackerName = room.players[playerId].name;
      const chatKey = "battle_" + Date.now();
      if (!room.chat) room.chat = {};

      if (hitCount > 0) {
        room.combos = (room.combos || 0) + 1;
        resultStatus = "hit";
        
        let text = `${attackerName}の攻撃！『${letter}』ヒット！ (${hitCount}文字ヒット / ${room.combos}コンボ目)`;
        if (newlyDefeated.length > 0) {
          text += ` ➔ ${newlyDefeated.join(", ")}さんが脱落しました！`;
        }
        room.chat[chatKey] = {
          sender: "システム",
          text: text,
          time: Date.now()
        };

        let activePlayers = [];
        for (let pid in room.players) {
          if (!room.players[pid].isDefeated) {
            activePlayers.push(room.players[pid]);
          }
        }

        if (activePlayers.length <= 1) {
          room.status = "GAMEOVER";
          room.winnerId = activePlayers.length === 1 ? activePlayers[0].id : playerId;
          const winnerName = activePlayers.length === 1 ? activePlayers[0].name : attackerName;
          resultStatus = "victory";

          const endChatKey = "end_" + Date.now();
          room.chat[endChatKey] = {
            sender: "システム",
            text: `ゲーム終了！ 勝者は『${winnerName}』さんです！ 🎉`,
            time: Date.now()
          };
        }
      } else {
        room.combos = 0;
        resultStatus = "miss";

        const currentIndex = room.playerOrder.indexOf(playerId);
        let nextIndex = (currentIndex + 1) % room.playerOrder.length;
        let nextPlayerId = room.playerOrder[nextIndex];

        while (room.players[nextPlayerId].isDefeated && nextPlayerId !== playerId) {
          nextIndex = (nextIndex + 1) % room.playerOrder.length;
          nextPlayerId = room.playerOrder[nextIndex];
        }

        room.turnPlayerId = nextPlayerId;
        const nextPlayerName = room.players[nextPlayerId].name;

        room.chat[chatKey] = {
          sender: "システム",
          text: `${attackerName}の攻撃！『${letter}』ミス... ➔ 次は ${nextPlayerName} さんの番です。`,
          time: Date.now()
        };
      }

      return room;
    });

    return resultStatus;
  },

  // 8. Send Chat Message
  sendChatMessage: async function(roomId, senderName, text, isSystem = false) {
    const chatRef = db.ref(`rooms/${roomId}/chat`);
    await chatRef.push().set({
      sender: isSystem ? "システム" : senderName,
      text: text,
      time: firebase.database.ServerValue.TIMESTAMP
    });
  },

  // 9. Back to Lobby
  resetToLobby: async function(roomId) {
    const roomRef = db.ref(`rooms/${roomId}`);
    await roomRef.transaction((room) => {
      if (!room) return null;
      
      room.status = "LOBBY";
      for (let pid in room.players) {
        room.players[pid].status = "waiting";
        room.players[pid].originalWord = "";
        room.players[pid].letters = [];
        room.players[pid].revealed = [];
        room.players[pid].isDefeated = false;
      }
      room.winnerId = "";
      room.guessedLetters = "";
      room.combos = 0;
      
      const chatKey = "sys_" + Date.now();
      if (!room.chat) room.chat = {};
      room.chat[chatKey] = {
        sender: "システム",
        text: "ゲームが初期化されました。ロビーに戻ります。",
        time: Date.now()
      };

      return room;
    });
  },

  // 10. Rematch Game (Start next round directly in SETUP with same theme)
  rematchGame: async function(roomId) {
    const roomRef = db.ref(`rooms/${roomId}`);
    await roomRef.transaction((room) => {
      if (!room) return null;
      
      room.status = "SETUP";
      for (let pid in room.players) {
        room.players[pid].status = "waiting";
        room.players[pid].originalWord = "";
        room.players[pid].letters = [];
        room.players[pid].revealed = [];
        room.players[pid].isDefeated = false;
      }
      room.winnerId = "";
      room.guessedLetters = "";
      room.combos = 0;
      
      const chatKey = "sys_" + Date.now();
      if (!room.chat) room.chat = {};
      room.chat[chatKey] = {
        sender: "システム",
        text: `連戦が開始されました！ お題は引き続き『${room.theme}』です。新しい言葉を決定してください。`,
        time: Date.now()
      };

      return room;
    });
  }
};
} catch (e) {
  alert("firebase-db.js エラー:\n" + e.message + "\n\n" + e.stack);
}
