from flask import Flask, request
from flask_socketio import SocketIO, join_room, leave_room, emit
from app.routes import main
from app.database import init_db
import os, threading, time
import random
import uuid

# Flask アプリ作成
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev_secret_key")

# DB 初期化
with app.app_context():
    init_db()

# Blueprint 登録
app.register_blueprint(main)

# SocketIO 初期化
socketio = SocketIO(app, cors_allowed_origins="*")

#socketio = SocketIO(app)
# ----------------------------
# マッチング用の変数
# ----------------------------
waiting_players = []
player_sids = {}
rooms = []
MAX_PLAYERS = 4
WAIT_TIME = 30  # 秒

# ----------------------------
# マッチング関数
# ----------------------------
def broadcast_lobby_count():
    print("count", len(waiting_players))
    print("🔹 ロビーにいるユーザー:", waiting_players)  # デバッグ用

    if len(waiting_players) > 1:
        start_matching()
        print("マッチング開始")
    
    socketio.emit(
        "update_lobby_info",
        {"count": len(waiting_players), "players": waiting_players},
        to=None
    )

def start_matching():
    """30秒経過したらCOMを追加してマッチングを開始"""
    global waiting_players
    #if not waiting_players:
    #    return

    room_id = f"room_{int(time.time())}"
    players = waiting_players[:MAX_PLAYERS]
    #players = waiting_players.copy()

    #while len(players) < MAX_PLAYERS:
    #    players.append(f"COMPUTER_{len(players)+1}")

    
    rooms.append({"id": room_id, "players": players})
    #rooms[room_id] = {"players": players, "hands": {}, "table": {"hearts":[], "spades":[], "diamonds":[], "clubs":[]}}

#waiting_players.clear()

    for p in players:
        if not p.startswith("COMPUTER"):
            sid = player_sids.get(p)
            if sid:
                socketio.emit("match_found", {"room_id": room_id, "players": players}, to=sid)
                print("マッチングしました")
            else:
                print("sidなし")
    #broadcast_lobby_count()
# ----------------------------
# SocketIO イベント
# ----------------------------

@socketio.on("connect")
def handle_connect():
    print("🟢 Client connected")

@socketio.on("join_lobby")
def handle_join(data):
    """ロビー参加時の処理"""
    username = data.get("username")
    sid = request.sid
    player_sids[username] = sid
    print(f"🟢 {username}を入れる。")

    if username not in waiting_players:
        waiting_players.append(username)
        print("waitingに人を入れた")
        print(f"🟢 {username} joined the lobby")

    else:
        print("入れなかった")

    print(f"{username} joined the lobby. 現在の人数: {len(waiting_players)}")
    print(f"🔹 ロビーにいるユーザー: {waiting_players}")

    join_room("lobby")
    socketio.emit(
        "update_lobby_info",
        {"count": len(waiting_players), "players": waiting_players},
        to=None
    )
    # 全員に人数を更新
    broadcast_lobby_count()
    
from flask_socketio import join_room, leave_room, emit

#rooms = {}  # room_id -> {"players": [username], "hands": {username: [cards]}, "table": {...}}


@socketio.on("disconnect")
def handle_disconnect():
    """プレイヤーが離脱"""
    sid = request.sid
    username = None
    # sid -> username の逆引き
    for s, u in player_sids.items():
        if s == sid:
            username = u
            break

    if username:
        print(f"🔴 {username} disconnected")
        if username in waiting_players:
            waiting_players.remove(username)
        player_sids.pop(username, None)

    broadcast_lobby_count()

game_rooms = {}
suits = ["D", "H", "S", "K"]
numbers = list(range(1, 14))
cards = [f"{s}{n}" for s in suits for n in numbers]
def generate_deck():
    suits = ["H", "S", "D", "K"]
    return [f"{s}{i}" for s in suits for i in range(1, 14)] 

#一番最初
@socketio.on("join_game")
def handle_join(data):
    room = data["room"]
    username = data["username"]
    join_room(room)

    # 初期化（部屋が存在しない場合のみ）
    if room not in game_rooms:
        # 山札を作成・シャッフル
        deck = generate_deck()  # 例: ["H1", "H2", ..., "S13"]
        random.shuffle(deck)

        # 各プレイヤーに13枚ずつ配る
        all_hands = [deck[i*13:(i+1)*13] for i in range(4)]

        # 13×4のテーブル（スート別）
        table = {
            "hearts": [None] * 13,
            "spades": [None] * 13,
            "diamonds": [None] * 13,
            "clubs": [None] * 13
        }

        # 部屋の情報を初期化
        game_rooms[room] = {
            "players": [],
            "hands": {},
            "table": table,
            "deck": deck,
            "all_hands": all_hands,
            "turn_order": [],
            "current_turn": None,
            "passes": { "COM1": 0, "COM2": 0 },
            "ranking": [],
            "alive": {}
        }

    room_data = game_rooms[room]
    players = room_data["players"]
    table = room_data["table"]
    turn = room_data["current_turn"]
    

    
    #プレイヤー登録と手札割り当て
    if username not in players:
        players.append(username)
        idx = len(players)-1
        player_hand = room_data["all_hands"][idx]
        room_data["hands"][username] = player_hand
        room_data["passes"][username] = 0
    else:
        player_hand = room_data["hands"][username]

    cpu_names = ["COM1", "COM2"]
    for i, cpu in enumerate(cpu_names):
        if cpu not in room_data["players"]:
            room_data["players"].append(cpu)
            room_data["hands"][cpu] = room_data["all_hands"][room_data["players"].index(cpu)]
            room_data["passes"][cpu] = 0

    for p in game_rooms[room]["players"]:
        game_rooms[room]["alive"][p] = True
        game_rooms[room]["passes"][p] = 0

    print("生き残り : ", game_rooms[room]["alive"])
    print("players : ", players)
    room_data["players"] = players
    suit_map = {"H": "hearts", "S": "spades", "D": "diamonds", "K": "clubs"}

    # 自分の手札から7を探してテーブルに置く
    new_hand = []
    for card in player_hand:
        suit = card[0]  # 例: "H7" → "H"
        num = int(card[1:])

        if num == 7:
            suit_name = suit_map[suit]
            table[suit_name][6] = card  # 7を中央に配置
            print(f"{username} が {card} を中央に配置しました")
        else:
            new_hand.append(card)

    # --- CPU側も7を配置 ---
    for cpu_name in ["COM1", "COM2"]:
        cpu_hand = room_data["hands"][cpu_name]
        new_cpu_hand = []
        for card in cpu_hand:
            suit = card[0]
            num = int(card[1:])
            if num == 7:
                suit_name = suit_map[suit]
                table[suit_name][6] = card
                print(f"{cpu_name} が {card} を中央に配置しました")
            else:
                new_cpu_hand.append(card)
        room_data["hands"][cpu_name] = new_cpu_hand
    
    # 手札更新
    room_data["hands"][username] = new_hand
    
    print("room_data[player] : ", room_data["players"])
    hand_counts = { p: len(room_data["hands"][p]) for p in room_data["players"] }
    #if room_data["current_turn"] is None:
    room_data["turn_order"] = random.sample(room_data["players"], len(room_data["players"]))
    room_data["current_turn"] = room_data["turn_order"][0]
    emit("announce_turn", {"player": room_data["current_turn"], "players": players, "passes": room_data["passes"], "hand_counts": hand_counts }, to=room)
    print(f"先行プレイヤー: {room_data['current_turn']}")
    
    print("turn_order : ", room_data["turn_order"])

    playable_cards = get_playable_cards(new_hand, table)

    print("テーブル : ", table)
    # 状態を全員に共有
    emit("update_table", {"table": table}, to=room)
    emit("update_hand", {"username": username, "hand": new_hand, "playable": playable_cards, "current_turn" : room_data["current_turn"],"passes": room_data["passes"] }, room=room)

    process_turn(room)

#CPUの操作
def process_turn(room):
    room_data = game_rooms[room]
    current = room_data["current_turn"]
    table = room_data["table"]

    # ==== プレイヤーの番ならそのまま待つ ====
    if not current.startswith("COM"):
        return

    hand = room_data["hands"][current]
    playable = get_playable_cards(hand, table)

    if room_data["passes"].get(current, 0) >= 3 and len(playable) == 0:
        eliminate_player(room, current)
        advance_turn(room)
        print("敗北")
        return


    socketio.sleep(1.0)

    if playable:
        card = random.choice(playable)
        print(f"🤖 {current} が {card} を提出します")

        handle_play_card({"username": current, "room": room, "card": card})

        # ✅ 提出後の手札更新を通知
        emit("update_hand", {
            "username": current,
            "hand": room_data["hands"][current],
            "playable": get_playable_cards(room_data["hands"][current], room_data["table"]),
            "current_turn": room_data["current_turn"],
            "passes": room_data["passes"]
        }, to=room)

        broadcast_update_hands(room)
        check_clear(room, current)
        # ✅ テーブル表示更新
        emit("update_table", {"table": room_data["table"]}, to=room)
        hand_counts = { p: len(room_data["hands"][p]) for p in room_data["players"] }

        # ✅ ターン変更アナウンス
        emit("announce_turn", {
            "player": room_data["current_turn"],
            "players": room_data["players"],
            "passes": room_data["passes"],
            "hand_counts": hand_counts 
        }, to=room)

        # ✅ 次もCPUなら続行
        process_turn(room)
        return

    else:
        print(f"🤖 {current} はパスします")
        handle_pass({"username": current, "room": room})
        # ✅ 次もCPUなら続行
        #process_turn(room)

#update_handを全員に送る関数
def broadcast_update_hands(room):
    room_data = game_rooms[room]
    table = room_data["table"]

    for username, hand in room_data["hands"].items():
        playable = get_playable_cards(hand, table)
        emit("update_hand", {
            "username": username,
            "hand": hand,
            "playable": playable,
            "current_turn": room_data["current_turn"],
            "passes": room_data["passes"]
        }, to=room)


#出せるカード
def get_playable_cards(hand, table):
    suit_map = {"H": "hearts", "S": "spades", "D": "diamonds", "K": "clubs"}
    playable = []

    for card in hand:
        suit = suit_map[card[0]]
        num = int(card[1:])  # 1～13
        row = table[suit]    # 例: ['None', ... , 'H7', ...]
        index = num - 1      # 1始まり → 0始まりへ

        if num == 7:
            continue  # 7は既に出してあるので手札には無いはず

        # 8〜13 → 左側（num-2）が埋まっているか
        if num > 7 and row[index - 1] is not None:
            playable.append(card)
            continue

        # 1〜6 → 右側（num）が埋まっているか
        if num < 7 and row[index + 1] is not None:
            playable.append(card)
            continue

    return playable

#ゲーム進行係
@socketio.on("play_card")
def handle_play_card(data):
    username = data["username"]
    room = data["room"]
    card = data["card"]

    room_data = game_rooms[room]
    table = room_data["table"]
    hand = room_data["hands"][username]

    suit_map = {"H": "hearts", "S": "spades", "D": "diamonds", "K": "clubs"}
    suit = suit_map[card[0]]
    num = int(card[1:])
    index = num - 1

    # --- カードを場に置く ---
    table[suit][index] = card

    # --- 手札から削除 ---
    if card in hand:
        hand.remove(card)

    check_clear(room, username)
    # --- 次のターンへ進める ---
    """
    order = list(room_data["alive"].keys())
    current = room_data["current_turn"]
    if current not in order:
        # もし今のプレイヤーがもうaliveにいなければ先頭へ
        room_data["current_turn"] = order[0]
    else:
        next_index = (order.index(current) + 1) % len(order)
        room_data["current_turn"] = order[next_index]
    
    """
    advance_turn(room)
    #next_index = (order.index(current) + 1) % len(order)
    #room_data["current_turn"] = order[next_index]
    print("alive : ", room_data["alive"])
    playable = get_playable_cards(hand, table)
    hand_counts = { p: len(room_data["hands"][p]) for p in room_data["players"] }

    # --- 画面更新を全員に送信 ---
    emit("update_table", {"table": table}, to=room)
    emit("update_hand", {"username": username, "hand": hand, "playable": playable, "passes": room_data["passes"]}, to=room)
    emit("announce_turn", {"player": room_data["current_turn"], "players": room_data["players"], "passes": room_data["passes"], "hand_counts": hand_counts }, to=room)
    broadcast_update_hands(room)
    print(f"{username} が {card} を提出しました → 次は {room_data['current_turn']}")
    process_turn(room)
    #check_elimination(room)

#パス処理
@socketio.on("pass_turn")
def handle_pass(data):
    username = data["username"]
    room = data["room"]
    room_data = game_rooms[room]

    room_data["passes"][username] += 1
    print(f"{username} はパスしました（現在: {room_data['passes'][username]}回）")

    #パス4回死亡
    if room_data["passes"][username] >= 4:
        eliminate_player(room, username)
        hand_counts = { p: len(room_data["hands"][p]) for p in room_data["players"] }

    hand_counts = { p: len(room_data["hands"][p]) for p in room_data["players"] }
    advance_turn(room)
    print("現在の順番 : ", room_data["current_turn"])

    emit("announce_turn", {
        "player": room_data["current_turn"],
        "passes": room_data["passes"],
        "players": room_data["players"],
        "hand_counts": hand_counts  
    }, to=room)
    broadcast_update_hands(room)
    process_turn(room)

#敗北処理
@socketio.on("lose")
def eliminate_player(room, player):
    room_data = game_rooms[room]
    table = room_data["table"]
    hand = room_data["hands"][player]

    print(f"{player} は敗北しました！")

    # 手札を全て場に公開
    suit_map = {"H": "hearts", "S": "spades", "D": "diamonds", "K": "clubs"}
    for card in hand:
        suit = suit_map[card[0]]
        num = int(card[1:])
        index = num - 1
        table[suit][index] = card

    hand.clear()

    room_data["alive"][player] = False
    room_data["ranking"].insert(0, player)

    print("除外, Ranking :", room_data["ranking"])

    

    # もし残り1人なら → ゲーム終了
    alive_players = [p for p, ok in room_data["alive"].items() if ok]
    if len(alive_players) == 1:
        winner = alive_players[0]
        room_data["ranking"].append(winner)  # 最後の1人が優勝
        emit("game_over", {"ranking": room_data["ranking"]}, to=room)
        print("🎉 ゲーム終了:", room_data["ranking"])
        return

    # UI更新
    emit("update_table", {"table": table}, to=room)
    broadcast_update_hands(room)

    emit("update_ranking", {
            "ranks": room_data["ranking"]
        }, to=room)


    # ターン順から除外
    order = room_data["turn_order"]
    if player in order:
        order.remove(player)
    
    # 敗北通知
    emit("player_eliminated", {
        "player": player,
        "rank": len(room_data["ranking"])
    }, to=room)

    advance_turn(room)

#プレーヤー降参
@socketio.on("player_surrender")
def handle_surrender(data):
    username = data["username"]
    room = data["room"]
    eliminate_player(room, username)


#敗北チェック
def check_elimination(room):
    room_data = game_rooms[room]
    current = room_data["current_turn"]

    if room_data["alive"][current] is False:
        return  # 既に脱落済みなら無視

    hand = room_data["hands"][current]
    playable = get_playable_cards(hand, room_data["table"])

    # ✅ 出せるカードが無い → 即敗北
    if len(playable) == 0:
        eliminate_player(room, current)

        # ターンを次の生存者に回す
        alive_order = [p for p in room_data["turn_order"] if room_data["alive"][p]]
        room_data["current_turn"] = alive_order[0]
        hand_counts = { p: len(room_data["hands"][p]) for p in room_data["players"] }

        emit("announce_turn", {
            "player": room_data["current_turn"],
            "players": room_data["players"],
            "passes": room_data["passes"],
            "hand_counts": hand_counts  
        }, to=room)

        process_turn(room)

#勝利判定
def check_clear(room, username):
    room_data = game_rooms[room]

    # すでに脱落・勝利済みなら何もしない
    if not room_data["alive"][username]:
        return

    hand_empty = (len(room_data["hands"][username]) == 0)
    pass_ok = (room_data["passes"].get(username, 0) < 4)

    if hand_empty and pass_ok:
        # ✅ 勝利確定
        room_data["alive"][username] = False
        room_data["ranking"].append(username)
        print(f"✅ {username} がクリア！（順位: {len(room_data['rankings'])} 位）")

        emit("player_cleared", {
            "username": username,
            "rank": len(room_data["ranking"]),
        }, to=room)

        emit("update_ranking", {
            "ranks": room_data["ranking"]
        }, to=room)

        # ✅ 次のプレイヤーにターン回す
        advance_turn(room)
    
def advance_turn(room):
    room_data = game_rooms[room]

    # --- 生存者リストを作成 ---
    alive_players = [p for p in room_data["turn_order"] if room_data["alive"].get(p, False)]

    if not alive_players:
        print(f"[DEBUG] 全員死亡 or ゲーム終了 room={room}")
        return

    current = room_data.get("current_turn")

    # --- current_turn が生存者でなければ、先頭の生存者に ---
    if current not in alive_players:
        room_data["current_turn"] = alive_players[0]
    else:
        idx = alive_players.index(current)
        room_data["current_turn"] = alive_players[(idx + 1) % len(alive_players)]

    hand_counts = { p: len(room_data["hands"][p]) for p in room_data["players"] }

    # --- UI更新 ---
    emit("announce_turn", {
        "player": room_data["current_turn"],
        "players": room_data["players"],  # players は固定
        "passes": room_data["passes"],
        "hand_counts": hand_counts
    }, to=room)

    broadcast_update_hands(room)

    # --- 次が CPU なら自動進行 ---
    current_player = room_data["current_turn"]
    if current_player.startswith("COM"):
        socketio.sleep(0.5)  # 少し待機してから CPU 処理
        process_turn(room)

@socketio.on("leave_lobby")
def handle_leave(data):
    """ロビー退出時の処理"""
    username = data.get("username")
    if username in waiting_players:
        waiting_players.remove(username)
        print(f"{username} left the lobby. 現在の人数: {len(waiting_players)}")
        broadcast_lobby_count()

@socketio.on("start_match")
def handle_start():
    """4人揃ったら自動でゲーム開始"""
    if len(waiting_players) >= 4:
        selected_players = waiting_players[:4]
        print("対局開始:", selected_players)

        # 残りの人をロビーに残す
        del waiting_players[:4]

        # 全員にゲーム開始通知
        socketio.emit("match_started", {"players": selected_players}, namespace="/")

        # 人数更新（残りのロビー人数を送信）
        broadcast_lobby_count()

# ----------------------------
# Render/Gunicorn 実行
# ----------------------------
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
