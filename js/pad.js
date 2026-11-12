// Drawing pad: a practice square with guide lines, an ink canvas and SVG layers
// for the reference underlay and grading overlay. Stroke points are stored in
// KanjiVG's 109-unit coordinate space.

import { BOX } from './strokes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const INK_WIDTH = 3.6;

function svgLayer(cls) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${BOX} ${BOX}`);
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export function guideMarkup() {
  const m = BOX / 2;
  return `<rect class="g-frame" x="0.5" y="0.5" width="${BOX - 1}" height="${BOX - 1}"/>
    <line class="g-cross" x1="${m}" y1="2" x2="${m}" y2="${BOX - 2}"/>
    <line class="g-cross" x1="2" y1="${m}" x2="${BOX - 2}" y2="${m}"/>`;
}

export class DrawingPad {
  constructor(root, { onChange = () => {}, penOnly = true } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.penOnly = penOnly;
    this.strokes = [];
    this.current = null;
    this.activePointer = null;
    this.locked = false;
    this.sawPen = false;
    this.firstStrokeAt = null;

    root.classList.add('pad');
    root.innerHTML = '';
    this.guide = svgLayer('pad-guide');
    this.guide.innerHTML = guideMarkup();
    this.under = svgLayer('pad-under');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pad-ink';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Writing area. Draw the character here.');
    this.over = svgLayer('pad-over');
    root.append(this.guide, this.under, this.canvas, this.over);
    this.ctx = this.canvas.getContext('2d');

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    this.canvas.addEventListener('pointerdown', this._down);
    this.canvas.addEventListener('pointermove', this._move);
    this.canvas.addEventListener('pointerup', this._up);
    this.canvas.addEventListener('pointercancel', this._up);
    this.canvas.addEventListener('lostpointercapture', this._up);
    // Stop iOS from scrolling, zooming or showing the callout while writing.
    this.canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(root);
    this.resize();
  }

  destroy() {
    this.resizeObserver.disconnect();
  }

  resize() {
    const rect = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.redraw();
    }
  }

  _point(e) {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * BOX, ((e.clientY - r.top) / r.height) * BOX];
  }

  _down(e) {
    if (this.locked || this.activePointer !== null) return;
    if (e.pointerType === 'pen') this.sawPen = true;
    if (this.penOnly && this.sawPen && e.pointerType === 'touch') return; // palm rejection
    if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    this.activePointer = e.pointerId;
    this.current = [this._point(e)];
    if (this.firstStrokeAt === null) this.firstStrokeAt = performance.now();
    this._drawDot(this.current[0]);
  }

  _move(e) {
    if (e.pointerId !== this.activePointer || !this.current) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = this._point(ev);
      const last = this.current[this.current.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.25) continue;
      this.current.push(p);
      this._drawSegment(last, p);
    }
  }

  _up(e) {
    if (e.pointerId !== this.activePointer || !this.current) return;
    this.activePointer = null;
    const stroke = this.current;
    this.current = null;
    if (stroke.length === 1) stroke.push([stroke[0][0] + 0.3, stroke[0][1] + 0.3]);
    this.strokes.push(stroke);
    this.redraw();
    this.onChange(this.strokes);
  }

  _style() {
    const cs = getComputedStyle(this.root);
    this.ctx.strokeStyle = cs.getPropertyValue('--ink').trim() || '#1c2533';
    this.ctx.fillStyle = this.ctx.strokeStyle;
    this.ctx.lineWidth = (INK_WIDTH * this.canvas.width) / BOX;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  _scale() {
    return this.canvas.width / BOX;
  }

  _drawDot(p) {
    this._style();
    const k = this._scale();
    this.ctx.beginPath();
    this.ctx.arc(p[0] * k, p[1] * k, this.ctx.lineWidth / 2, 0, Math.PI * 2);
    this.ctx.fill();
  }

  _drawSegment(a, b) {
    this._style();
    const k = this._scale();
    this.ctx.beginPath();
    this.ctx.moveTo(a[0] * k, a[1] * k);
    this.ctx.lineTo(b[0] * k, b[1] * k);
    this.ctx.stroke();
  }

  redraw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.inkHidden) return;
    this._style();
    const k = this._scale();
    for (const s of this.strokes) {
      ctx.beginPath();
      ctx.moveTo(s[0][0] * k, s[0][1] * k);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = (s[i][0] + s[i + 1][0]) / 2, my = (s[i][1] + s[i + 1][1]) / 2;
        ctx.quadraticCurveTo(s[i][0] * k, s[i][1] * k, mx * k, my * k);
      }
      const last = s[s.length - 1];
      ctx.lineTo(last[0] * k, last[1] * k);
      ctx.stroke();
    }
  }

  undo() {
    if (this.locked || !this.strokes.length) return;
    this.strokes.pop();
    this.redraw();
    this.onChange(this.strokes);
  }

  clear() {
    this.strokes = [];
    this.current = null;
    this.activePointer = null;
    this.firstStrokeAt = null;
    this.inkHidden = false;
    this.redraw();
    this.onChange(this.strokes);
  }

  reset() {
    this.clear();
    this.setLocked(false);
    this.setUnderlay('');
    this.setOverlay('');
  }

  setLocked(v) {
    this.locked = v;
    this.root.classList.toggle('is-locked', v);
  }

  setInkHidden(v) {
    this.inkHidden = v;
    this.redraw();
  }

  setUnderlay(markup) {
    this.under.innerHTML = markup || '';
  }

  setOverlay(markup) {
    this.over.innerHTML = markup || '';
  }

  /** Programmatic input, used by tests and demos. */
  addStroke(points) {
    this.strokes.push(points.map((p) => [...p]));
    if (this.firstStrokeAt === null) this.firstStrokeAt = performance.now();
    this.redraw();
    this.onChange(this.strokes);
  }
}
