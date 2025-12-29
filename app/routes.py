from flask import Flask, Blueprint, render_template, request, redirect, url_for, flash, session
#from app.database import get_db, init_db
from werkzeug.security import generate_password_hash, check_password_hash
from flask_socketio import SocketIO, join_room, emit
import os#, sqlite3, time, threading
import time, threading
import psycopg2
from werkzeug.security import generate_password_hash
from werkzeug.security import check_password_hash
import eventlet
eventlet.monkey_patch()

# Flaskアプリを先に作る
#app = Flask(__name__)
#app.secret_key = os.environ.get("SECRET_KEY", "dev_secret_key")

# SocketIOの初期化
#socketio = SocketIO(app, cors_allowed_origins="*")

main = Blueprint("main", __name__, template_folder="templates")

app = Flask(__name__)
app.secret_key = "secret-key"  #セッション用キー

#DATABASE_URL = "postgresql://takanami:NknWfypeq70O4aKab0tHZTXXKdGsJz3b@dpg-d3u927uuk2gs73dm85kg-a.oregon-postgres.render.com/mydb_6t0u"
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres.tnoxdkuuccvreofmqsjn:taka0101@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"
)
#
def get_db_connection():
    conn = psycopg2.connect(DATABASE_URL, sslmode="require")
    print("getDB")
    return conn


@main.route("/")
def index():
    return render_template("index.html")

if not os.path.exists("users.db"):
    print("🗂 users.db が存在しないため作成します...")
    init_db()
else:
    print("✅ users.db は既に存在します")

@main.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]

        conn = get_db_connection()
        cur = conn.cursor()

        #同名ユーザーの存在確認
        cur.execute("SELECT * FROM users WHERE username = %s;", (username,))
        existing_user = cur.fetchone()

        if existing_user:
            flash("このユーザー名はすでに使われています。")
        else:
            hashed_password = generate_password_hash(password)

            cur.execute("INSERT INTO users (username, password) VALUES (%s, %s);", (username, hashed_password))
            conn.commit()
            flash("登録が完了しました")
            cur.close()
            conn.close()
            return redirect(url_for("main.login"))

        cur.close()
        conn.close()

    return render_template("register.html")

@main.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE username = %s;", (username,))
        user = cur.fetchone()
        cur.close()
        conn.close()
        if user:
            stored_hash = user[2]
            if check_password_hash(stored_hash, password):
                flash(f"ようこそ、{username}さん！")
                session["username"] = username
                return redirect(url_for("main.account"))
            else:
                flash("パスワードが違います。")
        else:
            flash("ユーザー名が存在しません。")
        
    return render_template("login.html")

@main.route('/account')
def account():
    if 'username' not in session:
        flash('ログインしてください。')
        return redirect(url_for('login'))

    username = session['username']

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT username, avatar, bio, wins, losses, draws
        FROM users WHERE username = %s
    """, (username,))
    user = cur.fetchone()
    cur.close()
    conn.close()

    if not user:
        flash('ユーザー情報が見つかりません。')
        return redirect(url_for('login'))

    return render_template('account.html',
                           username=user[0],
                           avatar=user[1],
                           bio=user[2],
                           wins=user[3],
                           losses=user[4],
                           draws=user[5])

@main.route("/account/update", methods=["POST"])
def update_account():
    if "username" not in session:
        flash("ログインしてください")
        return redirect(url_for("main.login"))

    username = session["username"]
    new_bio = request.form.get("bio", "")
    new_avatar = request.form.get("avatar", "(´・ω・`)")

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE users SET bio=%s, avatar=%s WHERE username=%s;", (new_bio, new_avatar, username))
    conn.commit()
    cur.close()
    conn.close()

    flash("アカウント情報を更新しました")
    return redirect(url_for("main.account"))

@main.route("/account/delete", methods=["POST"])
def delete_account():
    if "username" not in session:
        flash("ログインしてください")
        return redirect(url_for("main.login"))

    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM users WHERE id=?", (session["user_id"],))
    conn.commit()
    conn.close()

    session.clear()
    flash("アカウントを削除しました")
    return redirect(url_for("main.register"))


@main.route("/lobby")
def lobby():
    if "username" not in session:
        flash("ログインしてください")
        return redirect(url_for("main.lobby"))

    return render_template("lobby.html")  # ロビー画面

#ここからゲーム
@main.route("/game")
def game():
    room_id = request.args.get("room_id")
    username = session.get("username")
    return render_template("game.html", room_id=room_id, username=username)

# ----------------------------
# ロビーのSocketIO機能
# ----------------------------

# ----------------------------
# Blueprint登録
# ----------------------------
#app.register_blueprint(main)

# ----------------------------
# Render実行エントリポイント
# ----------------------------
if __name__ == "__main__":
    init_db()
    #socketio.run(app, host="0.0.0.0", port=10000, debug=True)
