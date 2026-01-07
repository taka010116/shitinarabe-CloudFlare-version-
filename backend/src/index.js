import { ShichinarabeRoom } from "./room.js";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // ヘルスチェック
    if (!url.pathname.startsWith("/room/")) {
      return new Response("Shichinarabe Backend Alive", { status: 200 });
    }

    // WebSocket 以外は拒否
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const roomId = url.pathname.split("/")[2];
    const id = env.ROOM.idFromName(roomId);
    const room = env.ROOM.get(id);

    return room.fetch(req);
  }
};

export { ShichinarabeRoom };

/*

export class ShichinarabeRoom {
  constructor(state) {
    this.state = state;
    this.players = []; // { username, socket }
    this.maxPlayers = null;
    this.started = false;
  }

  async fetch(req) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    server.addEventListener("message", e => {
      const msg = JSON.parse(e.data);

      if (msg.type === "join_game") {
        this.onJoin(server, msg);
      }
    });

    server.addEventListener("close", () => {
      this.onClose(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  onJoin(socket, msg) {
    if (this.started) {
      socket.send(JSON.stringify({
        type: "error",
        message: "ゲームはすでに開始されています"
      }));
      socket.close();
      return;
    }

    // 最初の人が人数を決める
    if (this.maxPlayers === null) {
      this.maxPlayers = msg.maxPlayers;
    }

    // 人数オーバー防止
    if (this.players.length >= this.maxPlayers) {
      socket.send(JSON.stringify({
        type: "error",
        message: "部屋が満員です"
      }));
      socket.close();
      return;
    }

    this.players.push({
      username: msg.username,
      socket
    });

    this.broadcastWaiting();

    // 人数が揃ったら開始
    if (this.players.length === this.maxPlayers) {
      this.startGame();
    }
  }

  onClose(socket) {
    this.players = this.players.filter(p => p.socket !== socket);

    if (!this.started) {
      this.broadcastWaiting();
    }
  }

  broadcastWaiting() {
    const msg = JSON.stringify({
      type: "waiting",
      current: this.players.length,
      max: this.maxPlayers
    });

    this.players.forEach(p => p.socket.send(msg));
  }

  startGame() {
    this.started = true;

    const msg = JSON.stringify({
      type: "game_start"
    });

    this.players.forEach(p => p.socket.send(msg));
  }
}
*/