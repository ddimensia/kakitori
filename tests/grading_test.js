// Runs inside the app page (loaded by grading_test.py). Synthesises handwriting from KanjiVG
// strokes and checks that the grader and recognizer respond sensibly.
async function runGradingTests(variantData, strictness = 'normal') {
  const { getGlyph, samplePath } = await import('/js/strokes.js');
  const { gradeAttempt } = await import('/js/grader.js');
  const { recognizeStrokes } = await import('/js/recognizer.js');

  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  // Simulated handwriting: global scale/offset/aspect, per-stroke jitter and smooth wobble.
  function handwrite(strokes, level = 1) {
    const gs = 0.75 + rnd() * 0.25, ga = 1 + (rnd() - 0.5) * 0.16 * level;
    const ox = (rnd() - 0.5) * 16, oy = (rnd() - 0.5) * 16;
    return strokes.map((s) => {
      const cx = s.reduce((a, p) => a + p[0], 0) / s.length, cy = s.reduce((a, p) => a + p[1], 0) / s.length;
      const dx = gauss() * 2.2 * level, dy = gauss() * 2.2 * level, sc = 1 + gauss() * 0.08 * level;
      const f1 = 1 + rnd() * 2, f2 = 1 + rnd() * 2, ph1 = rnd() * 6, ph2 = rnd() * 6, amp = 1.2 * level;
      return s.map((p, i) => {
        const t = i / Math.max(1, s.length - 1);
        let x = cx + (p[0] - cx) * sc + dx + amp * Math.sin(f1 * Math.PI * t + ph1);
        let y = cy + (p[1] - cy) * sc + dy + amp * Math.sin(f2 * Math.PI * t + ph2);
        x = 54.5 + (x - 54.5) * gs * ga + ox;
        y = 54.5 + (y - 54.5) * gs / ga + oy;
        return [x, y];
      });
    });
  }

  const chars = ['一', '二', '三', '十', '口', '日', '月', '木', '水', '火', '人', '大', '山', '川', '田', '目', '耳', '手', '足', '学', '書', '話', '語', '読', '曜', '機', '難', '鬱',
    'あ', 'き', 'さ', 'ぬ', 'ふ', 'を', 'ア', 'シ', 'ツ', 'ソ', 'ン', 'ヲ'];
  const out = { correct: [], sloppy: [], order: [], reversed: [], missing: [], wrong: [], variants: [] };
  const glyphs = {};
  for (const c of chars) glyphs[c] = await getGlyph(c);

  async function grade(c, strokes, opts = {}) {
    const g = glyphs[c];
    const rec = opts.noRec ? null : await recognizeStrokes(strokes, c, g.points);
    const r = gradeAttempt({ userStrokes: strokes, glyph: g, recognition: rec, thinkMs: 2000, strictness: opts.strictness || strictness });
    return { c, score: r.score, sug: r.suggested, err: r.errors, rank: rec ? rec.rank : null, top: rec?.candidates?.[0]?.[0], issues: r.issues };
  }

  for (const c of chars) {
    const g = glyphs[c];
    out.correct.push(await grade(c, handwrite(g.points, 1)));
    out.sloppy.push(await grade(c, handwrite(g.points, 2.2)));
    if (g.points.length >= 2) {
      // swap two strokes that differ clearly (first and last)
      const s = handwrite(g.points, 1);
      const sw = s.slice(); const i = 0, j = s.length - 1; [sw[i], sw[j]] = [sw[j], sw[i]];
      out.order.push(await grade(c, sw));
      const m = s.slice(); m.splice(Math.floor(s.length / 2), 1);
      out.missing.push(await grade(c, m));
    }
    // reverse the longest stroke
    const s2 = handwrite(g.points, 1);
    let li = 0, ll = 0;
    s2.forEach((st, k) => { const L = st.reduce((a, p, q) => q ? a + Math.hypot(p[0] - st[q - 1][0], p[1] - st[q - 1][1]) : 0, 0); if (L > ll) { ll = L; li = k; } });
    s2[li] = s2[li].slice().reverse();
    out.reversed.push(await grade(c, s2));
  }
  // wrong character with the same stroke count
  const pairs = [['日', '田'], ['木', '水'], ['人', '大'], ['口', '山'], ['目', '耳'], ['あ', 'お'], ['シ', 'ツ'], ['ソ', 'ン'], ['書', '語'], ['手', '木']];
  for (const [want, drawn] of pairs) {
    if (!glyphs[drawn]) glyphs[drawn] = await getGlyph(drawn);
    out.wrong.push({ ...(await grade(want, handwrite(glyphs[drawn].points, 1))), drawn });
  }
  // Kaisho (block handwriting) variants from KanjiVG, as a stand-in for a different writer
  for (const [c, paths] of Object.entries(variantData)) {
    const g = glyphs[c] || (glyphs[c] = await getGlyph(c));
    if (!g) continue;
    const pts = paths.map((d) => samplePath(d));
    if (pts.length !== g.points.length) continue;
    out.variants.push(await grade(c, handwrite(pts, 0.6)));
  }
  return out;
}
