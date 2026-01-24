import { hashPassword } from "./password.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonWithCORS(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init.headers || {})
    }
  });
}

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { username, password } = body;

    const hashed = await hashPassword(password);

    const user = await env.DB.prepare(
      "SELECT * FROM users WHERE username=?"
    ).bind(username).first();

    if (!user || user.password !== hashed) {
      return jsonWithCORS(
        { error: "ログイン失敗" },
        { status: 401 }
      );
    }

    return jsonWithCORS({ ok: true, user });

  } catch (e) {
    console.error("LOGIN ERROR:", e);
    return jsonWithCORS(
      { error: "server error" },
      { status: 500 }
    );
  }
}


/* ===== ユーザー情報 ===== */
export async function me(req, env) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const username = req.headers.get("X-USER");

  const user = await env.DB.prepare(
    "SELECT * FROM users WHERE username=?"
  ).bind(username).first();

  return jsonWithCORS(user);
}

/* ===== コメント更新 ===== */
export async function updateComment(req, env) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username, comment } = await req.json();

    if (!username) {
      return jsonWithCORS(
        { error: "username が必要です" },
        { status: 400 }
      );
    }

    await env.DB.prepare(
      "UPDATE users SET comment=? WHERE username=?"
    ).bind(comment, username).run();

    return jsonWithCORS({ ok: true });

  } catch (e) {
    console.error("COMMENT ERROR:", e);
    return jsonWithCORS(
      { error: "コメント保存失敗" },
      { status: 500 }
    );
  }
}

/* ===== レーティング更新 ===== */
export async function updateRating(req, env) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { username, rating } = await req.json();

    if (!username || typeof rating !== "number") {
      return jsonWithCORS(
        { error: "invalid params" },
        { status: 400 }
      );
    }

    await env.DB.prepare(
      "UPDATE users SET rating=? WHERE username=?"
    ).bind(rating, username).run();

    return jsonWithCORS({ ok: true });

  } catch (e) {
    console.error("RATING UPDATE ERROR:", e);
    return jsonWithCORS(
      { error: "db error" },
      { status: 500 }
    );
  }
}