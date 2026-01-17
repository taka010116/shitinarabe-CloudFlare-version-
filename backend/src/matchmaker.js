// matchmaker.js
export class Matchmaker {
  constructor() {
    this.sockets = new Set();
  }

  fetch(req) {
    // WebSocket でない場合はエラー
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.sockets.add(server);

    // 切断時に削除
    server.addEventListener("close", () => {
      this.sockets.delete(server);
      this.broadcastWaiting();
    });

    // 接続した時点で待機人数を全員に通知
    this.broadcastWaiting();

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcastWaiting() {
    const players = Array.from(this.sockets).map((ws, i) => ({
      username: `Player${i + 1}`,
      dan: 1,
      rating: 1500
    }));

    const msg = JSON.stringify({
      type: "waiting",
      count: players.length,
      players
    });

    this.sockets.forEach(ws => {
      try {
        ws.send(msg);
      } catch (e) {
        console.error("Failed to send:", e);
      }
    });
  }
}

/*
export class Matchmaker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();
  }

  async fetch(req) {
    const url = new URL(req.url);
    const username = url.searchParams.get("user");

    if (!username) {
      return new Response("No user", { status: 400 });
    }

    const user = await this.env.DB.prepare(
      "SELECT username, dan, rating FROM users WHERE username=?"
    ).bind(username).first();

    if (!user) {
      return new Response("User not found", { status: 403 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const players = (await this.state.storage.get("players")) || [];
    players.push(user);
    await this.state.storage.put("players", players);

    this.sockets.set(server, user);

    server.addEventListener("close", async () => {
      const list = (await this.state.storage.get("players")) || [];
      const updated = list.filter(p => p.username !== user.username);
      await this.state.storage.put("players", updated);
      this.sockets.delete(server);
      await this.broadcast();
    });

    await this.broadcast();
    await this.checkMatch();

    return new Response(null, { status: 101, webSocket: client });
  }

  async broadcast() {
    const players = (await this.state.storage.get("players")) || [];
    const msg = JSON.stringify({
      type: "waiting",
      count: players.length,
      players
    });
    this.sockets.forEach((_, ws) => ws.send(msg));
  }

  async checkMatch() {
    const players = (await this.state.storage.get("players")) || [];

    if (players.length >= 3) {
      await this.startMatch(players);
      return;
    }

    if (players.length === 2) {
      // 10秒後に alarm
      await this.state.storage.setAlarm(Date.now() + 10_000);
    }
  }

  async alarm() {
    const players = (await this.state.storage.get("players")) || [];
    if (players.length === 2) {
      await this.startMatch(players);
    }
  }

  async startMatch(players) {
    const roomId = crypto.randomUUID();
    const msg = JSON.stringify({
      type: "matched",
      roomId,
      players
    });

    this.sockets.forEach((_, ws) => ws.send(msg));
    this.sockets.clear();
    await this.state.storage.put("players", []);
  }
}
*/