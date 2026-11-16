# Files and roles update

Only `uiux-polish-3.0.1`; no schema migrations or economy changes.

## Files

- Disk imports documents and static-site assets, up to 3 MiB per file, without overwriting an existing name. Folder import on Disk is one level; nested directory import is available on Mega.
- A site opens from its folder menu or an HTML file. The parent reads owner-scoped assets through authenticated server functions; the child receives data URLs, not account endpoints or credentials.
- Preview supports relative HTML links, CSS imports and URLs, classic JavaScript, ES module imports/re-exports/dynamic imports, local JSON/text fetch, and common image/font assets. Mobile width toggle, page selector and reload are included. Supported size: 100 relevant files / 12 MiB; at most eight nested preview levels. Build systems, server code and remote dependencies are not executed.
- Sandbox allows scripts but never same-origin access, forms, popups or account storage. CSP restricts resources to bundled data. Unknown local resources appear in a diagnostic disclosure.
- UTF-8 text/code editor supports TXT, Markdown, HTML, CSS, JS, JSON, CSV and other explicit text extensions up to 1 MiB; Markdown has rendered preview. Save shortcut, dirty state, download-current-copy and unsaved-close confirmation are provided.
- DOCX text editor changes paragraph text and can append paragraphs. It preserves ZIP parts, original paragraph properties and unaffected text runs. It is not a Word layout editor; embedded objects, fields, headers/footers and fine typography are outside its editing scope. DOCX limit is 3 MiB compressed / 40 MiB expanded / 2000 text paragraphs. In-paragraph Enter becomes a space.
- Disk save retains ID and checks version/name under a transaction plus quota lock. Empty text files remain downloadable.
- Mega save uploads a new file first and atomically swaps names only after checking the original version. Old bytes remain under a backup name, including old download/share IDs. The new version retains the original filename so neighboring HTML/CSS/JS references work. This requires room for both versions. If conflict occurs after upload, the uploaded draft stays available under its draft name.

## Roles

- Shop section label is now “Роли и персонажи”; existing `look` navigation key remains compatible.
- Added Programmer (900 vubles) and Analyst (800); all existing prices are unchanged. These use existing purchase/ownership/Premium rules.
- Role selection moved from deep settings to the composer `+` menu alongside the model selector, on phones and desktop. The menu links to the full shop and closes after a successful selection.
- Distinct 768px WebP portraits are stored in `public/personas/programmer-v2.webp` and `analyst-v2.webp`. Generated separately in the built-in image tool, using semi-realistic digital portrait prompts: programmer with charcoal/teal clothing, dark waves, glasses and lavender/cyan light; analyst with dark curls, plum blazer, gold glasses, chart tablet and teal/lavender light. No text or logos.

## Validation

Ownership rejection, stale/renamed versions, quota failure, empty text save, failed Mega upload preserving originals, successful Mega backup/name swap, import validation and duplicate-name protection have automated tests. Path/MIME/module rewrite cases have unit tests.

Browser checks use local test-owned records: multi-file HTML/CSS/ES modules/JSON, JS click, page navigation, opaque-origin isolation, Markdown save/reopen, DOCX save/reopen/download, roles selection and mobile 390px screens. Downloaded edited DOCX is a valid ZIP; title style and bold run remain. Live remote Mega writes require a signed-in subscribed user and were validated with mocked storage failure/success cases rather than modifying real user files.

TinyFish credential is stored as a Production-only sensitive server variable, never in source. One authenticated control query returned HTTP 200 and 10 results. New deployments pick it up.
