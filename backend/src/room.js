import { ShichinarabeGame } from "./game.js";

export class ShichinarabeRoom {
  constructor() {
    this.clients = new Map(); // username -> ws（人間のみ）
    this.players = [];       // username の配列（COM含む）
    this.maxPlayers = null;
    this.game = null;
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const ws = pair[1];

    ws.accept();
    ws.addEventListener("message", e => this.onMessage(ws, e));
    ws.addEventListener("close", () => this.onClose(ws));

    return new Response(null, { status: 101, webSocket: client });
  }

  //メッセージ受信
  onMessage(ws, e) {
    try {
      const msg = JSON.parse(e.data);

      if (msg.type === "join_game") {
        console.log("ゲームに参加");
        this.join(ws, msg.username, msg.maxPlayers);
        return;
      }

      if (!this.game) return;

      if (msg.type === "play_card") {
        console.log("カード選択");
        this.game.playCard(msg.username, msg.card);
        this.afterAction();
      }

      if (msg.type === "pass_turn") {
        console.log("パスターン");
        this.game.pass(msg.username);
        this.afterAction();
      }
    } catch (e) {
      console.error("onMessage例外", e);
    }
  }


  join(ws, username, maxPlayers) {
    // 初回のみ人数確定
    if (!this.maxPlayers && maxPlayers) {
      this.maxPlayers = maxPlayers;
    }

    // rejoin
    if (this.clients.has(username)) {
      const oldWs = this.clients.get(username);
      oldWs.close();
      this.clients.set(username, ws);
      this.sendFullState(ws, username);
      return;
    }

    // 新規参加
    if (this.players.length >= this.maxPlayers) {
      ws.send(JSON.stringify({ type: "error", message: "満室です" }));
      return;
    }
    //人間追加
    this.players.push(username);
    this.clients.set(username, ws);

    this.broadcast({
      type: "waiting",
      current: this.players.length,
      max: this.maxPlayers,
    });

    // 人数が揃ったら開始
    if (this.players.length === this.maxPlayers) {
      this.addCOMPlayers(); 
      this.game = new ShichinarabeGame(this.players);
      this.broadcast({ type: "game_start" });
      this.broadcastGame();
      this.checkCOMTurn();
    }
  }

  //CPU追加
  addCOMPlayers() {
    const humanCount = this.players.length;
    const comCount = 4 - humanCount;

    for (let i = 1; i <= comCount; i++) {
      this.players.push(`COM${i}`);
    }
  }

  //CPUのターン
  checkCOMTurn() {
    const p = this.game.currentPlayer();
    if (p.startsWith("COM")) {
      setTimeout(() => this.comPlay(p), 800);
    }
  }
  //CPUの行動
  comPlay(name) {
    try { //一応例外処理
      const playable = this.game.getPlayable(name);
      if (playable.length > 0) {
        this.game.playCard(name, playable[Math.floor(Math.random() * playable.length)]);
      } else {
        this.game.pass(name);
      }
      this.afterAction();
    } catch(e) {
      console.error("COMエラー", name, e);
    }
  }



  afterAction() {
    this.broadcastGame();
    this.checkCOMTurn();
  }

  //送信するところ
  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients.values()) {
      try {
        ws.send(data);
      } catch (e) {
        console.warn("send失敗", e);
      }
    }
  }



  broadcastGame() {
    //tableを更新
    this.broadcast({
      type: "update_table",
      table: this.game.table,
    });

    //hand
    for (const p of this.players) {
      if (!this.clients.has(p)) continue;

      this.clients.get(p)?.send(JSON.stringify({
        type: "update_hand",
        username: p,
        hand: this.game.hands[p],
        playable: this.game.getPlayable(p),
        current_turn: this.game.currentPlayer(),
        passes: this.game.passes,
      }));
    }

    //turn
    this.broadcast({
      type: "announce_turn",
      player: this.game.currentPlayer(),
      players: this.players,
      passes: this.game.passes,
      hand_counts: Object.fromEntries(
        this.players.map(p => [p, this.game.hands[p].length])
      ),
    });
  }

  sendFullState(ws, username) {
    ws.send(JSON.stringify({
      type: "update_table",
      table: this.game.table,
    }));

    ws.send(JSON.stringify({
      type: "update_hand",
      username,
      hand: this.game.hands[username],
      playable: this.game.getPlayable(username),
      current_turn: this.game.currentPlayer(),
      passes: this.game.passes,
    }));

    ws.send(JSON.stringify({
      type: "announce_turn",
      player: this.game.currentPlayer(),
      players: this.players,
      passes: this.game.passes,
      hand_counts: Object.fromEntries(
        this.players.map(p => [p, this.game.hands[p].length])
      ),
    }));
  }
  
  onClose(ws) {
    for (const [name, sock] of this.clients.entries()) {
      if (sock === ws) {
        this.clients.delete(name);
      }
    }
  }
}
