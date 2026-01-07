export class ShichinarabeGame {
  constructor(humanPlayers, maxPlayers) {
    this.players = [...humanPlayers];
    this.turnIndex = 0;

    this.hands = {};
    this.passes = {};
    this.ranks = [];
    this.dead = new Set();

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
      const suit = this.suitName(card[0]);
      const idx = Number(card.slice(1)) - 1;

      if (idx === 6) return true;
      if (idx > 0 && this.table[suit][idx - 1]) return true;
      if (idx < 12 && this.table[suit][idx + 1]) return true;
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
      this.ranks.push(name);
      this.players = this.players.filter(p => p !== name);

      if (this.players.length > 0) {
        this.turnIndex %= this.players.length;
      }
      //this.broadcast();
      return;
    }

    this.nextTurn();
    //this.broadcast();
  }


  pass(name) {
    this.passes[name]++;
    const playable = this.getPlayable(name);

    if (this.passes[name] >= 3 && playable.length === 0) {
      this.die(name);
      return;
    }

    this.nextTurn();
  }

  //降参
  resign(name) {
    //const playable = this.getPlayable(name);

    //if (playable.length > 0) return;

    this.passes[name] = 3;
    this.die(name);
  }

  die(name) {
    // ① 持っているカードをすべてテーブルへ
    for (const card of this.hands[name]) {
      const suit = this.suitName(card[0]);
      const idx = Number(card.slice(1)) - 1;
      this.table[suit][idx] = card;
    }
    this.hands[name] = [];

    // ② 最下位として順位確定
    this.ranks.unshift(name); // ★ 最下位に追加

    // ③ プレイヤーから除外
    const deadIndex = this.players.indexOf(name);
    this.players = this.players.filter(p => p !== name);
    this.dead.add(name);

    // ④ ターン調整
    if (this.players.length > 0) {
      if (deadIndex <= this.turnIndex) {
        this.turnIndex--;
      }
      this.turnIndex = (this.turnIndex + this.players.length) % this.players.length;
    }

    // ⑤ 全体更新
    //this.broadcast();
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
