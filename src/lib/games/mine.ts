export type MineCell = { mine: boolean; n: number; open: boolean; flag: boolean };

export function around(index: number, w: number, h: number): number[] {
  const x = index % w;
  const y = Math.floor(index / w);
  const near: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      near.push(ny * w + nx);
    }
  }
  return near;
}

export function blankField(size: number): MineCell[] {
  return Array.from({ length: size }, () => ({ mine: false, n: 0, open: false, flag: false }));
}

export function layMines(cells: MineCell[], safe: number, count: number, w: number, random = Math.random): MineCell[] {
  const h = Math.max(1, Math.round(cells.length / w));
  const banned = new Set([safe, ...around(safe, w, h)]);
  const spots = cells.map((_, index) => index).filter((index) => !banned.has(index));
  for (let i = spots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = spots[i];
    spots[i] = spots[j] ?? swap;
    spots[j] = swap;
  }
  const next = cells.map((cell) => ({ mine: false, n: 0, open: false, flag: cell.flag }));
  for (const index of spots.slice(0, Math.min(count, spots.length))) {
    const cell = next[index];
    if (cell) cell.mine = true;
  }
  next.forEach((cell, index) => {
    if (cell.mine) return;
    cell.n = around(index, w, h).filter((near) => next[near]?.mine).length;
  });
  return next;
}

export function revealMine(cells: MineCell[], index: number, w: number): { cells: MineCell[]; boom: boolean } {
  const cell = cells[index];
  if (!cell || cell.open || cell.flag) return { cells, boom: false };
  const h = Math.max(1, Math.round(cells.length / w));
  if (cell.mine) {
    const next = cells.map((item) => (item.mine ? { ...item, open: true } : { ...item }));
    const hit = next[index];
    if (hit) hit.open = true;
    return { cells: next, boom: true };
  }
  const next = cells.map((item) => ({ ...item }));
  const stack = [index];
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined) break;
    const item = next[current];
    if (!item || item.open || item.flag || item.mine) continue;
    item.open = true;
    if (item.n === 0) {
      for (const near of around(current, w, h)) stack.push(near);
    }
  }
  return { cells: next, boom: false };
}

export function toggleFlag(cells: MineCell[], index: number): MineCell[] {
  const cell = cells[index];
  if (!cell || cell.open) return cells;
  return cells.map((item, at) => (at === index ? { ...item, flag: !item.flag } : item));
}

export function mineWon(cells: MineCell[]): boolean {
  return cells.length > 0 && cells.every((cell) => cell.mine || cell.open);
}
