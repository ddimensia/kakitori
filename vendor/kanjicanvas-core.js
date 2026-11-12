/*
 * Recognition core of KanjiCanvas, adapted to run without a DOM (e.g. in a Web Worker).
 * Original: https://github.com/asdfjkl/kanjicanvas
 *
 * Copyright (c) 2019-2024 Dominik Klein
 * Copyright (c) 2020 Seth Clydesdale
 * Licensed under the MIT License (see kanjicanvas.LICENSE).
 *
 * Changes from the original: functions take patterns as arguments instead of reading
 * canvas state, intermediate values are local variables, debug logging removed,
 * and recognize() returns ranked [character, distance] pairs instead of a string.
 */

function aran(width, height) {
  const r1 = height > width ? width / height : height / width;
  return Math.sqrt(Math.sin((Math.PI / 2) * r1));
}

function transform(pattern, dx, dy) {
  return pattern.map((s) => s.map(([x, y]) => [x + dx, y + dy]));
}

export function momentNormalize(pattern) {
  const newW = 256, newH = 256;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  let m00 = 0, m10 = 0, m01 = 0;
  for (const s of pattern) {
    for (const [x, y] of s) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      m00++; m10 += x; m01 += y;
    }
  }
  const oldH = Math.abs(yMax - yMin);
  const oldW = Math.abs(xMax - xMin);
  const r2 = aran(oldW, oldH);
  let aranW = newW, aranH = newH;
  if (oldH > oldW) aranW = r2 * newW; else aranH = r2 * newH;
  const xOffset = (newW - aranW) / 2;
  const yOffset = (newH - aranH) / 2;
  const xc = m10 / m00, yc = m01 / m00;
  let mu20 = 0, mu02 = 0;
  for (const s of pattern) for (const [x, y] of s) { mu20 += (x - xc) ** 2; mu02 += (y - yc) ** 2; }
  const alpha = aranW / (4 * Math.sqrt(mu20 / m00)) || 0;
  const beta = aranH / (4 * Math.sqrt(mu02 / m00)) || 0;
  const nf = pattern.map((s) => s.map(([x, y]) => [alpha * (x - xc) + aranW / 2, beta * (y - yc) + aranH / 2]));
  return transform(nf, xOffset, yOffset);
}

function euclid(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function extractFeatures(kanji, interval) {
  const out = [];
  for (const stroke of kanji) {
    const ex = [];
    let dist = 0;
    for (let j = 0; j < stroke.length; j++) {
      if (j === 0) ex.push(stroke[0]);
      if (j > 0) dist += euclid(stroke[j - 1], stroke[j]);
      if (dist >= interval && j > 1) {
        dist -= interval;
        ex.push(stroke[j]);
      }
    }
    if (ex.length === 1) ex.push(stroke[stroke.length - 1]);
    else if (dist > 0.75 * interval) ex.push(stroke[stroke.length - 1]);
    out.push(ex);
  }
  return out;
}

function endPointDistance(p1, p2) {
  const l1 = p1 ? p1.length : 0;
  const l2 = p2 ? p2.length : 0;
  if (l1 === 0 || l2 === 0) return 0;
  let d = Math.abs(p1[0][0] - p2[0][0]) + Math.abs(p1[0][1] - p2[0][1]);
  d += Math.abs(p1[l1 - 1][0] - p2[l2 - 1][0]) + Math.abs(p1[l1 - 1][1] - p2[l2 - 1][1]);
  return d;
}

function initialDistance(p1, p2) {
  const l1 = p1.length, l2 = p2.length;
  const lmin = Math.min(l1, l2), lmax = Math.max(l1, l2);
  let d = 0;
  for (let i = 0; i < lmin; i++) d += Math.abs(p1[i][0] - p2[i][0]) + Math.abs(p1[i][1] - p2[i][1]);
  return d * (lmax / lmin);
}

function getLargerAndSize(p1, p2) {
  const l1 = p1 ? p1.length : 0;
  const l2 = p2 ? p2.length : 0;
  return l1 < l2 ? [p2, p1, l2, l1] : [p1, p2, l1, l2];
}

function wholeWholeDistance(p1, p2) {
  const a = getLargerAndSize(p1, p2);
  let d = 0;
  for (let i = 0; i < a[3]; i++) {
    const j = parseInt(parseInt(a[2] / a[3]) * i);
    d += Math.abs(a[0][j][0] - a[1][i][0]) + Math.abs(a[0][j][1] - a[1][i][1]);
  }
  return parseInt(d / a[3]);
}

function initStrokeMap(p1, p2, metric) {
  const a = getLargerAndSize(p1, p2);
  const map = new Array(a[2]).fill(-1);
  const free = new Array(a[2]).fill(true);
  for (let i = 0; i < a[3]; i++) {
    let minDist = 10000000, minJ = -1;
    for (let j = 0; j < a[2]; j++) {
      if (free[j]) {
        const d = metric(a[0][j], a[1][i]);
        if (d < minDist) { minDist = d; minJ = j; }
      }
    }
    free[minJ] = false;
    map[minJ] = i;
  }
  return map;
}

function getMap(p1, p2, metric) {
  const a = getLargerAndSize(p1, p2);
  const map = initStrokeMap(a[0], a[1], metric);
  for (let l = 0; l < 3; l++) {
    for (let i = 0; i < map.length; i++) {
      if (map[i] === -1) continue;
      let dii = metric(a[0][i], a[1][map[i]]);
      for (let j = 0; j < map.length; j++) {
        if (map[i] === -1) continue;
        if (map[j] !== -1) {
          const djj = metric(a[0][j], a[1][map[j]]);
          const dij = metric(a[0][j], a[1][map[i]]);
          const dji = metric(a[0][i], a[1][map[j]]);
          if (dji + dij < dii + djj) {
            const mapj = map[j];
            map[j] = map[i];
            map[i] = mapj;
            dii = dij;
          }
        } else {
          const dij = metric(a[0][j], a[1][map[i]]);
          if (dij < dii) {
            map[j] = map[i];
            map[i] = -1;
            dii = dij;
          }
        }
      }
    }
  }
  return map;
}

function completeMap(p1, p2, metric, map) {
  const a = getLargerAndSize(p1, p2);
  if (!map.includes(-1)) return map;
  let lastUnassigned = map[map.length];
  let mapLastTo = -1;
  for (let i = map.length - 1; i >= 0; i--) {
    if (map[i] === -1) lastUnassigned = i;
    else { mapLastTo = map[i]; break; }
  }
  for (let i = lastUnassigned; i < map.length; i++) map[i] = mapLastTo;
  let firstUnassigned = -1, mapFirstTo = -1;
  for (let i = 0; i < map.length; i++) {
    if (map[i] === -1) firstUnassigned = i;
    else { mapFirstTo = map[i]; break; }
  }
  for (let i = 0; i <= firstUnassigned; i++) map[i] = mapFirstTo;
  for (let i = 0; i < map.length; i++) {
    if (i + 1 < map.length && map[i + 1] === -1) {
      const start = i;
      let stop = i + 1;
      while (stop < map.length && map[stop] === -1) stop++;
      let div = start, maxDist = 1000000;
      for (let j = start; j < stop; j++) {
        let ab = a[0][start];
        for (let t = start + 1; t <= j; t++) ab = ab.concat(a[0][t]);
        let bc = a[0][j + 1];
        for (let t = j + 2; t <= stop; t++) bc = bc.concat(a[0][t]);
        const d = metric(ab, a[1][map[start]]) + metric(bc, a[1][map[stop]]);
        if (d < maxDist) { div = j; maxDist = d; }
      }
      for (let j = start; j <= div; j++) map[j] = map[start];
      for (let j = div + 1; j < stop; j++) map[j] = map[stop];
    }
  }
  return map;
}

function computeDistance(p1, p2, metric, map) {
  const a = getLargerAndSize(p1, p2);
  let d = 0, idx = 0;
  while (idx < a[2]) {
    const strokeIdx = a[1][map[idx]];
    const start = idx;
    let stop = start + 1;
    while (stop < map.length && map[stop] === map[idx]) stop++;
    let concat = a[0][start];
    for (let t = start + 1; t < stop; t++) concat = concat.concat(a[0][t]);
    d += metric(strokeIdx, concat);
    idx = stop;
  }
  return d;
}

function computeWholeDistanceWeighted(p1, p2, map) {
  const a = getLargerAndSize(p1, p2);
  let d = 0, idx = 0;
  while (idx < a[2]) {
    const strokeIdx = a[1][map[idx]];
    const start = idx;
    let stop = start + 1;
    while (stop < map.length && map[stop] === map[idx]) stop++;
    let concat = a[0][start];
    for (let t = start + 1; t < stop; t++) concat = concat.concat(a[0][t]);
    let di = wholeWholeDistance(strokeIdx, concat);
    if (stop > start + 1) {
      let mm = strokeIdx ? strokeIdx.length : 0;
      let nn = concat.length;
      if (nn < mm) [nn, mm] = [mm, nn];
      di = di * (nn / mm);
    }
    d += di;
    idx = stop;
  }
  return d;
}

function coarseClassification(input, refs) {
  const n = input.length;
  const candidates = [];
  for (let i = 0; i < refs.length; i++) {
    const len = refs[i][1];
    if (n < len + 2 && n > len - 3) {
      const pat = refs[i][2];
      let map = getMap(pat, input, endPointDistance);
      map = completeMap(pat, input, endPointDistance, map);
      const d = computeDistance(pat, input, endPointDistance, map);
      let m = len, nn = pat.length;
      if (nn < m) [nn, m] = [m, nn];
      candidates.push([i, d * (m / nn)]);
    }
  }
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates;
}

function fineClassification(input, coarse, refs, limit) {
  const n = input.length;
  const out = [];
  for (let k = 0; k < Math.min(coarse.length, limit); k++) {
    const j = coarse[k][0];
    const len = refs[j][1];
    const pat = refs[j][2];
    if (n < len + 2 && n > len - 3) {
      let map = getMap(pat, input, initialDistance);
      map = completeMap(pat, input, wholeWholeDistance, map);
      let d = computeWholeDistanceWeighted(pat, input, map);
      d = d / Math.min(n, pat.length);
      out.push([j, d]);
    }
  }
  out.sort((a, b) => a[1] - b[1]);
  return out;
}

/** Convert raw strokes (any coordinate scale) into a reference pattern. */
export function buildPattern(strokes) {
  return extractFeatures(momentNormalize(strokes), 20);
}

/**
 * Rank reference characters by similarity to the drawn strokes.
 * @param strokes  array of strokes, each an array of [x, y]
 * @param refs     array of [char, strokeCount, pattern]
 * @returns        array of [char, distance], best first
 */
export function recognize(strokes, refs, limit = 100) {
  const pts = strokes.reduce((n, s) => n + s.length, 0);
  if (!strokes.length || pts < 2) return [];
  const features = buildPattern(strokes);
  if (features.some((s) => s.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))) return [];
  const coarse = coarseClassification(features, refs);
  return fineClassification(features, coarse, refs, limit).map(([i, d]) => [refs[i][0], d]);
}
