import { test } from "node:test";
import { execFileSync } from "node:child_process";
test("puzzle rules: no double merge, unchanged moves, game over, solvability and pairs", () => {
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `
 import assert from 'node:assert/strict';import {moveTiles,spawnTile,tilesOver,toggleLights,newLights,shuffledPairs} from './src/lib/games/puzzles.ts';
 let b=[2,2,2,2,...Array(12).fill(0)];let r=moveTiles(b,'left');assert.deepEqual(r.board.slice(0,4),[4,4,0,0]);assert.equal(r.score,8);assert.deepEqual(b.slice(0,4),[2,2,2,2]);
 assert.equal(moveTiles([2,0,0,0,...Array(12).fill(0)],'left').changed,false);
 assert.deepEqual(moveTiles(b,'right').board.slice(0,4),[0,0,4,4]);
 const dead=[2,4,2,4,4,2,4,2,2,4,2,4,4,2,4,2];assert.equal(tilesOver(dead),true);assert.equal(tilesOver(Array(16).fill(2)),false);assert.deepEqual(spawnTile(dead),dead);
 for(let i=0;i<25;i++){const off=Array(25).fill(false);assert.deepEqual(toggleLights(toggleLights(off,i),i),off);}
 assert.equal(toggleLights(Array(25).fill(false),0).filter(Boolean).length,3);
 const pairs=shuffledPairs(()=>.3);for(let i=0;i<8;i++)assert.equal(pairs.filter(n=>n===i).length,2);assert.equal(newLights(()=>.2).some(Boolean),true);
 `,
    ],
    { stdio: "pipe" },
  );
});
