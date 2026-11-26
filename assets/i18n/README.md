# Site translations

The homepage, including its news reader, loads its interface text from these files. `en.json` is the
source and the fallback for any missing key.

- **Add a language:** copy `pt-BR.json`, translate the values (never the keys), save it as `<code>.json`
  (a BCP 47 code such as `fr` or `de`), then add it to `LANGS` and to `pickLang()` in `assets/js/i18n.js`.
  Keys starting with `board.`, plus `meta.boardTitle`, `nav.board` and `effort.discuss`, belong to the
  removed discussion board and can be omitted along with other unused keys for removed sections.
- **Placeholders** such as `{n}`, `{ago}` or `{name}` are filled in by the page. Keep them as they are.
- **`_one` / `_other`** keys are the singular and plural forms of a count.
- **Scoring strings** for milestones, groundwork, tracks and stability come from `assets/js/scoring.js`.
  Translate them under `ms.*`, `gw.*`, `track.*` and `stab.*` when using `pt-BR.json` as a template.
- **Text only:** translations are inserted as plain text, so HTML in a value shows up literally.
- **Not translated:** project summaries, news articles and other content from `data/tracker.json` stay in
  English, and so do the article pages under `news/`.

Contributions are welcome through a pull request.
