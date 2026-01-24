import { ShichinarabeGame } from "./game.js";

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

        const delta = getRankDelta(rank, player.dan);
        player.rating += delta;

        // クライアント通知
        send(ws, {
          type: "rating_update",
          delta,
          rating: player.rating
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
    }
  }
}


export class GameServer {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.lobby = new Map();
    this.rooms = new Map();
    this.roomSeq = 1;

    this.countdownTimer = null;
    this.countdownRemain = 0;
  }

  async fetch(req) {
  // WebSocketリクエストでない場合はエラーを返す（DO内でも必要）
  if (req.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket", { status: 400 });
  }

  const pair = new WebSocketPair();
  const client = pair[0]; // ブラウザ用
  const server = pair[1]; // サーバー(DO)用

  server.accept();

  // 初期化
  server.state = "none";
  server.roomId = null;

  // リスナー設定
  server.addEventListener("message", (e) => {
    try {
      const msg = JSON.parse(e.data);
      this.onMessage(server, msg);
    } catch (err) {
      console.error("JSON Error", err);
    }
  });

  server.addEventListener("close", () => {
    this.onClose(server);
  });

  // client を返す
  return new Response(null, {
    status: 101,
    webSocket: client,
  });

}

  /*
  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    server.state = "none";
    server.roomId = null;

    server.addEventListener("message", e => {
      const msg = JSON.parse(e.data);
      this.onMessage(server, msg);
    });

    server.addEventListener("close", () => {
      this.onClose(server);
    });

     return new Response(null, {
        status: 101,
        webSocket: client
    });
    }
*/

  send(ws, data) {
    ws.send(JSON.stringify(data));
  }

  /* ===== Lobby ===== */
  broadcastLobby() {
    const list = [...this.lobby.values()];
    for (const ws of this.lobby.keys()) {
      this.send(ws, {
        type: "waiting",
        players: list,
        count: list.length
      });
    }
    this.startCountdownIfNeeded();
  }

  startCountdownIfNeeded() {
    const n = this.lobby.size;
    let sec = 0;

    if (n === 2) sec = 10;
    else if (n === 3) sec = 5;
    else if (n >= 4) {
      this.startMatch();
      return;
    } else {
      this.stopCountdown();
      return;
    }

    if (this.countdownRemain === sec && this.countdownTimer) return;

    this.stopCountdown();
    this.countdownRemain = sec;

    this.countdownTimer = setInterval(() => {
      for (const ws of this.lobby.keys()) {
        this.send(ws, {
          type: "countdown",
          remain: this.countdownRemain,
          count: this.lobby.size
        });
      }

      this.countdownRemain--;
      if (this.countdownRemain < 0) {
        this.startMatch();
      }
    }, 1000);
  }

  stopCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    this.countdownRemain = 0;
  }

  startMatch() {
    if (this.lobby.size < 2) return;

    this.stopCountdown();

    const entries = [...this.lobby.entries()].slice(0, 4);
    for (const [ws] of entries) this.lobby.delete(ws);

    const room = new Room(this.roomSeq++, entries, this);
    this.rooms.set(room.roomId, room);
    room.startGame();

    this.broadcastLobby();
  }

  /* ===== Message ===== */
  onMessage(ws, msg) {
    if (msg.type === "join_game") {
      if (ws.state !== "none") return;

      ws.state = "lobby";
      this.lobby.set(ws, {
        username: msg.username,
        dan: msg.dan,
        rating: msg.rating
      });

      this.broadcastLobby();
      return;
    }

    if (ws.state !== "room") return;

    const room = this.rooms.get(ws.roomId);
    if (!room) return;

    if (msg.type === "play_card") {
      room.game.playCard(msg.username, msg.card);
      room.afterAction();
    }

    if (msg.type === "pass_turn") {
      room.game.pass(msg.username);
      room.afterAction();
    }

    if (msg.type === "chat") {
      room.broadcast({
        type: "chat",
        text: `[${msg.username}] ${msg.text}`
      });
    }
  }

  onClose(ws) {
    if (ws.state === "lobby") {
      this.lobby.delete(ws);
      this.broadcastLobby();
      return;
    }

    if (ws.state === "room") {
      const room = this.rooms.get(ws.roomId);
      if (room) room.onDisconnect(ws);
    }
  }
}
