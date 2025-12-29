export default {
  fetch(req, env) {
    const url = new URL(req.url);
    const roomId = url.pathname.split("/").pop();

    const id = env.ROOM.idFromName(roomId);
    const room = env.ROOM.get(id);

    return room.fetch(req);
  }
};

/* =========================================================
   七並べルーム（Durable Object）
========================================================= */
export class ShichinarabeRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.players = [];
    this.sockets = new Map();

    this.hands = {};
    this.table = {
      hearts: Array(13).fill(null),
      spades: Array(13).fill(null),
      diamonds: Array(13).fill(null),
      clubs: Array(13).fill(null)
    };

    this.turnOrder = [];
    this.currentTurn = null;
    this.passes = {};
    this.alive = {};
    this.ranking = [];
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    server.addEventListener("message", e => this.onMessage(server, e));
    server.addEventListener("close", () => this.onClose(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  onClose(ws) {
    for (const [name, sock] of this.sockets) {
      if (sock === ws) {
        this.sockets.delete(name);
        this.players = this.players.filter(p => p !== name);
        delete this.hands[name];
        delete this.passes[name];
        delete this.alive[name];
        break;
      }
    }
  }

  send(ws, type, data = {}) {
    ws.send(JSON.stringify({ type, ...data }));
  }

  broadcast(type, data = {}) {
    const msg = JSON.stringify({ type, ...data });
    for (const ws of this.sockets.values()) {
      ws.send(msg);
    }
  }

  async onMessage(ws, e) {
    const msg = JSON.parse(e.data);

    if (msg.type === "join_game") this.join(ws, msg.username);
    if (msg.type === "play_card") this.playCard(msg.username, msg.card);
    if (msg.type === "pass_turn") this.pass(msg.username);
  }

  /* =====================================================
     ゲーム初期化
  ===================================================== */
  join(ws, username) {
    this.sockets.set(username, ws);

    if (!this.players.includes(username)) {
      this.players.push(username);
      this.alive[username] = true;
      this.passes[username] = 0;
    }

    if (this.players.length === 1) {
      this.startGame();
    }

    this.sendState();
  }

  startGame() {
    const suits = ["H", "S", "D", "K"];
    const deck = [];
    for (const s of suits) for (let i = 1; i <= 13; i++) deck.push(`${s}${i}`);
    deck.sort(() => Math.random() - 0.5);

    this.players.forEach((p, i) => {
      this.hands[p] = deck.slice(i * 13, (i + 1) * 13);
    });

    this.turnOrder = [...this.players].sort(() => Math.random() - 0.5);
    this.currentTurn = this.turnOrder[0];

    this.placeInitialSevens();
  }

  placeInitialSevens() {
    const map = { H: "hearts", S: "spades", D: "diamonds", K: "clubs" };

    for (const p of this.players) {
      const newHand = [];
      for (const c of this.hands[p]) {
        const n = parseInt(c.slice(1));
        if (n === 7) {
          this.table[map[c[0]]][6] = c;
        } else newHand.push(c);
      }
      this.hands[p] = newHand;
    }
  }

  /* =====================================================
     ゲーム進行
  ===================================================== */
  getPlayable(hand) {
    const map = { H: "hearts", S: "spades", D: "diamonds", K: "clubs" };
    const res = [];

    for (const c of hand) {
      const suit = map[c[0]];
      const n = parseInt(c.slice(1)) - 1;
      const row = this.table[suit];

      if (n > 6 && row[n - 1]) res.push(c);
      if (n < 6 && row[n + 1]) res.push(c);
    }
    return res;
  }

  playCard(username, card) {
    if (this.currentTurn !== username) return;

    const map = { H: "hearts", S: "spades", D: "diamonds", K: "clubs" };
    const suit = map[card[0]];
    const idx = parseInt(card.slice(1)) - 1;

    this.table[suit][idx] = card;
    this.hands[username] = this.hands[username].filter(c => c !== card);

    if (this.hands[username].length === 0) {
      this.alive[username] = false;
      this.ranking.push(username);
    }

    this.advanceTurn();
    this.sendState();
  }

  pass(username) {
    this.passes[username]++;

    if (this.passes[username] >= 4) {
      this.alive[username] = false;
      this.ranking.push(username);
    }

    this.advanceTurn();
    this.sendState();
  }

  advanceTurn() {
    const alive = this.turnOrder.filter(p => this.alive[p]);
    if (!alive.length) return;

    const idx = alive.indexOf(this.currentTurn);
    this.currentTurn = alive[(idx + 1) % alive.length];
  }

  /* =====================================================
     クライアント送信
  ===================================================== */
  sendState() {
    this.broadcast("update_table", { table: this.table });

    for (const p of this.players) {
      this.send(this.sockets.get(p), "update_hand", {
        username: p,
        hand: this.hands[p],
        playable: this.getPlayable(this.hands[p]),
        current_turn: this.currentTurn,
        passes: this.passes
      });
    }

    const counts = {};
    this.players.forEach(p => counts[p] = this.hands[p].length);

    this.broadcast("announce_turn", {
      player: this.currentTurn,
      players: this.players,
      passes: this.passes,
      hand_counts: counts
    });

    this.broadcast("update_ranking", { ranks: this.ranking });
  }
}
