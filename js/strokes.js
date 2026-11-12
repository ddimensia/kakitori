// KanjiVG stroke data: loaded per shard on demand, sampled into point lists for grading.
// All coordinates use KanjiVG's 109 x 109 box.

export const BOX = 109;
const SVG_NS = 'http://www.w3.org/2000/svg';
const shards = new Map();
const glyphs = new Map();

function shardKey(ch) {
  return (ch.codePointAt(0) >> 8).toString(16).padStart(2, '0');
}

function loadShard(key) {
  if (!shards.has(key)) {
    const p = fetch(new URL(`../data/strokes/${key}.json`, import.meta.url))
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => {
        shards.delete(key);
        return {};
      });
    shards.set(key, p);
  }
  return shards.get(key);
}

let measurePath = null;
function pathEl() {
  if (!measurePath) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
    measurePath = document.createElementNS(SVG_NS, 'path');
    svg.appendChild(measurePath);
    document.body.appendChild(svg);
  }
  return measurePath;
}

/** Sample an SVG path into points spaced roughly `step` units apart. */
export function samplePath(d, step = 1) {
  const p = pathEl();
  p.setAttribute('d', d);
  const len = p.getTotalLength();
  const n = Math.max(2, Math.ceil(len / step) + 1);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const q = p.getPointAtLength((len * i) / (n - 1));
    pts.push([q.x, q.y]);
  }
  return pts;
}

/**
 * @returns {Promise<null | {char:string, paths:string[], numbers:([number,number]|null)[], points:[number,number][][]}>}
 */
export async function getGlyph(ch) {
  if (glyphs.has(ch)) return glyphs.get(ch);
  const shard = await loadShard(shardKey(ch));
  const e = shard[ch];
  if (!e) return null;
  const glyph = { char: ch, paths: e.s, numbers: e.n || [], points: e.s.map((d) => samplePath(d)) };
  glyphs.set(ch, glyph);
  return glyph;
}

/** Preload the shards for a list of characters (used before a session starts). */
export function prefetchGlyphs(chars) {
  const keys = new Set(chars.map(shardKey));
  return Promise.all([...keys].map(loadShard));
}
