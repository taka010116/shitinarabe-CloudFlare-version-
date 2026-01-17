import { ShichinarabeRoom } from "./room.js";
import { Matchmaker } from "./matchmaker.js";
import { register, login, updateComment } from "./auth/auth.js";

const matchmaker = new Matchmaker();

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    /* ===== ヘルスチェック ===== */
    if (url.pathname === "/") {
      return new Response("Backend Alive", { status: 200 });
    }

    /* ===== 認証 API ===== */
    if (url.pathname === "/api/register" && req.method === "POST") {
      return register(req, env);
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      return login(req, env);
    }

    if (url.pathname === "/api/comment" && req.method === "POST") {
      return updateComment(req, env);
    }

    /* ===== 対局待機 WebSocket ===== */
    if (url.pathname === "/match") {
      return matchmaker.fetch(req);
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
