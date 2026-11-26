# Site translations

The homepage and the board load their interface text from these files. `en.json` is the source and the
fallback: any key missing from another language shows in English.

- **Add a language:** copy `pt-BR.json`, translate the values (never the keys), save it as `<code>.json`
  (a BCP 47 code such as `fr` or `de`), then add it to `LANGS` and to `pickLang()` in `assets/js/i18n.js`.
- **Placeholders** such as `{n}`, `{ago}` or `{name}` are filled in by the page. Keep them as they are.
- **`_one` / `_other`** keys are the singular and plural forms of a count.
- **`ms.*`, `track.*`, `gw.*` and `stab.*`** translate the milestone, track, groundwork and stability names. Their English
  lives in `assets/js/scoring.js`, so `en.json` doesn't repeat them.
- **Text only:** translations are inserted as plain text, so HTML in a value shows up literally.
- **Not translated:** project summaries, news articles and other content from `data/tracker.json` stay in
  English, and so do the article pages under `news/`.

Contributions are welcome through a pull request.
