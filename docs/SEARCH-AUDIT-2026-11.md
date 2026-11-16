# Web search audit — 2026-11-16

Scope: existing three integrations, answer grounding, persisted sources, responsive chat UI. No migrations or economy changes.

| Integration | Observation | Decision |
| --- | --- | --- |
| DuckDuckGo HTML | Live results on English documentation/comparison and Russian local queries. HTML is an unofficial, changeable interface and may return a challenge. | Keep primary; bounded body parsing, explicit blocked status, no challenge evasion. |
| TinyFish Search API | Production environment metadata has no TINYFISH_API_KEY. Authenticated results could not be evaluated. Previously the selection silently used fallback. | Preserve API integration; skip absent credentials, identify actual engine and explain missing connection in results. |
| FreeSERP web index | Live keyless JSON; documentation query included tangential pages. | Keep as reserve; relevance filtering and domain diversity, not a guarantee of authoritative evidence. |

Bing RSS was investigated as a replacement but returned an empty feed on a control query. It was not adopted.

## Changes

- Preserve full comparison questions rather than extracting a contextless first/last question.
- Unicode/short technical tokens, tracking-free deduplication without lowercasing case-sensitive paths, common subdomain grouping, bounded source diversity.
- Primary gets an 800 ms head start; backups start only when primary is slow or weak. Global 12 s deadline, cancellation and short bounded public-result cache (15 s changing facts / 45 s others).
- Stop on meaningful multi-domain evidence, not two arbitrary links. Wikipedia only for static encyclopedic questions and only within remaining budget.
- Do not force every Russian query to Russia; explicit Kazakhstan/Russia place cues set supported location.
- Search runs after access/usage checks. Provider keys stay server-side. Request log contains engines/count/timing, no query or excerpts.
- Model is told excerpts are untrusted, are not full-page reads, and cannot establish missing facts. No-results state must not masquerade as a successful web verification.
- Numbered source cards, domains, elapsed loading, actual engines/reserve, unavailable/empty states, cloud persistence. Inline numeric citations receive a badge only for a matching returned source URL.

## Validation and limits

Live smoke queries: `Vite official documentation`, `Алматы музей искусств Кастеева часы работы`, `C++ vs Rust memory safety`. Results varied: useful topical DuckDuckGo hits, but Vite also produced a namesake blockchain documentation site. Lexical ranking is not semantic fact verification; the grounding prompt explicitly checks entity context and the UI exposes domains and excerpts. No claim of broad retrieval accuracy from this small smoke set. Provider replacement needs broader evaluation and a configured authenticated candidate.

Tests cover query preservation, parsing, relevance, safe URLs, case-sensitive deduplication, quality-triggered reserve, missing credentials, timeout/cancellation, cache, source diversity and current-fact fallback policy. UI states checked at a 390 CSS-pixel frame in both themes; final Production chat flow is checked separately.

## Production follow-up

The first Production flow exposed a concrete relevance issue: response-format instructions polluted the query, and substring matching let React match Preact. Fixed both, added named-product coverage for documentation queries, and restricted documentation normalization to simple intent phrases so specialized constraints and versions are preserved. A fast reserve no longer cancels the selected primary before it finishes (the total deadline still applies).

Rechecking the exact Russian React/Vite question produced `Vite React documentation build`; the live combined result now started with React's official “Build a React app from Scratch” page and included Cloudflare's React/Vite guide. A namesake Vite documentation page still illustrates the limits of lexical retrieval; source context remains visible and the model must not treat a matching name as proof.
