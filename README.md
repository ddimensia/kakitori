# Kakitori (書き取り)

> **Kakitori is an unofficial third-party app for WaniKani users.** It isn't made by,
> affiliated with or endorsed by WaniKani or Tofugu LLC.

A practice notebook for writing Japanese by hand. You write kana and the kanji you've
started on WaniKani, or from built-in JLPT, school-grade or frequency lists, with a
mouse, finger or stylus. Each attempt is graded stroke by
stroke against KanjiVG, checked for legibility with the KanjiCanvas recognizer, and
scheduled with FSRS spaced repetition.

Everything runs in the browser, as an installed web app or a plain web page. There is
no server and no account. Your progress is stored in the browser, and the only network
calls go to WaniKani's API.

## What it does

- **WaniKani sync.** Paste a read-only API token and the app pulls every kanji you've
  started, with its meanings, readings and level. You choose the cutoff in Settings
  (lessons done, Guru and up, and so on), so you never see kanji you haven't studied.
  It also pulls vocabulary you know, so a prompt can show a word with the kanji blanked
  out (□人, ひとり) to tell apart kanji that share a meaning.
- **Built-in kanji lists, no WaniKani needed.** Instead of WaniKani you can study kanji in
  JLPT order (N5 to N1, 2,211 kanji), Japanese school order (grade 1 through secondary
  school, the 2,136 jōyō kanji) or most-frequent-first (2,501 kanji). Meanings and readings
  come from KANJIDIC2, and example words from JMdict. Progress is kept per character, so
  switching between WaniKani and a list keeps what you've learned. The JLPT has published
  no official kanji lists since 2010; these levels are the widely used unofficial ones by
  Jonathan Waller.
- **Kana.** Hiragana and katakana, with or without dakuten. Each set can be turned off.
- **Lessons.** For each new character you watch an animated stroke-order model, trace
  it over a guide, then write the whole batch from memory. That first quiz starts the
  review schedule. New characters are limited per day (10 by default).
- **Choose lessons.** Like WaniKani's Advanced lesson picker: from the Today page you can
  pick any characters you haven't started, one at a time, by group, or the next batch in
  order, and learn them now, past the daily limit. They're taught in batches, with a quiz
  after each and an option to continue with the next.
- **Reviews.** You get the prompt (meaning and readings, or romaji) and write the
  character in a practice square. After you check it you get:
  - an overlay of your strokes on the model: green for good, amber for rough, red for
    wrong, dashed red for missing strokes, and arrows on reversed strokes
  - a list of what to fix ("Stroke 4 was written 2nd.", "Stroke 2 goes top to bottom.")
  - the recognizer's top readings of what you wrote
  - a suggested grade drawn as a teacher's red-pen mark (× again, △ hard, ○ good,
    ◎ easy), which you can accept with Enter or override with 1–4
- **Hints.** Hint shows the next stroke and where it starts. Show answer plays the
  whole model. Using either lowers the suggested grade.
- **Same-meaning kanji.** If you write a different kanji you know that shares the
  meaning (早 when 速 was asked for "fast"), the app says so and lets you try again
  without penalty.
- **Characters page.** Every character on a notebook grid, shaded by memory strength.
  Select one for its stroke order, schedule and stats, or to practice it, suspend it,
  or reset it.
- **Mark characters you already know.** Select characters on the Characters page (one at
  a time, a whole group such as all hiragana, or everything shown) and choose how well you
  know them: "Recognize it, still shaky", "Know it", "Know it well" or "Could write it in
  my sleep". They skip lessons and go straight into reviews, with first reviews spread
  over 2 days to 3 months depending on the level, so a set marked together doesn't all
  come back at once. You can also do this from a character's detail dialog, and undo right
  after.
- **Free practice.** You can practice your ten weakest characters, or misses from a
  session, without changing the schedule.
- **Undo last grade**, a seven-day forecast, dark mode, offline support once installed,
  and backup/restore to a JSON file.
- **Welcome page.** First-time visitors see a short page explaining what Kakitori is, with a
  Get started button. After that the app opens on Today; the footer's About link brings the
  page back.
- **Works offline** once installed as a web app. Fonts, stroke data and
  the recognizer are bundled.

## Running it

Use it online or run it from your own computer. Either way it keeps working with no
internet connection once installed. Only WaniKani sync needs a connection.

### 1. Online (GitHub Pages or any HTTPS host)

1. Create a GitHub repository and upload the contents of this folder, with
   `index.html` at the top level.
2. In the repository, go to Settings → Pages and choose Deploy from a branch, using
   `main` and `/ (root)`.
3. Open the Pages URL (`https://<username>.github.io/<repository>/`). To install it,
   click the install icon at the right of Chrome's or Edge's address bar, or on an
   iPad or iPhone tap Share → Add to Home Screen in Safari.

On first load the app stores all of its files and data, about 15 MB, so the installed
app keeps working offline. It picks up updates the next time it's opened online.
Netlify Drop (drag the folder onto app.netlify.com/drop) works too.

### 2. On your own computer

```sh
cd kakitori
python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome and click the install icon at the right of the
address bar (or ⋮ → Cast, save and share → Install page as app). The installed app
keeps working after you stop the server and go offline. Run the server again only to
pick up an update.

Progress is kept separately by each installed app and site address. To move
it, use Settings → Save backup file, then Restore from backup on the other one.

## Supporting the project

Kakitori is free and stays free. If it helps you, you can leave a tip on
[Ko-fi](https://ko-fi.com/ddimensia), which is also linked from the app's footer and the Sponsor button on
the GitHub repository.

## Connecting WaniKani

WaniKani is optional: Settings → Kanji to study also offers the built-in lists.

1. On WaniKani, open Settings → API Tokens
   (https://www.wanikani.com/settings/personal_access_tokens) and create a token. The
   default read-only permissions are enough.
2. Paste it into Kakitori's Settings. It syncs right away, and again whenever the app
   is opened more than six hours after the last sync.

The token is stored in this browser's IndexedDB and sent only to `api.wanikani.com`.
Backup files don't include it.

## How grading works

`js/grader.js`

1. Your drawing is scaled and moved to fit the model. It starts from the bounding box,
   then refines with a least-squares fit on matched strokes. Size and placement on the
   pad don't count against you, but distorted proportions still do.
2. Every stroke you drew is resampled to 32 points and compared with every KanjiVG
   stroke. The distance is half absolute position and half shape, in KanjiVG's
   109-unit box.
3. The best order-preserving alignment (like edit distance) is compared with the best
   free matching (Hungarian algorithm). If the free matching is clearly better, strokes
   were written out of order. A longest increasing subsequence finds which strokes moved.
4. Each matched stroke is checked for direction, and for shape quality against the
   Lenient, Normal or Strict thresholds.
5. KanjiCanvas (in a Web Worker) ranks what you wrote against about 2,350 hand-written
   reference patterns: the KanjiCanvas kanji set plus its kana samples. A kanji missing
   from that set gets a pattern built from KanjiVG on the fly. Shapes that are identical
   across scripts, such as 口/ロ and 力/カ, count as matches.
6. The suggested grade combines these checks:
   - **Again:** writing a different character, missing strokes on a simple character,
     a low score, or showing the answer
   - **Hard:** order or direction errors, or using a hint
   - **Good:** clean writing
   - **Easy:** only for characters already in long-term review, written cleanly and
     started within three seconds

## Scheduling

`js/srs.js` uses ts-fsrs, the reference TypeScript implementation of FSRS, with its
default parameters. Learning steps are 1 and 10 minutes, and relearning is 10 minutes.
Cards due again within 30 minutes stay in the current session. You can set the target
recall rate (90% by default) and the longest interval in Settings.

## Keyboard

| Key | While writing | After checking |
| --- | --- | --- |
| Enter | Check | Accept the suggested grade |
| 1–4 | | Grade Again, Hard, Good or Easy |
| Backspace / Ctrl+Z | Undo stroke | |
| Esc | Clear | |
| H | Hint | |

## Project layout

```
index.html, css/app.css      app shell and styles
js/main.js                   routing, sync, starting sessions
js/state.js, js/store.js     cards and settings, IndexedDB persistence
js/wanikani.js               WaniKani API v2 client
js/srs.js, js/session.js     FSRS wrapper, session queue with learning steps and undo
js/pad.js                    drawing pad (pointer events, palm rejection, hi-DPI)
js/grader.js                 stroke matching and grading
js/recognizer*.js            KanjiCanvas recognition in a Web Worker
js/glyphview.js              stroke-order animation
js/writer.js                 the practice screen for one card
js/views/*.js                Today, Characters, Settings, study sessions
vendor/                      ts-fsrs and the KanjiCanvas recognition core (with licenses)
data/strokes/*.json          KanjiVG stroke paths, one shard per 256 code points
data/kc-refs.json            KanjiCanvas reference patterns plus kana
data/kanji-info.json         built-in kanji lists with meanings, readings and example words
tools/                       scripts that rebuild data/ from KanjiVG, KanjiCanvas, KANJIDIC2 and JMdict
tests/                       Playwright tests: synthetic handwriting and full flows with a mocked API
fonts/, css/fonts.css        Klee One and Zen Kaku Gothic New, bundled for offline use
sw.js, precache.json         offline cache for the installed web app
manifest.webmanifest         web app manifest (install as an app, add to home screen)
```

To rebuild the data from fresh checkouts of KanjiVG and KanjiCanvas:

```sh
python3 tools/build_strokes.py path/to/kanjivg/kanji data/strokes
python3 tools/build_refs.py path/to/kanjicanvas/docs/resources/javascript/ref-patterns.js \
  path/to/kanjicanvas/hiragana path/to/kanjicanvas/katakana data/kc-refs.json
```

The built-in kanji lists are rebuilt with `tools/build_kanji_info.py`; its header lists the
input files and where they come from. A GitHub Actions workflow
(`.github/workflows/update-kanji-data.yml`) does this on the 2nd of every month with the
latest KANJIDIC2 and JMdict, as their licence asks for regular updates. It commits only
when the data changed and `tools/check_kanji_info.py` finds nothing wrong, then asks
GitHub Pages to republish. Installed apps pick up the new file the next time they're
opened online. To run it now, open the repository's Actions tab, choose Update kanji
data and click Run workflow.

After changing data/strokes/ or fonts/, run `python3 tools/build_precache.py .` (fonts come
from the `@fontsource/klee-one` and `@fontsource/zen-kaku-gothic-new` npm packages, via
`tools/build_fonts.py`). After changing any app file, bump `VERSION` in `sw.js` so
installed copies update.

## License

Kakitori's own code is released under the [MIT License](LICENSE).

These parts aren't covered by the MIT license and keep their own terms:

| What | Where | License |
| --- | --- | --- |
| Stroke data and the app icons, adapted from KanjiVG | `data/strokes/`, `icon.svg`, `icon-*.png` | CC BY-SA 3.0 (`data/KanjiVG-COPYING.txt`) |
| KanjiCanvas recognition core and reference patterns | `vendor/kanjicanvas-core.js`, `data/kc-refs.json` | MIT, with a required link back to the project (`vendor/kanjicanvas.LICENSE`) |
| ts-fsrs scheduler | `vendor/ts-fsrs.js` | MIT (`vendor/ts-fsrs.LICENSE`) |
| Klee One and Zen Kaku Gothic New fonts | `fonts/` | SIL Open Font License 1.1 (`fonts/*-OFL.txt`) |
| Built-in kanji lists: KANJIDIC2 meanings, readings, grades and frequency ranks, and JMdict example words | `data/kanji-info.json` | CC BY-SA 4.0 ([EDRDG license](https://www.edrdg.org/edrdg/licence.html)); see `data/kanji-info-README.md` |
| JLPT levels | `data/kanji-info.json` | CC BY, Jonathan Waller ([tanos.co.uk](https://www.tanos.co.uk/jlpt/)) |
| WaniKani meanings, readings and vocabulary | not in this repository: fetched from each user's own account | © Tofugu LLC, under [WaniKani's terms](https://www.wanikani.com/terms) |

## Credits and licenses

- Stroke data and icon: adapted from [KanjiVG](https://kanjivg.tagaini.net) by Ulrich
  Apel, used under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
  (full text in `data/KanjiVG-COPYING.txt`). `data/strokes/` holds KanjiVG's stroke
  paths and stroke-number positions converted from SVG to JSON. The app icon
  (`icon.svg` and the PNG icons) draws KanjiVG's strokes for 書. Both are adaptations
  and are shared under the same CC BY-SA 3.0 license.
- Handwriting recognition: [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas) by
  Dominik Klein and Seth Clydesdale, MIT (`vendor/kanjicanvas.LICENSE`). The
  recognition functions are adapted in `vendor/kanjicanvas-core.js`.
- Scheduling: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), MIT
  (`vendor/ts-fsrs.LICENSE`).
- Built-in kanji lists: [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)
  and [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) by the Electronic Dictionary
  Research and Development Group, used under its
  [license](https://www.edrdg.org/edrdg/licence.html) (CC BY-SA 4.0). JLPT levels from
  [Jonathan Waller's JLPT lists](https://www.tanos.co.uk/jlpt/), CC BY. The EDRDG license
  places no restriction on commercial use. KANJIDIC's SKIP codes, which are under Jack
  Halpern's own license, aren't used.
- Kanji meanings, readings and vocabulary come from your own WaniKani account through
  its API and aren't bundled. That content is © Tofugu LLC and is covered by WaniKani's
  terms, not by this project's license.
- Fonts: Klee One (Fontworks) and Zen Kaku Gothic New (Yoshimichi Ohira), SIL Open
  Font License 1.1, bundled in `fonts/` with their license files.
