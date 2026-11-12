// Renders KanjiVG glyphs as SVG and animates their stroke order.

import { BOX } from './strokes.js';
import { guideMarkup } from './pad.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function startOf(d) {
  const m = /M\s*([\d.\-]+)[ ,]([\d.\-]+)/.exec(d);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
}

/** Static SVG markup of a glyph (for grids, overlays, model answers). */
export function glyphPaths(glyph, cls = 'ref-stroke') {
  return glyph.paths.map((d, i) => `<path class="${cls}" data-i="${i}" d="${d}"/>`).join('');
}

export function numberLabels(glyph, upTo = Infinity) {
  return glyph.paths
    .map((d, i) => {
      if (i >= upTo) return '';
      const n = glyph.numbers[i] || startOf(d);
      return `<text class="stroke-num" x="${n[0]}" y="${n[1]}">${i + 1}</text>`;
    })
    .join('');
}

/** A reference stroke drawn as a hint: path plus a dot marking where it starts. */
export function hintMarkup(glyph, i) {
  const d = glyph.paths[i];
  const [x, y] = startOf(d);
  return `<path class="hint-stroke" d="${d}"/><circle class="hint-start" cx="${x}" cy="${y}" r="2.6"/>`;
}

/**
 * Stroke-order player. Renders into `container` (a square element).
 */
export class StrokePlayer {
  constructor(container, glyph, { numbers = true, grid = true, speed = 1 } = {}) {
    this.container = container;
    this.glyph = glyph;
    this.speed = speed;
    this.animations = [];
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${BOX} ${BOX}`);
    svg.setAttribute('class', 'stroke-player');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Stroke order for ${glyph.char}, ${glyph.paths.length} strokes`);
    svg.innerHTML = `${grid ? `<g class="pad-guide-g">${guideMarkup()}</g>` : ''}
      <g class="shadow">${glyphPaths(glyph, 'shadow-stroke')}</g>
      <g class="live">${glyphPaths(glyph, 'live-stroke')}</g>
      <g class="nums">${numbers ? numberLabels(glyph) : ''}</g>`;
    container.innerHTML = '';
    container.appendChild(svg);
    this.svg = svg;
    this.paths = [...svg.querySelectorAll('.live-stroke')];
    this.nums = [...svg.querySelectorAll('.stroke-num')];
    this.lengths = this.paths.map((p) => p.getTotalLength());
    this.showAll();
  }

  stop() {
    for (const a of this.animations) a.cancel();
    this.animations = [];
  }

  showAll() {
    this.stop();
    this.paths.forEach((p) => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; p.style.opacity = 1; });
    this.nums.forEach((n) => { n.style.opacity = 1; });
  }

  /** Show only the first k strokes (k = 0 hides all). */
  showUpTo(k) {
    this.stop();
    this.paths.forEach((p, i) => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; p.style.opacity = i < k ? 1 : 0; });
    this.nums.forEach((n, i) => { n.style.opacity = i < k ? 1 : 0; });
  }

  play() {
    if (reduceMotion()) { this.showAll(); return Promise.resolve(); }
    this.stop();
    let delay = 150;
    const done = [];
    this.paths.forEach((p, i) => {
      const L = this.lengths[i] + 1;
      p.style.opacity = 1;
      p.style.strokeDasharray = `${L} ${L}`;
      p.style.strokeDashoffset = `${L}`;
      const duration = (220 + L * 9) / this.speed;
      const a = p.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration, delay, fill: 'forwards', easing: 'cubic-bezier(.45,.05,.4,1)' });
      this.animations.push(a);
      done.push(a.finished.catch(() => {}));
      const n = this.nums[i];
      if (n) {
        n.style.opacity = 0;
        const na = n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay, fill: 'forwards' });
        this.animations.push(na);
      }
      delay += duration + 160 / this.speed;
    });
    return Promise.all(done);
  }
}
