# Built-in kanji lists

`kanji-info.json` holds the JLPT, school-grade and frequency lists, with meanings,
readings and example words, so Kakitori can be used without WaniKani. It's built by
`tools/build_kanji_info.py` from:

| Data | Source | License |
| --- | --- | --- |
| Meanings, on/kun readings, school grades, frequency ranks, stroke counts | [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), Electronic Dictionary Research and Development Group (EDRDG), via the `kanjidic2-json` npm package | [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html) |
| Example words with readings and English glosses | [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html), EDRDG, via the `kotobako-data` npm package (jmdict-simplified 3.6.2) | [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html) |
| JLPT levels N5–N1 and their order | [Jonathan Waller's JLPT lists](https://www.tanos.co.uk/jlpt/), via [Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary) | CC BY |

Changes: entries were reduced to the fields Kakitori uses, meanings capped at six and
readings at four on'yomi and five kun'yomi, and up to four example words chosen per kanji
(favoring JLPT words and common companion kanji). `kanji-info.json` is shared under
CC BY-SA 4.0.

The JLPT has published no official kanji lists since 2010; these levels are the widely
used unofficial lists. KANJIDIC's frequency rankings come from Jack Halpern, whose terms
prohibit commercial use of the frequency numbers without his written permission.
