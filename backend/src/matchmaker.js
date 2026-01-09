export class Matchmaker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = [];
    this.sockets = new Map();
    this.timer = null;
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

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

    this.players.push(user);
    this.sockets.set(server, user);

    server.addEventListener("close", () => {
      this.players = this.players.filter(p => p.username !== user.username);
      this.sockets.delete(server);
      this.broadcastWaiting();
    });

    this.broadcastWaiting();
    this.tryMatch();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  broadcastWaiting() {
    const msg = JSON.stringify({
      type: "waiting",
      players: this.players
    });
    this.sockets.forEach((_, ws) => ws.send(msg));
  }

  tryMatch() {
    if (this.players.length >= 3) {
      this.startMatch();
      return;
    }

    if (this.players.length === 2 && !this.timer) {
      this.timer = setTimeout(() => {
        if (this.players.length === 2) {
          this.startMatch();
        }
      }, 10000);
    }
  }

  startMatch() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const roomId = crypto.randomUUID();
    const msg = JSON.stringify({
      type: "matched",
      roomId,
      players: this.players
    });

    this.sockets.forEach((_, ws) => ws.send(msg));

    this.players = [];
    this.sockets.clear();
  }
}
