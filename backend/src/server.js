import WebSocket, { WebSocketServer } from "ws";
import { ShichinarabeGame } from "./game.js";
//import { ShichinarabeRoom } from "./room.js";

const wss = new WebSocketServer({ port: 8080 });
console.log("Match & Game server running on ws://localhost:8080");

const players = new Map(); 
// ws -> { username, dan, rating }

function send(ws, data) {
  ws.send(JSON.stringify(data));
}

let countdownTimer = null;
let countdownEnd = null;
let room = null;
let game = null;

/* ============================
   共通ブロードキャスト
============================ */
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of players.keys()) {
    ws.send(msg);
    console.log(data);
  }
}

/* ============================
   待機情報送信
============================ */
function broadcastWaiting() {
  const list = Array.from(players.values());

  let startIn = null;
  let mode = null;

  if (list.length >= 4) {
    startGame(4);
    return;
  }
  if (list.length === 3) {
    mode = "3人対局";
    startIn = 5;
  }
  if (list.length === 2) {
    mode = "2人対局";
    startIn = 10;
  }

  if (startIn !== null) startCountdown(startIn, list.length);

  broadcast({
    type: "waiting",
    players: list,
    count: list.length,
    mode,
    startIn
  });
}

/* ============================
   カウントダウン制御
============================ */
function startCountdown(seconds, playerCount) {
  if (countdownTimer) clearInterval(countdownTimer);

  countdownEnd = Date.now() + seconds * 1000;

  countdownTimer = setInterval(() => {
    const remain = Math.max(
      0,
      Math.ceil((countdownEnd - Date.now()) / 1000)
    );

    if (players.size !== playerCount) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      broadcastWaiting();
      return;
    }

    broadcast({
      type: "countdown",
      remain,
      playerCount
    });

    if (remain <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      startGame(playerCount);
    }
  }, 1000);
}

/* ============================
   ゲーム開始
============================ */

function broadcastGameState() {
  if (!game) return;

  // テーブル
  broadcast({
    type: "update_table",
    table: game.table
  });

  // 各プレイヤーの手札
  for (const [ws, p] of players.entries()) {
    if (!game.hands[p.username]) continue;

    send(ws, {
      type: "update_hand",
      username: p.username,
      hand: game.hands[p.username],
      playable: game.getPlayable(p.username),
      current_turn: game.currentPlayer(),
      passes: game.passes
    });
  }

  // ターン情報
  broadcast({
    type: "announce_turn",
    player: game.currentPlayer(),
    players: game.players,
    passes: game.passes,
    hand_counts: Object.fromEntries(
      game.players.map(p => [p, game.hands[p].length])
    )
  });
}

function initGame() {
    const deck = [];
    const suits = ["H", "S", "D", "K"];

    for (const s of suits) {
      for (let n = 1; n <= 13; n++) {
        deck.push(s + n);
      }
    }

    deck.sort(() => Math.random() - 0.5);

    this.players.forEach(p => {
      this.hands[p] = [];
      this.passes[p] = 0;
    });

    this.players.forEach((p, i) => {
      this.hands[p] = deck.slice(i * 13, (i + 1) * 13);
    });

    // 7を即出し
    for (const p of this.players) {
      this.hands[p] = this.hands[p].filter(card => {
        const suit = this.suitName(card[0]);
        const num = Number(card.slice(1));
        if (num === 7) {
          this.table[suit][6] = card;
          return false;
        }
        return true;
      });
    }
  }

function startGame(playerCount) {
  if (game) return;
  if (players.size < 2) return;

  const humanPlayers = Array.from(players.values())
    .slice(0, playerCount)
    .map(p => p.username);

  const MAX = 4;
  const comPlayers = [];

  for (let i = humanPlayers.length + 1; i <= MAX; i++) {
    comPlayers.push(`COM${i - humanPlayers.length}`);
  }

  const allPlayers = [...humanPlayers, ...comPlayers];

  game = new ShichinarabeGame(allPlayers);

  console.log(`▶ 対局開始`);
  console.log("人間:", humanPlayers);
  console.log("CPU:", comPlayers);

  broadcast({
    type: "game_start",
    players: Array.from(players.values()),
    cpu: comPlayers,
    total: allPlayers.length
  });

  afterAction();
}

function processCOMIfNeeded() {
  if (!game) return;

  game.processCOM(() => {
    afterAction();
    processCOMIfNeeded(); // 次もCPUなら連続実行
  });
}


/* ============================
   接続処理
============================ */
wss.on("connection", (ws) => {
  console.log("新規接続");

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    /* ===== 参加 ===== */
    if (msg.type === "join_game") {
      players.set(ws, {
        username: msg.username,
        dan: msg.dan,
        rating: msg.rating
      });

      console.log(
        `👤 接続: ${msg.username} (${msg.dan} / R${msg.rating})`
      );
      console.log(`  現在 ${players.size} 人`);

      broadcastWaiting();
      return;
    }

    /* ===== ゲーム未開始ガード ===== */
    if (!game) return;

    /* ===== カードを出す ===== */
    if (msg.type === "play_card") {
      if (game.currentPlayer() !== msg.username) return;

      game.playCard(msg.username, msg.card);
      afterAction();
      return;
    }

    /* ===== パス ===== */
    if (msg.type === "pass_turn") {
      if (game.currentPlayer() !== msg.username) return;

      game.pass(msg.username);
      afterAction();
      return;
    }

    /* ===== 降参 ===== */
    if (msg.type === "resign") {
      if (game.currentPlayer() !== msg.username) return;

      broadcast({
        type: "chat",
        text: `[Server]> ${msg.username} は降参しました`
      });

      game.resign(msg.username);
      afterAction();
      return;
    }

    /* ===== チャット ===== */
    if (msg.type === "chat") {
      broadcast({
        type: "chat",
        text: `[${msg.username}]> ${msg.text}`
      });
    }
  });

  ws.on("close", () => {
    const p = players.get(ws);
    if (p) {
      console.log(`❌ 切断: ${p.username}`);
      players.delete(ws);
      broadcastWaiting();
    }
  });
});


function afterAction() {
  if (!game) return;
  broadcastGameState();

  // 脱落ログ
  for (const name of game.dead) {
    broadcast({
      type: "chat",
      text: `[Server] ${name} は脱落しました`
    });
  }

  // 終了判定
  if (game.players.length === 1) {
    const last = game.players[0];
    game.finalizeLastPlayer(last);
    game.rankSlots[game.rankBottom] = last;
    broadcast({
      type: "game_result",
      ranks: game.rankSlots
    });

    console.log("▶ ゲーム終了", game.rankSlots);
    game = null;
    return;
  }

  if (game.currentPlayer().startsWith("COM")) {
    setTimeout(() => {
      game.processCOM(afterAction);
    }, 400);
  }
  //processCOMIfNeeded();
}
