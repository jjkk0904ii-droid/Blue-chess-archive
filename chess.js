// 체스 규칙 엔진 (체크/체크메이트/캐슬링/앙파상/프로모션/무승부 판정 포함)
// 좌표: sq = r*8 + c, r=0 은 1랭크(백 진영), c=0 은 a파일
export const sqName = (sq) => 'abcdefgh'[sq % 8] + (Math.floor(sq / 8) + 1);

const KN = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
const KG = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const DG = [[1,1],[1,-1],[-1,1],[-1,-1]];
const OR = [[1,0],[-1,0],[0,1],[0,-1]];
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const other = (c) => (c === 'w' ? 'b' : 'w');

export function newGame() {
  const b = new Array(64).fill(null);
  const back = ['R','N','B','Q','K','B','N','R'];
  for (let c = 0; c < 8; c++) {
    b[c] = 'w' + back[c]; b[8 + c] = 'wP';
    b[48 + c] = 'bP';     b[56 + c] = 'b' + back[c];
  }
  return { b, turn: 'w', castle: { wK: true, wQ: true, bK: true, bQ: true }, ep: -1, half: 0, full: 1 };
}

export function attacked(b, sq, by) {
  const r = Math.floor(sq / 8), c = sq % 8;
  const pr = by === 'w' ? r - 1 : r + 1;
  for (const dc of [-1, 1]) if (inB(pr, c + dc) && b[pr * 8 + c + dc] === by + 'P') return true;
  for (const [dr, dc] of KN) if (inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'N') return true;
  for (const [dr, dc] of KG) if (inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'K') return true;
  const ray = (dirs, a, q) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc)) {
        const p = b[rr * 8 + cc];
        if (p) { if (p[0] === by && (p[1] === a || p[1] === q)) return true; break; }
        rr += dr; cc += dc;
      }
    }
    return false;
  };
  return ray(DG, 'B', 'Q') || ray(OR, 'R', 'Q');
}

const kingSq = (b, color) => b.indexOf(color + 'K');
export const inCheck = (s, color = s.turn) => attacked(s.b, kingSq(s.b, color), other(color));

function pseudo(s) {
  const { b, turn: me, castle, ep } = s;
  const out = [];
  const add = (from, to, extra = {}) => out.push({ from, to, piece: b[from], cap: b[to], ...extra });
  const dir = me === 'w' ? 1 : -1, startR = me === 'w' ? 1 : 6, promoR = me === 'w' ? 7 : 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p || p[0] !== me) continue;
    const t = p[1], r = Math.floor(sq / 8), c = sq % 8;
    if (t === 'P') {
      const push = (to, extra) => {
        if (Math.floor(to / 8) === promoR) for (const pr of ['Q','R','B','N']) add(sq, to, { ...extra, promo: pr });
        else add(sq, to, extra);
      };
      const f = (r + dir) * 8 + c;
      if (!b[f]) {
        push(f);
        if (r === startR && !b[f + dir * 8]) add(sq, f + dir * 8, { dbl: true });
      }
      for (const dc of [-1, 1]) {
        const nc = c + dc; if (nc < 0 || nc > 7) continue;
        const to = (r + dir) * 8 + nc;
        if (b[to] && b[to][0] !== me) push(to);
        else if (to === ep) add(sq, to, { ep: true, epCap: r * 8 + nc, cap: b[r * 8 + nc] });
      }
    } else if (t === 'N' || t === 'K') {
      for (const [dr, dc] of (t === 'N' ? KN : KG)) {
        const rr = r + dr, cc = c + dc; if (!inB(rr, cc)) continue;
        const q = b[rr * 8 + cc];
        if (!q || q[0] !== me) add(sq, rr * 8 + cc);
      }
      if (t === 'K') {
        const base = me === 'w' ? 0 : 56;
        if (sq === base + 4 && !attacked(b, sq, other(me))) {
          if (castle[me + 'K'] && !b[base + 5] && !b[base + 6] && b[base + 7] === me + 'R' &&
              !attacked(b, base + 5, other(me)) && !attacked(b, base + 6, other(me)))
            add(sq, base + 6, { castle: 'K', rookFrom: base + 7, rookTo: base + 5 });
          if (castle[me + 'Q'] && !b[base + 1] && !b[base + 2] && !b[base + 3] && b[base] === me + 'R' &&
              !attacked(b, base + 3, other(me)) && !attacked(b, base + 2, other(me)))
            add(sq, base + 2, { castle: 'Q', rookFrom: base, rookTo: base + 3 });
        }
      }
    } else {
      const dirs = t === 'B' ? DG : t === 'R' ? OR : KG;
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inB(rr, cc)) {
          const q = b[rr * 8 + cc];
          if (!q) add(sq, rr * 8 + cc);
          else { if (q[0] !== me) add(sq, rr * 8 + cc); break; }
          rr += dr; cc += dc;
        }
      }
    }
  }
  return out;
}

export function apply(s, m) {
  const b = s.b.slice();
  const me = s.turn;
  const castle = { ...s.castle };
  b[m.from] = null;
  if (m.ep) b[m.epCap] = null;
  b[m.to] = m.promo ? me + m.promo : m.piece;
  if (m.castle) { b[m.rookTo] = b[m.rookFrom]; b[m.rookFrom] = null; }
  if (m.piece[1] === 'K') { castle[me + 'K'] = false; castle[me + 'Q'] = false; }
  const corner = { 0: 'wQ', 7: 'wK', 56: 'bQ', 63: 'bK' };
  if (corner[m.from]) castle[corner[m.from]] = false;
  if (corner[m.to]) castle[corner[m.to]] = false;
  return {
    b, turn: other(me), castle,
    ep: m.dbl ? (m.from + m.to) / 2 : -1,
    half: (m.piece[1] === 'P' || m.cap) ? 0 : s.half + 1,
    full: s.full + (me === 'b' ? 1 : 0),
  };
}

export function legalMoves(s) {
  return pseudo(s).filter((m) => {
    const n = apply(s, m);
    return !attacked(n.b, kingSq(n.b, s.turn), n.turn);
  });
}

export function status(s) {
  const moves = legalMoves(s);
  const chk = inCheck(s);
  if (!moves.length) return chk ? { over: true, result: 'checkmate', winner: other(s.turn) } : { over: true, result: 'stalemate' };
  if (s.half >= 100) return { over: true, result: 'fifty' };
  const rest = s.b.filter(Boolean).filter((p) => p[1] !== 'K');
  if (rest.length === 0 || (rest.length === 1 && 'BN'.includes(rest[0][1]))) return { over: true, result: 'insufficient' };
  return { over: false, check: chk };
}

// ---- 간단한 AI (알파-베타) ----
const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
function evaluate(s) {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s.b[sq]; if (!p) continue;
    const r = Math.floor(sq / 8), c = sq % 8;
    const rr = p[0] === 'w' ? r : 7 - r;
    const centre = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5)) / 1;
    let v = VAL[p[1]];
    if (p[1] === 'P') v += rr * 8 + (c > 1 && c < 6 ? 4 : 0);
    else if (p[1] === 'N' || p[1] === 'B') v += centre * 6;
    else if (p[1] === 'Q') v += centre * 1;
    score += p[0] === 'w' ? v : -v;
  }
  return score;
}
function order(ms) {
  return ms.sort((a, b) =>
    ((b.cap ? VAL[b.cap[1]] * 10 - VAL[b.piece[1]] : 0) + (b.promo ? 800 : 0)) -
    ((a.cap ? VAL[a.cap[1]] * 10 - VAL[a.piece[1]] : 0) + (a.promo ? 800 : 0)));
}
function search(s, depth, alpha, beta) {
  const ms = legalMoves(s);
  if (!ms.length) return inCheck(s) ? (s.turn === 'w' ? -99999 - depth : 99999 + depth) : 0;
  if (depth === 0) return evaluate(s);
  order(ms);
  if (s.turn === 'w') {
    let best = -Infinity;
    for (const m of ms) { best = Math.max(best, search(apply(s, m), depth - 1, alpha, beta)); alpha = Math.max(alpha, best); if (alpha >= beta) break; }
    return best;
  }
  let best = Infinity;
  for (const m of ms) { best = Math.min(best, search(apply(s, m), depth - 1, alpha, beta)); beta = Math.min(beta, best); if (alpha >= beta) break; }
  return best;
}
export function bestMove(s, depth = 2) {
  const ms = order(legalMoves(s));
  if (!ms.length) return null;
  let best = null, bv = s.turn === 'w' ? -Infinity : Infinity;
  for (const m of ms) {
    const v = search(apply(s, m), depth - 1, -Infinity, Infinity) + Math.random() * 6;
    if (s.turn === 'w' ? v > bv : v < bv) { bv = v; best = m; }
  }
  return best;
}
