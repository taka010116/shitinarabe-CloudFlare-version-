import WebSocket, { WebSocketServer } from "ws";
import { ShichinarabeGame } from "./game.js";

const wss = new WebSocketServer({ port: 8080 });
console.log("Match & Game server running on ws://localhost:8080");

// 待機ロビー（ゲーム未参加者のみ）
const lobby = new Map();     // ws -> player

// 進行中ルーム
const rooms = new Map();     // roomId -> Room
let roomSeq = 1;

//カウントダウン制御
let countdownTimer = null;
let countdownRemain = 0;

const DAN_TABLE = [
  { dan: "5級", rating: 100 },
  { dan: "4級", rating: 150 },
  { dan: "3級", rating: 250 },
  { dan: "2級", rating: 500 },
  { dan: "1級", rating: 650 },
  { dan: "初段", rating: 1000 },
  { dan: "二段", rating: 1500 },
  { dan: "三段", rating: 2000 },
  { dan: "四段", rating: 2500 },
  { dan: "五段", rating: 3000 },
  { dan: "六段", rating: 3500 },
  { dan: "七段", rating: 4000 },
  { dan: "八段", rating: 4500 },
  { dan: "九段", rating: 5000 }
];

//レーティング段位取得
function getDanFromRating(rating) {
  let result = DAN_TABLE[0].dan;
  for (const d of DAN_TABLE) {
    if (rating >= d.rating) {
      result = d.dan;
    }
  }
  return result;
}


function send(ws, data) {
  ws.send(JSON.stringify(data));
}

//クラスROOM
class Room {
  constructor(roomId, entries) {
    this.roomId = roomId;
    this.players = new Map(entries); // ws -> player
    this.game = null;
    this.locked = false;

    this.turnTimer = null;
    this.turnRemain = 0;

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

    this.stopTurnTimer();

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

      //レーティング計算
      for (let i = 0; i < g.rankSlots.length; i++) {
        const name = g.rankSlots[i];
        const rank = i + 1;

        // COM は無視
        if (name.startsWith("COM")) continue;

        // ws と player 情報を取得
        const entry = [...this.players.entries()]
          .find(([, p]) => p.username === name);
        if (!entry) continue;

        const [ws, player] = entry;
        const beforeRating = player.rating;
        const beforeDan = getDanFromRating(beforeRating);

        const afterDan = getDanFromRating(player.rating);
        const promoted = beforeDan !== afterDan;
        const delta = getRankDelta(rank, player.dan);
        player.rating += delta;

        // クライアント通知
        send(ws, {
          type: "rating_update",
          delta,
          rating: player.rating,
          beforeDan,
          afterDan,
          promoted,
          message: promoted
            ? `昇段しました ${beforeDan} → ${afterDan}`
            : null
        });

        // DB 更新
        updateRating(player.username, player.rating);
      }


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
      return;
    }

    this.startTurnTimer();

  }

    /* ===== ターンタイマー ===== */
    startTurnTimer() {
    this.stopTurnTimer();

    const g = this.game;
    if (!g) return;

    const player = g.currentPlayer();

    // COM は対象外
    if (player.startsWith("COM")) return;

    this.turnRemain = 20;

    this.broadcast({
      type: "turn_timer",
      player,
      remain: this.turnRemain
    });

    this.turnTimer = setInterval(() => {
      this.turnRemain--;

      this.broadcast({
        type: "turn_timer",
        player,
        remain: this.turnRemain
      });

      if (this.turnRemain <= 0) {
        this.stopTurnTimer();

        // まだ同じ人の手番なら自動処理
        if (g.currentPlayer() === player) {
          const playable = g.getPlayable(player);

          if (playable.length > 0) {
            // 出せるものからランダム
            const card =
              playable[Math.floor(Math.random() * playable.length)];

            this.broadcast({
              type: "chat",
              text: `[Server] ${player} は時間切れのため ${card} を自動提出しました`
            });

            g.playCard(player, card);
          } else {
            // 出せるものなし → パス
            this.broadcast({
              type: "chat",
              text: `[Server] ${player} は時間切れのため自動パスしました`
            });

            g.pass(player);
          }

          this.afterAction();
        }
      }
    }, 1000);
  }

  stopTurnTimer() {
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }
  }

}

//でーたべーす
async function updateRating(username, newRating) {
  
  console.log(`💾 DB更新: ${username} → R${newRating}`);
  try {
    await fetch("https://my-worker.6322052.workers.dev/api/rating", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        rating: newRating
      })
    });

    console.log(`💾 レーティング送信: ${username} → ${newRating}`);
  } catch (e) {
    console.error("❌ レーティング更新失敗", e);
  }
}

//レーティング計算
function getRankDelta(rank, dan) {
  // rank: 1,2,3,4
  if (rank === 1) return 40;
  if (rank === 2) return 10;
  if (rank === 3) return -10;

  // 4位（段級位別）
  if (dan <= -2) return -20;       // 5～2級
  if (dan === -1) return -30;      // 1級
  if (dan >= 1 && dan <= 2) return -40; // 初段～二段
  if (dan >= 3 && dan <= 5) return -50; // 三～五段
  return -60;                      // 六段以上
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
      room.stopTurnTimer();
      g.playCard(msg.username, msg.card);
      room.afterAction();
    }

    if (msg.type === "pass_turn") {
      if (g.currentPlayer() !== msg.username) return;
      room.stopTurnTimer();
      g.pass(msg.username);
      room.afterAction();
    }

    if (msg.type === "resign") {
      if (!room.game.players.includes(username)) return;
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
      broadcastLobby();
      return;
    }

    
    if (ws.state === "room") {
      const room = rooms.get(ws.roomId);
      if (!room || !room.game) return;

      const player = room.players.get(ws);
      if (!player) return;

      const username = player.username;
      room.broadcast({
        type: "chat",
        text: `[Server] ${username} が切断しました（自動降参）`
      });

      room.game.resign(username);
      room.players.delete(ws);
      room.afterAction();
    }

    broadcastLobby();
  });
});
