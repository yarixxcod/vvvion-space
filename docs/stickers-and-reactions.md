# Stickers and message reactions

The chat catalog grows from 48 to 104 stickers in nine packs: Cosmic Cat, Faces, Gestures, Hearts, Animals, Cats, Space, Mood and Food. The shared picker supports Russian label search, recent selections, accessible labels, loading-safe image fallback and both themes. All 96 OpenMoji SVGs are vendored unmodified in public/stickers/openmoji with attribution; eight original Cosmic Cat stickers are transparent 512px WebP assets in public/stickers. No sticker uploads or untrusted remote URLs are accepted through the marker protocol.

## AI behavior

The existing [[sticker:ID]] text marker remains compatible with old messages. User stickers are translated to a known catalog description in the model context, so text-only models understand the emotion without requiring vision support. This is descriptive metadata, not arbitrary image recognition.

The AI composer shares the picker. An on-device switch controls optional sticker replies (default on). The server injects a bounded guide listing the eight Cosmic Cat IDs, requests at most one sticker when appropriate, excludes serious/medical/crisis/business replies, and suppresses the offer if one of the previous three assistant messages already had a sticker. The model chooses whether to use it; a sticker is never added randomly by the client. Known markers render as images; unknown markers stay plain text, and rendering is capped at two stickers per message. Rendering also works in read-only shared transcripts.

The site's AI likes persist as the current account's personal liked flag in the existing chat history and cloud sanitizer. They do not automatically retrain a provider's model. During streaming the like control is disabled to avoid overwriting a live reply.

## Social chat reactions

An idempotent set-liked API checks an active authenticated account, room membership and the message's actual room before writing. The table's composite primary key guarantees one like per person/message. Unlike deletes only the actor's row; message/account deletion cascades reactions. The UI shows the aggregate count plus the actor's selection and preserves the existing message polling. The additive 0055 migration / authenticated lazy initializer create only room_message_likes; no balances, purchases or existing message bodies are rewritten.

## Assets

Original Cosmic Cat artwork generated with the built-in image generation tool, one illustration per emotion: hello/wave, love/heart, laugh/tears, think/chin, sad/tear, wow/stars, success/check and cozy coffee/scarf. Shared brief: charcoal cat, green eyes, lavender ears/collar/star charm, polished 3D-like illustration, ivory sticker outline, genuinely transparent background, full uncropped silhouette and no captions. Optimized WebP files retain transparency; source generation outputs are separate.

## Validation

PGlite integration tests exercise the actual reaction SQL: idempotent likes, per-person unlike, inaccessible rooms/messages and cascade cleanup. Protocol tests validate all 104 local assets/labels, old marker compatibility, rejected unknown IDs, descriptive AI input, bounded image rendering and reply cooldown. Browser QA uses the actual Transcript, Composer, StickerPicker and messenger Thread components with an isolated local fixture (no production users/messages). It checks search, sending, theme contrast, actual database reactions and persistence after reload. Live model output is inherently optional; no paid provider call is needed to validate the marker protocol.
