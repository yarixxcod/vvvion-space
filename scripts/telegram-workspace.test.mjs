import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
test('Telegram webhook, account isolation, delivery receipts and shared chats',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 execFileSync(process.execPath,['--experimental-strip-types','--test','src/lib/social/telegram-workspace.test.ts'],{env,stdio:'pipe',timeout:120000});
});
