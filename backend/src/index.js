import { ShichinarabeRoom } from "./room.js";
import { register, login, updateComment } from "./auth/auth.js";
import { Matchmaker } from "./matchmaker.js";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    /* ===== 静的HTML ===== */
    if (
      url.pathname === "/" ||
      url.pathname === "/login.html" ||
      url.pathname === "/register.html" ||
      url.pathname === "/profile.html"
    ) {
      return env.ASSETS.fetch(req);
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
    /* ===== マッチング ===== */
    if (url.pathname === "/match") {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 400 });
      }

      const id = env.MATCH.idFromName("global");
      return env.MATCH.get(id).fetch(req);
    } 

    /* ===== 七並べ WebSocket ===== */
    if (url.pathname.startsWith("/room/")) {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 400 });
      }

      const roomId = url.pathname.split("/")[2];
      const id = env.ROOM.idFromName(roomId);
      return env.ROOM.get(id).fetch(req);
    }

    return new Response("Not Found", { status: 404 });
  }
};

export { ShichinarabeRoom };
export { Matchmaker };
