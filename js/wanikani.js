// WaniKani API v2 client: fetches the kanji you've started (and vocabulary for context).
// Docs: https://docs.api.wanikani.com/20170710/

const BASE = 'https://api.wanikani.com/v2/';

export const SRS_THRESHOLDS = [
  { stage: 1, label: 'Lessons done (Apprentice I and up)' },
  { stage: 5, label: 'Guru and up' },
  { stage: 7, label: 'Master and up' },
  { stage: 8, label: 'Enlightened and up' },
  { stage: 9, label: 'Burned only' },
];

export class WkError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, token) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Wanikani-Revision': '20170710' },
      });
    } catch {
      throw new WkError('Couldn’t reach WaniKani. Check your internet connection and try again.');
    }
    if (res.status === 429) {
      await sleep(8000 * (attempt + 1));
      continue;
    }
    if (res.status === 401) throw new WkError('WaniKani didn’t accept this API token. Copy it again from WaniKani’s API tokens page.');
    if (res.status === 403) throw new WkError('This API token doesn’t have permission to read your data.');
    if (!res.ok) throw new WkError(`WaniKani returned an error (${res.status}). Try again later.`);
    return res.json();
  }
  throw new WkError('WaniKani’s rate limit was reached. Wait a minute and sync again.');
}

async function collect(path, token) {
  let url = BASE + path;
  const out = [];
  while (url) {
    const page = await request(url, token);
    out.push(...page.data);
    url = page.pages && page.pages.next_url;
  }
  return out;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function subjectsByIds(ids, token) {
  const out = [];
  for (const part of chunk(ids, 500)) {
    if (part.length) out.push(...(await collect(`subjects?ids=${part.join(',')}`, token)));
  }
  return out;
}

function primaryFirst(list) {
  return [...list].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
}

/**
 * @param {string} token
 * @param {{minStage:number, vocab:boolean}} opts
 * @param {(msg:string)=>void} progress
 */
export async function fetchKnownKanji(token, { minStage = 1, vocab = true } = {}, progress = () => {}) {
  if (!token) throw new WkError('Add your WaniKani API token first.');
  progress('Checking your account');
  const user = (await request(`${BASE}user`, token)).data;
  const maxLevel = user.subscription?.max_level_granted ?? 60;

  progress('Loading your kanji progress');
  const assignments = await collect('assignments?subject_types=kanji&started=true&hidden=false', token);
  const stage = new Map();
  for (const a of assignments) if (a.data.srs_stage >= minStage) stage.set(a.data.subject_id, a.data.srs_stage);

  progress(`Loading ${stage.size} kanji`);
  const kanjiSubjects = (await subjectsByIds([...stage.keys()], token)).filter(
    (s) => s.object === 'kanji' && !s.data.hidden_at && s.data.characters && s.data.level <= maxLevel,
  );

  const vocabByKanji = new Map();
  if (vocab && kanjiSubjects.length) {
    progress('Loading vocabulary for context');
    const vAssign = await collect('assignments?subject_types=vocabulary&started=true&hidden=false', token);
    const vocabSubjects = await subjectsByIds(vAssign.map((a) => a.data.subject_id), token);
    for (const v of vocabSubjects) {
      if (v.data.hidden_at || !v.data.characters || [...v.data.characters].length < 2) continue;
      const meaning = primaryFirst(v.data.meanings.filter((m) => m.accepted_answer))[0]?.meaning;
      const reading = primaryFirst(v.data.readings || [])[0]?.reading;
      if (!meaning || !reading) continue;
      for (const kid of v.data.component_subject_ids || []) {
        if (!vocabByKanji.has(kid)) vocabByKanji.set(kid, []);
        vocabByKanji.get(kid).push({ w: v.data.characters, r: reading, m: meaning, level: v.data.level });
      }
    }
  }

  const kanji = kanjiSubjects.map((s) => {
    const d = s.data;
    const meanings = primaryFirst(d.meanings.filter((m) => m.accepted_answer)).map((m) => m.meaning);
    const readings = { onyomi: [], kunyomi: [], nanori: [] };
    for (const r of primaryFirst(d.readings || [])) {
      // WaniKani marks some readings as not accepted in its own quizzes; they are still real readings.
      if (r.type in readings) readings[r.type].push({ reading: r.reading, primary: r.primary });
    }
    const words = (vocabByKanji.get(s.id) || [])
      .sort((a, b) => a.level - b.level || a.w.length - b.w.length)
      .slice(0, 4)
      .map(({ w, r, m }) => ({ w, r, m }));
    return {
      char: d.characters,
      wkId: s.id,
      level: d.level,
      lessonPosition: d.lesson_position ?? 0,
      meanings,
      readings,
      words,
      srsStage: stage.get(s.id),
      url: d.document_url,
    };
  });

  return {
    user: { username: user.username, level: user.level, maxLevel },
    kanji,
  };
}
