# Built-in kanji lists

`kanji-info.json` holds the JLPT, school-grade and frequency lists, with meanings,
readings and example words, so Kakitori can be used without WaniKani. It's built by
`tools/build_kanji_info.py` and rebuilt every month by
`.github/workflows/update-kanji-data.yml` from the latest data, because the EDRDG licence
asks for regular updates. The `sources` field in the file records which KANJIDIC2 and
JMdict release it was built from.

| Data | Source | License |
| --- | --- | --- |
| Meanings, on/kun readings, school grades, frequency ranks, stroke counts | [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), Electronic Dictionary Research and Development Group (EDRDG), via [jmdict-simplified](https://github.com/scriptin/jmdict-simplified)'s weekly JSON releases | [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html) |
| Example words with readings and English glosses | [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html), EDRDG, via jmdict-simplified | [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html) |
| JLPT levels N5–N1 and their order | [Jonathan Waller's JLPT lists](https://www.tanos.co.uk/jlpt/), via [Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary) | CC BY |

To choose example words, the build also reads the JLPT vocabulary lists from
[open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) (MIT,
Jamie Sinclair) to favor words on a JLPT list. Nothing from those lists is stored in the
file.

Changes: entries were reduced to the fields Kakitori uses, meanings capped at six and
readings at four on'yomi and five kun'yomi, and up to four example words chosen per kanji
(favoring JLPT words and common companion kanji). `kanji-info.json` is shared under
CC BY-SA 4.0.

The JLPT has published no official kanji lists since 2010; these levels are the widely
used unofficial lists. The EDRDG license places no restriction on commercial use. KANJIDIC's
SKIP codes, which are under Jack Halpern's own license, aren't included.
