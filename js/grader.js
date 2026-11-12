// Stroke-level grading against KanjiVG reference strokes.
//
// 1. The drawing is aligned to the reference box (bounding box, then a least-squares
//    fit on matched strokes), so size and placement on the pad don't matter.
// 2. Every drawn stroke is compared with every reference stroke (resampled to 32 points;
//    distance mixes position and shape, in KanjiVG's 109-unit box).
// 3. An order-preserving alignment is compared with the best free assignment. If the free
//    assignment is clearly better, strokes were written out of order.
// 4. Each matched stroke is checked for direction and shape quality; recognition by
//    KanjiCanvas is folded in as a legibility check.

const N = 32;

export const STRICTNESS = {
  lenient: { good: 5.5, bad: 20, order: 8, label: 'Lenient' },
  normal: { good: 4, bad: 16, order: 6, label: 'Normal' },
  strict: { good: 3, bad: 12, order: 4, label: 'Strict' },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function resample(pts, n = N) {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => [...pts[0]]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: n }, () => [...pts[0]]);
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = (total * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < t) j++;
    const seg = cum[j + 1] - cum[j];
    const u = seg > 0 ? (t - cum[j]) / seg : 0;
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
  }
  return out;
}

export function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

function bbox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) for (const [x, y] of s) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function transformStrokes(strokes, t) {
  return strokes.map((s) => s.map(([x, y]) => [x * t.sx + t.tx, y * t.sy + t.ty]));
}

function bboxTransform(user, ref) {
  const bu = bbox(user), br = bbox(ref);
  const su = bu.w + bu.h, sr = br.w + br.h;
  const s = su > 1e-6 ? clamp(sr / su, 0.15, 8) : 1;
  return { sx: s, sy: s, tx: br.cx - bu.cx * s, ty: br.cy - bu.cy * s };
}

/** Least-squares per-axis scale + translation mapping matched user points onto reference points. */
function fitTransform(pairs, U, R, fallback) {
  const us = [], rs = [];
  for (const [i, j, rev] of pairs) {
    const r = rev ? [...R[j]].reverse() : R[j];
    for (let k = 0; k < N; k++) { us.push(U[i][k]); rs.push(r[k]); }
  }
  if (us.length < N) return fallback;
  const m = (arr, a) => arr.reduce((s, p) => s + p[a], 0) / arr.length;
  const ux = m(us, 0), uy = m(us, 1), rx = m(rs, 0), ry = m(rs, 1);
  let cxx = 0, vxx = 0, cyy = 0, vyy = 0;
  for (let k = 0; k < us.length; k++) {
    cxx += (us[k][0] - ux) * (rs[k][0] - rx); vxx += (us[k][0] - ux) ** 2;
    cyy += (us[k][1] - uy) * (rs[k][1] - ry); vyy += (us[k][1] - uy) ** 2;
  }
  // Uniform scale from both axes, then allow a limited per-axis correction so that
  // genuine proportion mistakes still show up.
  const s = vxx + vyy > 1e-6 ? (cxx + cyy) / (vxx + vyy) : 1;
  if (!(s > 0.1 && s < 10)) return fallback;
  let sx = vxx > 25 ? cxx / vxx : s;
  let sy = vyy > 25 ? cyy / vyy : s;
  sx = clamp(sx, s * 0.85, s * 1.18);
  sy = clamp(sy, s * 0.85, s * 1.18);
  return { sx, sy, tx: rx - sx * ux, ty: ry - sy * uy };
}

function centroid(a) {
  let x = 0, y = 0;
  for (const p of a) { x += p[0]; y += p[1]; }
  return [x / a.length, y / a.length];
}

/** Distance between two resampled strokes: half absolute position, half shape. */
function strokeDistance(a, b) {
  const ca = centroid(a), cb = centroid(b);
  let pos = 0, shape = 0;
  for (let k = 0; k < N; k++) {
    pos += Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]);
    shape += Math.hypot(a[k][0] - ca[0] - (b[k][0] - cb[0]), a[k][1] - ca[1] - (b[k][1] - cb[1]));
  }
  return (0.5 * pos + 0.5 * shape) / N;
}

/** Hungarian algorithm (square matrix), returns column index for each row. */
function hungarian(a) {
  const n = a.length;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const rowToCol = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

/** Best one-to-one matching, ignoring order. Unmatched strokes cost `skip`. */
function freeMatch(C, nU, nR, skip) {
  const S = nU + nR;
  const big = 1e9;
  const a = Array.from({ length: S }, (_, i) =>
    Array.from({ length: S }, (_, j) => {
      if (i < nU && j < nR) return C[i][j];
      if (i < nU || j < nR) return skip;
      return 0;
    }));
  const rowToCol = hungarian(a);
  const pairs = [];
  let cost = 0;
  for (let i = 0; i < S; i++) {
    const j = rowToCol[i];
    cost += i < nU && j < nR ? C[i][j] : i < nU || j < nR ? skip : 0;
    if (i < nU && j < nR) pairs.push([i, j]);
  }
  if (!Number.isFinite(cost) || cost >= big) return { pairs: [], cost: Infinity };
  return { pairs, cost };
}

/** Best matching that keeps drawing order (an alignment, like edit distance). */
function orderedMatch(C, nU, nR, skip) {
  const dp = Array.from({ length: nU + 1 }, () => new Array(nR + 1).fill(0));
  const bt = Array.from({ length: nU + 1 }, () => new Array(nR + 1).fill(0));
  for (let i = 1; i <= nU; i++) { dp[i][0] = i * skip; bt[i][0] = 1; }
  for (let j = 1; j <= nR; j++) { dp[0][j] = j * skip; bt[0][j] = 2; }
  for (let i = 1; i <= nU; i++) {
    for (let j = 1; j <= nR; j++) {
      const m = dp[i - 1][j - 1] + C[i - 1][j - 1];
      const su = dp[i - 1][j] + skip;
      const sr = dp[i][j - 1] + skip;
      if (m <= su && m <= sr) { dp[i][j] = m; bt[i][j] = 0; }
      else if (su <= sr) { dp[i][j] = su; bt[i][j] = 1; }
      else { dp[i][j] = sr; bt[i][j] = 2; }
    }
  }
  const pairs = [];
  let i = nU, j = nR;
  while (i > 0 || j > 0) {
    const b = bt[i][j];
    if (i > 0 && j > 0 && b === 0) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (i > 0 && (b === 1 || j === 0)) i--;
    else j--;
  }
  pairs.reverse();
  return { pairs, cost: dp[nU][nR] };
}

/**
 * Indices (into seq) of a longest strictly increasing subsequence. Ties prefer keeping
 * elements already at their expected position (seq[k] === k), so the strokes reported
 * as out of order are the ones that actually moved.
 */
function lisIndices(seq) {
  const n = seq.length;
  const best = new Array(n).fill(0), prev = new Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    const w = 1 + (seq[k] === k ? 0.01 : 0);
    best[k] = w;
    for (let p = 0; p < k; p++) {
      if (seq[p] < seq[k] && best[p] + w > best[k]) { best[k] = best[p] + w; prev[k] = p; }
    }
  }
  let k = best.indexOf(Math.max(...best));
  const out = new Set();
  while (k >= 0) { out.add(k); k = prev[k]; }
  return out;
}

const DIRECTION_TWINS = ['シツソン', 'ノヽ', 'くへ'];

const DIRECTIONS = [
  'left to right', 'down and to the right', 'top to bottom', 'down and to the left',
  'right to left', 'up and to the left', 'bottom to top', 'up and to the right',
];

export function directionWord(pts) {
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[pts.length - 1];
  const ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  return DIRECTIONS[((Math.round(ang / 45) % 8) + 8) % 8];
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function matchAll(U, R, nU, nR, L, refLen, userLen) {
  const fwd = [], rev = [], C = [];
  for (let i = 0; i < nU; i++) {
    fwd.push([]); rev.push([]); C.push([]);
    const ur = [...U[i]].reverse();
    for (let j = 0; j < nR; j++) {
      const f = strokeDistance(U[i], R[j]);
      const r = strokeDistance(ur, R[j]);
      fwd[i].push(f); rev[i].push(r);
      // Penalise big length mismatches so a short tick can't stand in for a long stroke.
      const lr = Math.max(refLen[j], userLen[i], 1) / Math.max(Math.min(refLen[j], userLen[i]), 1);
      C[i].push(Math.min(f, r) * (lr > 2.2 ? 1 + 0.25 * (lr - 2.2) : 1));
    }
  }
  const skip = L.bad * 1.25;
  const free = freeMatch(C, nU, nR, skip);
  const ordered = orderedMatch(C, nU, nR, skip);
  const inOrder = ordered.cost <= free.cost + L.order;
  return { fwd, rev, C, free, ordered, inOrder, pairs: inOrder ? ordered.pairs : free.pairs };
}

/**
 * Grade one attempt.
 * @param {object} o
 * @param {number[][][]} o.userStrokes  drawn strokes in pad units (0..109)
 * @param {object} o.glyph              from strokes.getGlyph()
 * @param {string} [o.strictness]
 * @param {number} [o.hints]            how many stroke hints were shown
 * @param {boolean} [o.gaveUp]
 * @param {{candidates:[string,number][], rank:number}|null} [o.recognition]
 * @param {number|null} [o.thinkMs]     time from prompt to first stroke
 */
export function gradeAttempt({ userStrokes, glyph, strictness = 'normal', hints = 0, gaveUp = false, recognition = null, thinkMs = null, allowEasy = true }) {
  const L = STRICTNESS[strictness] || STRICTNESS.normal;
  const ref = glyph.points;
  const nR = ref.length;
  const nU = userStrokes.length;
  const char = glyph.char;
  const R = ref.map((s) => resample(s));
  const refLen = ref.map(pathLength);

  if (nU === 0) {
    return {
      score: 0, suggested: 1, aligned: [], userInfo: [], refInfo: ref.map(() => ({ user: -1, quality: 0 })),
      issues: [gaveUp ? 'Answer shown.' : 'Nothing was drawn.'], counts: { user: 0, ref: nR }, recognised: null,
      errors: { order: 0, direction: 0, missing: nR, extra: 0 },
    };
  }

  // Pass 1: bounding-box alignment and matching. Pass 2: refit on matched strokes.
  let t = bboxTransform(userStrokes, ref);
  let aligned = transformStrokes(userStrokes, t);
  let U = aligned.map((s) => resample(s));
  let userLen = aligned.map(pathLength);
  let m = matchAll(U, R, nU, nR, L, refLen, userLen);
  for (let pass = 0; pass < 2; pass++) {
    const fitPairs = m.pairs.map(([i, j]) => [i, j, m.rev[i][j] + 2.5 < m.fwd[i][j]]);
    const rawU = userStrokes.map((s) => resample(s));
    const t2 = fitTransform(fitPairs, rawU, R, t);
    if (t2 === t) break;
    const aligned2 = transformStrokes(userStrokes, t2);
    const U2 = aligned2.map((s) => resample(s));
    const userLen2 = aligned2.map(pathLength);
    const m2 = matchAll(U2, R, nU, nR, L, refLen, userLen2);
    if (m2.ordered.cost <= m.ordered.cost + 0.5 || m2.free.cost < m.free.cost) {
      t = t2; aligned = aligned2; U = U2; userLen = userLen2; m = m2;
    } else break;
  }

  const userInfo = Array.from({ length: nU }, () => ({ ref: -1, quality: 0, reversed: false, outOfOrder: false }));
  const refInfo = Array.from({ length: nR }, () => ({ user: -1, quality: 0, reversed: false }));
  const quality = (d) => clamp(1 - (d - L.good) / (L.bad - L.good), 0, 1);

  for (const [i, j] of m.pairs) {
    const f = m.fwd[i][j], r = m.rev[i][j];
    const directional = refLen[j] >= 10 && userLen[i] >= 6;
    const reversed = directional && r + 2.5 < f && r < L.bad;
    const q = quality(directional ? (reversed ? r : f) : Math.min(f, r));
    userInfo[i] = { ref: j, quality: q, reversed, outOfOrder: false };
    refInfo[j] = { user: i, quality: q, reversed };
  }

  let orderErrors = 0;
  if (!m.inOrder) {
    const matched = m.pairs.slice().sort((a, b) => a[0] - b[0]);
    const keep = lisIndices(matched.map((p) => p[1]));
    matched.forEach(([i], k) => {
      if (!keep.has(k)) { userInfo[i].outOfOrder = true; orderErrors++; }
    });
  }
  const dirErrors = userInfo.filter((u) => u.reversed).length;
  const missing = refInfo.map((r, j) => (r.user < 0 ? j : -1)).filter((j) => j >= 0);
  const extra = userInfo.map((u, i) => (u.ref < 0 ? i : -1)).filter((i) => i >= 0);

  const shape = refInfo.reduce((s, r) => s + r.quality, 0) / nR;
  let score = 100 * shape - Math.min(30, orderErrors * 10) - dirErrors * 8 - extra.length * 10 - hints * 10;

  const issues = [];
  if (nU !== nR) issues.push(`You drew ${nU} stroke${nU === 1 ? '' : 's'}; ${char} has ${nR}.`);
  for (const j of missing.slice(0, 3)) issues.push(`Stroke ${j + 1} is missing.`);
  if (extra.length) issues.push(`${extra.length} stroke${extra.length === 1 ? ' doesn’t' : 's don’t'} match any part of ${char}.`);
  userInfo.forEach((u, i) => {
    if (u.outOfOrder) issues.push(`Stroke ${u.ref + 1} was written ${ordinal(i + 1)}.`);
  });
  refInfo.forEach((r, j) => {
    if (r.reversed) issues.push(`Stroke ${j + 1} goes ${directionWord(ref[j])}.`);
  });
  refInfo.forEach((r, j) => {
    if (r.user >= 0 && r.quality < 0.45) issues.push(`Stroke ${j + 1} is off in shape or position.`);
  });

  let recognised = null;
  if (recognition && recognition.candidates && recognition.candidates.length) {
    const rank = recognition.rank;
    const top = recognition.candidates[0][0];
    recognised = { rank, top, candidates: recognition.candidates.slice(0, 5).map((c) => c[0]) };
    if (rank > 0 && rank < 5) score -= 4;
    else if (rank < 0 || rank >= 5) {
      score -= 12;
      issues.push(`The recognizer read this as ${top}, not ${char}.`);
    }
  }
  if (hints) issues.push(`${hints} hint${hints === 1 ? '' : 's'} used.`);
  if (gaveUp) issues.unshift('Answer shown.');
  score = Math.round(clamp(score, 0, 100));

  // Suggested grade. Writing a different character (illegible plus structural errors), or
  // missing/adding strokes on a simple character, counts as not recalled. A stroke-count
  // difference the recognizer still reads as the target (e.g. connected kana strokes) is Hard.
  const structural = orderErrors + dirErrors + missing.length + extra.length;
  const countOff = missing.length + extra.length;
  const legible = !recognised || (recognised.rank >= 0 && recognised.rank < 5);
  const readAsTarget = !!recognised && recognised.rank === 0;
  // A reversed stroke alone usually confuses the recognizer without making a different
  // character, except for pairs that differ mainly in direction, such as シ/ツ and ソ/ン.
  const becameTwin = !!recognised && !readAsTarget && DIRECTION_TWINS.some((g) => g.includes(char) && g.includes(recognised.top));
  let suggested;
  if (gaveUp || score < 50 || hints >= Math.max(2, Math.ceil(nR / 2))) suggested = 1;
  else if (!legible && (structural - dirErrors > 0 || becameTwin)) suggested = 1;
  else if (countOff > 0 && !readAsTarget && (nR <= 4 || countOff / nR >= 0.2)) suggested = 1;
  else if (score < 70 || structural > 0 || hints > 0) suggested = 2;
  else if (allowEasy && score >= 92 && thinkMs != null && thinkMs < 3000 && (!recognised || readAsTarget)) suggested = 4;
  else suggested = 3;

  return {
    score, suggested, aligned, userInfo, refInfo, issues, recognised,
    counts: { user: nU, ref: nR },
    errors: { order: orderErrors, direction: dirErrors, missing: missing.length, extra: extra.length },
  };
}
