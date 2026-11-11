export type Dir = "up" | "down" | "left" | "right";
export type Point = { x: number; y: number };

export type SnakeState = {
  w: number;
  h: number;
  body: Point[];
  dir: Dir;
  apple: Point;
  apples: number;
  dead: boolean;
};

const DELTA: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function opposite(a: Dir, b: Dir): boolean {
  return (a === "up" && b === "down") || (a === "down" && b === "up") || (a === "left" && b === "right") || (a === "right" && b === "left");
}

function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function placeApple(w: number, h: number, body: Point[], random = Math.random): Point {
  const taken = new Set(body.map((point) => `${point.x},${point.y}`));
  const free: Point[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (!free.length) return body[0] ?? { x: 0, y: 0 };
  return free[Math.floor(random() * free.length)] ?? free[0];
}

export function freshSnake(w = 13, h = 13): SnakeState {
  const body = [
    { x: 4, y: 6 },
    { x: 3, y: 6 },
    { x: 2, y: 6 },
  ];
  return { w, h, body, dir: "right", apple: placeApple(w, h, body), apples: 0, dead: false };
}

export function tickSnake(state: SnakeState, dir: Dir, random = Math.random): SnakeState {
  if (state.dead) return state;
  const nextDir = opposite(state.dir, dir) ? state.dir : dir;
  const head = state.body[0];
  if (!head) return { ...state, dead: true };
  const step = DELTA[nextDir];
  const moved = { x: head.x + step.x, y: head.y + step.y };
  if (moved.x < 0 || moved.y < 0 || moved.x >= state.w || moved.y >= state.h) {
    return { ...state, dir: nextDir, dead: true };
  }
  const eat = same(moved, state.apple);
  const body = [moved, ...state.body];
  if (!eat) body.pop();
  if (body.slice(1).some((point) => same(point, moved))) {
    return { ...state, dir: nextDir, dead: true };
  }
  return {
    ...state,
    dir: nextDir,
    body,
    apples: state.apples + (eat ? 1 : 0),
    apple: eat ? placeApple(state.w, state.h, body, random) : state.apple,
    dead: false,
  };
}
