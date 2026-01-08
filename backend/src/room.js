import { ShichinarabeGame } from "./game.js";

export class ShichinarabeRoom {
  constructor() {
    this.clients = new Map(); // username -> ws（人間のみ）
    this.players = [];       // username の配列（COM含む）
    this.maxPlayers = null;
    this.game = null;
    this.comBusy = false;
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
        this.sendChat("[Server]> ゲーム開始します。");
        this.join(ws, msg.username, msg.maxPlayers);
        return;
      }

      if (!this.game) return;

      if (msg.type === "play_card") {
        //this.sendChat(`[Server]> ${msg.username} が ${msg.card} を提出しました。`);
        this.game.playCard(msg.username, msg.card);
        this.afterAction();
      }

      if (msg.type === "pass_turn") {
        this.sendChat(`[Server]> ${msg.username} はパスしました。`);
        this.game.pass(msg.username);
        this.afterAction();
      }
      //降参ボタン
      if (msg.type === "resign") {
        if (this.game.currentPlayer() !== msg.username) return;
        //this.game.resign(msg.username);
        
        
        this.sendChat(`[Server]> ${msg.username} は降参しました。`);
        this.game.resign(msg.username);
        this.sendChat(`[Server]> ${msg.username} は降参しました。2`);
        this.afterAction();
        return;
      }

      if (msg.type === "chat") {
        const name = msg.username;
        const text = msg.text;

        // 最低限のガード
        //if (!name || !text) return;

        //this.broadcast({
        //  type: "chat",
        //  text: `[${name}] > ${text}`
        //});
        this.sendChat(`[${name}]> ${text}`);

        return;
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
    if( this.comBusy ) return;

    const p = this.game.currentPlayer();
    if (!p || !p.startsWith("COM")) return;

    this.comBusy = true;
    setTimeout(() => this.comPlay(p), 800);
  }
  //CPUの行動
  comPlay(name) {
    try { //一応例外処理
      const playable = this.game.getPlayable(name);
      if (playable.length > 0) {
        const card = playable[Math.floor(Math.random() * playable.length)];
        this.game.playCard(name, card);
        //this.sendChat(`${name} が ${card} を提出しました。`);
      } else {
        this.game.pass(name);
        this.sendChat(`[Server]> ${name} はパスしました。`);
      }
      //this.afterAction();
    } catch(e) {
      console.error("COMエラー", name, e);
    }
    this.comBusy = false;
    this.afterAction();
  }



  afterAction() {
    //this.sendChat(`AfterAction`);
    this.broadcastGame();
    for (const name of this.game.dead) {
      if (!this._loggedDead) this._loggedDead = new Set();
      if (!this._loggedDead.has(name)) {
        this.sendChat(`[Server]> ${name} は脱落しました`);
        this._loggedDead.add(name);
      }
    }

    //ゲーム終了判定
    if (this.game.players.length === 1) {
      const last = this.game.players[0];
      this.sendChat(`[Server]> ${last}が最後まで残りました。`);
      // ★ 最後の一人を「game.js 側の正式処理」で確定させる
      this.game.finalizeLastPlayer(last);
      
      this.game.players = [];
      this.broadcast({
        type: "game_result",
        ranks: this.game.rankSlots
      });
      this.sendChat(`[Server]> ゲームを終了します。`);
      return;
    }

    /*
    if (this.game.players.length === 0) {
      this.broadcast({
        type: "game_result",
        ranks: this.game.rankSlots 
      });
      this.sendChat(`[Server]> ゲームを終了します。`);
      return;
    }
    */
    
    //this.sendChat("turn : " + this.game.turnIndex + "Player : " +  this.game.currentPlayer() +  "PLAYERS : " + this.game.players);
    //this.Debug("");
    this.checkCOMTurn();
  }

  Debug(label = "") {
    if (!this.game) return;

    const turn = this.game.turnIndex;
    const player = this.game.currentPlayer() ?? "undefined";
    const players = JSON.stringify(this.game.players);

    this.sendChat(
      `[DEBUG${label}] > turn=${turn} player=${player} players=${players} ranks=${JSON.stringify(this.game.ranks)}`
    );
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

  sendChat(text) {
    this.broadcast({
      type: "chat",
      text
    });
  }

  onClose(ws) {
    for (const [name, sock] of this.clients.entries()) {
      if (sock === ws) {
        this.clients.delete(name);
      }
    }
  }
}
