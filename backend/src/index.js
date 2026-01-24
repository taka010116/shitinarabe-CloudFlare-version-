import { ShichinarabeRoom } from "./room.js";
import { Matchmaker } from "./matchmaker.js";
import { register, login, updateComment } from "./auth/auth.js";
import { GameServer } from "./workerServer.js";

const matchmaker = new Matchmaker();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-USER",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }
    const url = new URL(req.url);

    /* ===== ヘルスチェック ===== */
    if (url.pathname === "/") {
      return new Response("Backend Alive", { status: 200 });
    }

    


    /* ===== 認証 API ===== */
    if (url.pathname === "/api/register" && req.method === "POST") {
      return fetch("http://127.0.0.1:3000/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: await req.text()
      });
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      return login(req, env);
    }

    if (url.pathname === "/api/comment" && req.method === "POST") {
      return updateComment(req, env);
    }

    if (url.pathname === "/api/rating") {
      return updateRating(req, env);
    }


    /* ===== 対局待機 WebSocket ===== */
    /* ===== /match = ゲームサーバー WebSocket ===== */
    if (url.pathname === "/match") {
      //const upgrade = req.headers.get("Upgrade");
      //if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      //  return new Response("Expected WebSocket", { status: 400 });
      //}

      const id = env.GAME.idFromName("global");
      const stub = env.GAME.get(id);

      return stub.fetch(req);
    }

    /* ===== 七並べ WebSocket ===== */
    if (url.pathname.startsWith("/room/")) {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 400 });
      }

      const roomId = url.pathname.split("/")[2];
      const id = env.ROOM.idFromName(roomId);
      const room = env.ROOM.get(id);
      return room.fetch(req);
    }

    return new Response("Not Found", { status: 404 });
  }
};

export { ShichinarabeRoom, Matchmaker };
export { GameServer };