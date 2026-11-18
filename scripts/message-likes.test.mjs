import {test} from 'node:test';import {execFileSync} from 'node:child_process';
test('sticker protocol, local assets and message reaction privacy',()=>{const env={...process.env};delete env.NODE_TEST_CONTEXT;execFileSync(process.execPath,['--experimental-strip-types','--test','src/lib/social/message-likes.test.ts'],{env,stdio:'pipe',timeout:120000});});
