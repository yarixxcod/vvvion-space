export type MoveDirection = "up" | "down" | "left" | "right";
export function moveTiles(
  board: number[],
  direction: MoveDirection,
): { board: number[]; score: number; changed: boolean } {
  if (board.length !== 16) throw new Error("Board must have 16 cells");
  const next = board.slice();
  let score = 0;
  for (let line = 0; line < 4; line++) {
    const indices = Array.from({ length: 4 }, (_, step) =>
      direction === "left"
        ? line * 4 + step
        : direction === "right"
          ? line * 4 + 3 - step
          : direction === "up"
            ? step * 4 + line
            : (3 - step) * 4 + line,
    );
    const values = indices.map((i) => board[i]).filter(Boolean);
    const merged: number[] = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] === values[i + 1]) {
        const n = values[i] * 2;
        merged.push(n);
        score += n;
        i++;
      } else merged.push(values[i]);
    }
    indices.forEach((index, i) => {
      next[index] = merged[i] || 0;
    });
  }
  return { board: next, score, changed: next.some((n, i) => n !== board[i]) };
}
export function spawnTile(board: number[], random = Math.random): number[] {
  const empty = board.map((n, i) => (n ? -1 : i)).filter((i) => i >= 0);
  if (!empty.length) return board;
  const next = board.slice();
  next[empty[Math.min(empty.length - 1, Math.floor(random() * empty.length))]] =
    random() < 0.9 ? 2 : 4;
  return next;
}
export function tilesOver(board: number[]): boolean {
  return (
    !board.includes(0) &&
    (["up", "down", "left", "right"] as const).every((d) => !moveTiles(board, d).changed)
  );
}
export function shuffledPairs(random = Math.random): number[] {
  const cards = Array.from({ length: 16 }, (_, i) => i % 8);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function toggleLights(board: boolean[], index: number): boolean[] {
  if (board.length !== 25 || index < 0 || index >= 25 || !Number.isInteger(index)) return board;
  const x = index % 5,
    y = Math.floor(index / 5);
  const next = board.slice();
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx,
      ny = y + dy;
    if (nx >= 0 && nx < 5 && ny >= 0 && ny < 5) next[ny * 5 + nx] = !next[ny * 5 + nx];
  }
  return next;
}
export function newLights(random = Math.random): boolean[] {
  let board = Array<boolean>(25).fill(false);
  for (let i = 0; i < 12; i++) board = toggleLights(board, Math.floor(random() * 25));
  return board.some(Boolean) ? board : toggleLights(board, 12);
}
