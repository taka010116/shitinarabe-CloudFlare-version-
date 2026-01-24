// worker.js
export default {
  async fetch(req, env) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const id = env.GAME.idFromName("global");
    const stub = env.GAME.get(id);

    await stub.fetch("https://game/ws", {
      headers: { Upgrade: "websocket" },
      webSocket: server
    });

    return new Response(null, { status: 101, webSocket: client });
  }
};
