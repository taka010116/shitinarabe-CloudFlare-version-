import WebSocket, { WebSocketServer } from "ws";
import { ShichinarabeGame } from "./game.js";

const wss = new WebSocketServer({ port: 8080 });
console.log("Match & Game server running on ws://localhost:8080");

/* ============================
   グローバル状態
============================ */

// 待機ロビー（ゲーム未参加者のみ）
const lobby = new Map();     // ws -> player

// 進行中ルーム
const rooms = new Map();     // roomId -> Room
let roomSeq = 1;

//カウントダウン制御
let countdownTimer = null;
let countdownRemain = 0;


/* ============================
   util
============================ */

function send(ws, data) {
  ws.send(JSON.stringify(data));
}

/* ============================
   Room クラス
============================ */

class Room {
  constructor(roomId, entries) {
    this.roomId = roomId;
    this.players = new Map(entries); // ws -> player
    this.game = null;
    this.locked = false;

    for (const ws of this.players.keys()) {
      ws.state = "room";
      ws.roomId = roomId;
    }
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of this.players.keys()) {
      ws.send(msg);
    }
  }

  /* ===== ゲーム開始 ===== */
  startGame() {
    const humans = [...this.players.values()].map(p => p.username);
    this.locked = true;
    const MAX = 4;
    const coms = [];
    for (let i = humans.length + 1; i <= MAX; i++) {
      coms.push(`COM${i - humans.length}`);
    }

    const allPlayers = [...humans, ...coms];
    this.game = new ShichinarabeGame(allPlayers);

    console.log(`▶ Room${this.roomId} 開始`, allPlayers);

    this.broadcast({
      type: "game_start",
      roomId: this.roomId,
      players: humans,
      cpu: coms,
      total: allPlayers.length
    });

    this.afterAction();
  }

  /* ===== 状態配信 ===== */
  broadcastGameState() {
    const g = this.game;
    if (!g) return;

    this.broadcast({ type: "update_table", table: g.table });

    for (const [ws, p] of this.players.entries()) {
      if (!g.hands[p.username]) continue;

      send(ws, {
        type: "update_hand",
        username: p.username,
        hand: g.hands[p.username],
        playable: g.getPlayable(p.username),
        current_turn: g.currentPlayer(),
        passes: g.passes
      });
    }

    this.broadcast({
      type: "announce_turn",
      player: g.currentPlayer(),
      players: g.players,
      passes: g.passes,
      hand_counts: Object.fromEntries(
        g.players.map(p => [p, g.hands[p].length])
      )
    });
  }

  /* ===== 1アクション後処理 ===== */
  afterAction() {
    const g = this.game;
    if (!g) return;

    this.broadcastGameState();

    for (const dead of g.dead) {
      this.broadcast({
        type: "chat",
        text: `[Server] ${dead} は脱落しました`
      });
    }

    /* ===== 終局 ===== */
    if (g.players.length === 1) {
      const last = g.players[0];
      g.finalizeLastPlayer(last);
      g.rankSlots[g.rankBottom] = last;

      this.broadcast({
        type: "game_result",
        ranks: g.rankSlots
      });

      console.log(`▶ Room${this.roomId} 終了`);

      // プレイヤーをロビーへ戻す
      for (const [ws, p] of this.players.entries()) {
        ws.state = "lobby";
        ws.roomId = null;
        lobby.set(ws, p);
      }

      rooms.delete(this.roomId);
      this.game = null;

      broadcastLobby();
      tryMatch();
      return;
    }

    /* ===== CPU ターン ===== */
    if (g.currentPlayer().startsWith("COM")) {
      setTimeout(() => {
        g.processCOM(() => this.afterAction());
      }, 400);
    }
  }
}

/* ============================
   ロビー配信（待機者のみ）
============================ */

function broadcastLobby() {
  const list = [...lobby.values()];

  for (const ws of lobby.keys()) {
    send(ws, {
      type: "waiting",
      players: list,
      count: list.length
    });
  }
  startCountdownIfNeeded();
}

/* ============================
   マッチング
============================ */
function tryMatch() {
  // 即開始は 4 人のみ
  if (lobby.size < 4) return;

  startMatchFromCountdown(); 
}

/*
function tryMatch() {
  while (lobby.size >= 2) {
    const entries = [...lobby.entries()].slice(0, 4);
    if (entries.length < 2) break;

    stopCountdown(); 
    
    // lobby から完全除外
    for (const [ws] of entries) {
      lobby.delete(ws);
    }

    const room = new Room(roomSeq++, entries);
    rooms.set(room.roomId, room);
    room.startGame();
  }

  broadcastLobby();
}
*/

//カウントダウン制御
function startCountdownIfNeeded() {
  const n = lobby.size;

  let seconds = 0;
  if (n === 2) seconds = 10;
  else if (n === 3) seconds = 5;
  else if (n >= 4) {
    stopCountdown();
    tryMatch();
    return;
  } else {
    stopCountdown();
    return;
  }

  // 既に同条件なら何もしない
  if (countdownRemain === seconds && countdownTimer) return;

  stopCountdown();
  countdownRemain = seconds;

  countdownTimer = setInterval(() => {
    for (const ws of lobby.keys()) {
      send(ws, {
        type: "countdown",
        remain: countdownRemain,
        count: lobby.size
      });
    }

    countdownRemain--;

    if (countdownRemain < 0) {
      //stopCountdown();
      //tryMatch();
      startMatchFromCountdown(); 
    }
  }, 1000);
}

function startMatchFromCountdown() {
  if (lobby.size < 2) return;

  const entries = [...lobby.entries()].slice(0, 4);

  stopCountdown();

  for (const [ws] of entries) {
    lobby.delete(ws);
  }

  const room = new Room(roomSeq++, entries);
  rooms.set(room.roomId, room);
  room.startGame();

  broadcastLobby();
}


function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  countdownRemain = 0;
}


/* ============================
   接続処理
============================ */

wss.on("connection", (ws) => {
  ws.state = "none";
  ws.roomId = null;

  console.log("新規接続");

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    /* ===== 参加 ===== */
    if (msg.type === "join_game") {
      if (ws.state !== "none") return;

      ws.state = "lobby";
      lobby.set(ws, {
        username: msg.username,
        dan: msg.dan,
        rating: msg.rating
      });

      console.log(`👤 接続: ${msg.username}`);
      broadcastLobby();
      tryMatch();
      return;
    }

    /* ===== Room 所属確認 ===== */
    if (ws.state !== "room") return;

    const room = rooms.get(ws.roomId);
    if (!room || !room.game) return;

    const g = room.game;

    if (msg.type === "play_card") {
      if (g.currentPlayer() !== msg.username) return;
      g.playCard(msg.username, msg.card);
      room.afterAction();
    }

    if (msg.type === "pass_turn") {
      if (g.currentPlayer() !== msg.username) return;
      g.pass(msg.username);
      room.afterAction();
    }

    if (msg.type === "resign") {
      if (g.currentPlayer() !== msg.username) return;
      room.broadcast({
        type: "chat",
        text: `[Server]> ${msg.username} は降参しました`
      });
      g.resign(msg.username);
      room.afterAction();
    }

    if (msg.type === "chat") {
      room.broadcast({
        type: "chat",
        text: `[${msg.username}]> ${msg.text}`
      });
    }
  });

  ws.on("close", () => {
    if (ws.state === "lobby") {
      lobby.delete(ws);
    }

    if (ws.state === "room") {
      const room = rooms.get(ws.roomId);
      if (room) room.players.delete(ws);
    }

    broadcastLobby();
  });
});
