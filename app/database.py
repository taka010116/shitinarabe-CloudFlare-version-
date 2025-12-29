import sqlite3

DB_NAME = "users.db"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row  # 結果を辞書形式で扱える
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            avatar TEXT DEFAULT '(´・ω・`)',     -- アバター
            bio TEXT DEFAULT '',                   -- 自己紹介文（最大100文字）
            wins INTEGER DEFAULT 0,                -- 勝ち数
            losses INTEGER DEFAULT 0,              -- 負け数
            draws INTEGER DEFAULT 0,               -- 引き分け数
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()
    print("✅ users テーブルを作成または確認しました")
    