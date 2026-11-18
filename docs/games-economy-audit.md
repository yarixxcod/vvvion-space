# Games: economy and UI audit

The existing reward rates and rolling 24-hour caps are preserved:

| Game | Per reward | Cap | Minimum interval |
| --- | --- | --- | --- |
| Stall | 4 / 6 / 8 / 10 / 12 | 60 | 20 seconds |
| Snake | 2 per three apples | 36 | 4 seconds |
| Mines | 8 per win | 40 | 12 seconds |

Combined ceiling is 136 Vubli per account per rolling 24 hours. These are virtual wallet credits. The three new practice games (2048, Memory, Lights Out) have no entry fees, purchases or payouts and never call wallet APIs. Their records live on the current device.

## Fixed

- Cap/cooldown checks, receipt insert, wallet credit and ledger entry now run in one transaction, taking the user's wallet row lock before evaluating eligibility. Parallel distinct claims cannot bypass a cap or interval.
- Retrying an identical receipt acknowledges it without another credit. Receipt ownership, game and amount must match. The stall advances an already acknowledged order after a lost response without duplicating its payout.
- A ledger write failure rolls back both the payout receipt and credit. Tests cover this injected failure, concurrent retries, cap/cooldown races, expiry and account isolation in an in-memory PGlite database.
- Original first-wallet grant behavior is preserved. No historical balances, receipts or ledger entries are rewritten, and no migrations are required.
- After the cap, games remain available without further rewards. Corrupt local stall saves are sanitized rather than crashing the screen.

## Remaining trust boundary

The legacy paid games still calculate gameplay outcomes on the client. This release hardens monetary settlement and bounds issuance, but does not claim to implement authoritative server simulation or bot prevention. A modified client can still request otherwise eligible rewards within the enforced caps. Raising caps or introducing valuable/withdrawable rewards should require server-issued rounds and server-validated move replays first. Multiple-account abuse is a separate identity/rate-policy issue.

## Artwork and themes

Six original generated game covers are stored as optimized `public/games/*-v2.webp`. Brief: premium centered 3D collectible dioramas, charcoal-purple backdrop, lavender lighting, no captions/logos; subjects are a market stall, snake/apple, minefield/flag, merging number tiles, matching symbols, and glowing light-grid. Real game boards are responsive React/CSS with original TypeScript logic, not screenshots of games.

All catalog artwork keeps its original colors. Theme-specific card backgrounds, borders, shadows and rarity badges adapt independently. No global inversion/brightness filter is applied to portraits or gifts.
