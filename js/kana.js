// Kana decks. Prompts use Hepburn romaji. Where two kana share a sound (じ/ぢ, ず/づ) the usual
// one keeps its plain romaji (ji, zu: shi and su with dakuten) and the rarer one uses its
// keyboard spelling (di, du: chi and tsu with dakuten), with a note on how it's said.

const BASIC = [
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['し', 'shi'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['ち', 'chi'], ['つ', 'tsu'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'],
  ['わ', 'wa'], ['を', 'wo', 'the particle'], ['ん', 'n'],
];

const DAKUTEN = [
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'di', 'said ji: chi with dakuten'], ['づ', 'du', 'said zu: tsu with dakuten'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
];

const toKatakana = (c) => String.fromCodePoint(c.codePointAt(0) + 0x60);

function build(kind, list, group, offset) {
  return list.map(([h, romaji, note], i) => ({
    char: kind === 'hiragana' ? h : toKatakana(h),
    kind,
    romaji,
    note: note || '',
    group,
    order: offset + i,
  }));
}

export const KANA = [
  ...build('hiragana', BASIC, 'basic', 0),
  ...build('hiragana', DAKUTEN, 'dakuten', 100),
  ...build('katakana', BASIC, 'basic', 200),
  ...build('katakana', DAKUTEN, 'dakuten', 300),
  { char: 'ヴ', kind: 'katakana', romaji: 'vu', note: '', group: 'dakuten', order: 399 },
];

export const KANA_BY_CHAR = new Map(KANA.map((k) => [k.char, k]));

/** Kana included by the current settings. */
export function selectedKana(settings) {
  return KANA.filter((k) => {
    if (k.kind === 'hiragana' && !settings.hiragana) return false;
    if (k.kind === 'katakana' && !settings.katakana) return false;
    if (k.group === 'dakuten' && !settings.dakuten) return false;
    return true;
  });
}
