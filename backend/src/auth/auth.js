import { hashPassword } from "./password.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* ===== 登録 ===== */
export async function register(req, env) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return Response.json(
        { error: "username と password は必須です" },
        { status: 400, headers: corsHeaders }
      );
    }

    const hashed = await hashPassword(password);

    await env.DB.prepare(
      "INSERT INTO users (username, password) VALUES (?, ?)"
    ).bind(username, hashed).run();

    return Response.json(
      { ok: true },
      { headers: corsHeaders }
    );

  } catch (e) {
    console.error("REGISTER ERROR:", e);
    return Response.json(
      { error: "登録失敗" },
      { status: 500, headers: corsHeaders }
    );
  }
}

/* ===== ログイン ===== */
export async function login(req, env) {
  try {
    const body = await req.json();
    console.log("LOGIN BODY:", body);

    const { username, password } = body;
    const hashed = await hashPassword(password);
    console.log("HASH:", hashed);

    const user = await env.DB.prepare(
      "SELECT * FROM users WHERE username=?"
    ).bind(username).first();

    console.log("DB USER:", user);

    if (!user || user.password !== hashed) {
      return Response.json({ error: "ログイン失敗" }, { status: 401 });
    }

    return Response.json({ ok: true, user });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}


/* ===== ユーザー情報 ===== */
export async function me(req, env) {
  const username = req.headers.get("X-USER");

  const user = await env.DB.prepare(
    "SELECT * FROM users WHERE username=?"
  ).bind(username).first();

  return Response.json(user);
}

/* ===== コメント更新 ===== */
export async function updateComment(req, env) {
  try {
    const { username, comment } = await req.json();

    if (!username) {
      return Response.json(
        { error: "username が必要です" },
        { status: 400 }
      );
    }

    await env.DB.prepare(
      "UPDATE users SET comment=? WHERE username=?"
    ).bind(comment, username).run();

    return Response.json({ ok: true });

  } catch (e) {
    console.error("COMMENT ERROR:", e);
    return Response.json(
      { error: "コメント保存失敗" },
      { status: 500 }
    );
  }
}
