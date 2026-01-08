export class ShichinarabeGame {
  constructor(humanPlayers, maxPlayers) {
    this.players = [...humanPlayers];
    this.turnIndex = 0;

    this.hands = {};
    this.passes = {};
    this.ranks = [];
    this.dead = new Set();
    this.rankSlots = new Array(this.players.length).fill(null);
    this.rankTop = 0;
    this.rankBottom = this.players.length - 1;

    this.table = {
      hearts: Array(13).fill(null),
      spades: Array(13).fill(null),
      diamonds: Array(13).fill(null),
      clubs: Array(13).fill(null),
    };

    this.initGame();
  }

  /* ================= 初期化 ================= */

  initGame() {
    const deck = [];
    const suits = ["H", "S", "D", "K"];

    for (const s of suits) {
      for (let n = 1; n <= 13; n++) {
        deck.push(s + n);
      }
    }

    deck.sort(() => Math.random() - 0.5);

    this.players.forEach(p => {
      this.hands[p] = [];
      this.passes[p] = 0;
    });

    this.players.forEach((p, i) => {
      this.hands[p] = deck.slice(i * 13, (i + 1) * 13);
    });

    // 7を即出し
    for (const p of this.players) {
      this.hands[p] = this.hands[p].filter(card => {
        const suit = this.suitName(card[0]);
        const num = Number(card.slice(1));
        if (num === 7) {
          this.table[suit][6] = card;
          return false;
        }
        return true;
      });
    }
  }

  /* ================= 基本 ================= */

  suitName(s) {
    return { H: "hearts", S: "spades", D: "diamonds", K: "clubs" }[s];
  }

  currentPlayer() {
    return this.players[this.turnIndex];
  }

  /* ================= 判定 ================= */

  getPlayable(name) {
    return this.hands[name].filter(card => {
      const suit = this.suitName(card[0]); // hearts / spades / diamonds / clubs
      const idx = Number(card.slice(1)) - 1; // A=0 ... K=12
    const row = this.table[suit];

      // ① そのスートの7は常に出せる
      if (idx === 6) return true;
      // ② 7がまだ出ていないスートは何も出せない
      if (!row[6]) return false;

      // ③ 7から左側（A方向）の連続区間を調べる
      let left = 6;
      while (left > 0 && row[left - 1]) {
        left--;
      }

    // ④ 7から右側（K方向）の連続区間を調べる
      let right = 6;
      while (right < 12 && row[right + 1]) {
        right++;
     }

    // ⑤ 連続区間の「すぐ外側」だけ出せる
      if (idx === left - 1) return true;
      if (idx === right + 1) return true;

     return false;
    });
  }


  /* ================= 操作 ================= */

  playCard(name, card) {
    const suit = this.suitName(card[0]);
    const idx = Number(card.slice(1)) - 1;

    this.table[suit][idx] = card;
    this.hands[name] = this.hands[name].filter(c => c !== card);

  // 上がり
    if (this.hands[name].length === 0) {
      this.die(name, "winner");
      //this.broadcast();
      return;
    }

    this.nextTurn();
    //this.broadcast();
  }


  pass(name) {
    this.passes[name]++;
    const playable = this.getPlayable(name);

    if (this.passes[name] >= 3 ) {
      this.die(name, "lose");
      return;
    }

    this.nextTurn();
  }

  finalizeLastPlayer(name) {
    //if (this.rankSlots.includes(name)) return;

    // 空いている順位に入れる
    this.rankSlots[this.rankTop] = name;
    this.rankTop++;

    // ゲーム完全終了
    //this.players = [];
  } 

  //降参
  resign(name) {
    //const playable = this.getPlayable(name);

    //if (playable.length > 0) return;

    this.passes[name] = 3;
    this.die(name, "lose");
  }

  //die案2
  die(name, type) {
  // 念のため二重死亡防止
    if (!this.players.includes(name)) return;
    const deadIndex = this.players.indexOf(name);
    // ① 手札をすべてテーブルへ
    for (const card of this.hands[name]) {
      const suit = this.suitName(card[0]);
      const idx = Number(card.slice(1)) - 1;
      this.table[suit][idx] = card;
    }
    this.hands[name] = [];

    if(type === "winner"){
      //this.ranks.unshift(name);
      this.rankSlots[this.rankTop++] = name;
    }else{
      this.rankSlots[this.rankBottom--] = name;
      //this.ranks.push(name);
    }

    this.dead.add(name);
    // ④ players から削除
    this.players.splice(deadIndex, 1);

    // ⑤ turnIndex を「その位置」に合わせるだけ
    if (this.players.length === 0) {
      this.turnIndex = 0;
      //return;
    }

    // ★ 死亡者が「今のターンより前」にいた場合だけ -1
    if (deadIndex < this.turnIndex) {
        this.turnIndex--;
    }

    // ★ 範囲保証
    this.turnIndex %= this.players.length;
    //this.turnIndex = (this.turnIndex + 1) % this.players.length;

  }

  nextTurn() {
    if (this.players.length === 0) return;
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
  }


  processCOM(callback) {
    const p = this.currentPlayer();
    if (!p || !p.startsWith("COM")) return;

    const playable = this.getPlayable(p);

    setTimeout(() => {
      if (playable.length > 0) {
        const card = playable[Math.floor(Math.random() * playable.length)];
        this.playCard(p, card);
      } else {
        this.pass(p);
      }
      callback();
    }, 800);
  }
}
