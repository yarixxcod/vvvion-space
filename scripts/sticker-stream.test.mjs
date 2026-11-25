import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path, imports={}, extra='') {
 const source=readFileSync(path,'utf8')+extra;
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',js)(id=>imports[id]||{},mod,mod.exports);
 return mod.exports;
}
const stickers=load('src/lib/stickers.ts');
const reasoning=load('src/lib/ai/reasoning.ts');
const proxy=load('src/lib/ai/proxy.server.ts',{
 '@/lib/stickers':stickers,
 '@/lib/ai/reasoning':reasoning,
 '@/lib/ai/api-error':{readApiFailure:()=>undefined},
},'\nexport {normalizeSse,streamFromText,blankSink};');
const policy=stickers.stickerReplyPolicy([],new Date('2026-11-26'),'Asia/Almaty');
async function read(stream){
 const wire=await new Response(stream).text();
 const frames=wire.split('\n\n').filter(Boolean).map(frame=>{
 const event=frame.match(/^event: (.*)$/m)?.[1];
 const data=JSON.parse(frame.match(/^data: (.*)$/m)?.[1]||'{}');return {event,data};});
 return {frames,text:frames.filter(f=>f.event==='delta').map(f=>f.data.text).join('')};
}
test('real SSE normalizer repairs fragmented codes, drops premature holiday commands and saves the same visible text',async()=>{
 const raw='Привет! [[sticker:cosmo-cool]] [[sticker:winter-tree]] [[like]]';
 const upstream=new ReadableStream({start(c){for(const char of raw)c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:char}}]})}\n\n`));c.close();}});
 const sink=proxy.blankSink(policy);
 const result=await read(proxy.normalizeSse(upstream,'',()=>{},sink));
 assert.equal(result.text,'Привет! [[sticker:cosmo-yes]]  [[like]]');
 assert.equal(sink.text,result.text);
 assert.equal(result.frames.at(-1).event,'done');
 for(const f of result.frames.filter(f=>f.event==='delta'))if(f.data.text.includes('[[sticker:'))assert.match(f.data.text,/\]\]$/);
});
test('real nonstream/agent response applies the same season policy and permits an explicit holiday request',async()=>{
 const text='Подарок [[sticker:winter-gift]]';
 assert.equal((await read(proxy.streamFromText(text,null,'',proxy.blankSink(policy)))).text,'Подарок ');
 const explicit=stickers.stickerReplyPolicy([{role:'user',content:'Пришли новогодний стикер'}],new Date('2026-11-26'));
 assert.equal((await read(proxy.streamFromText(text,null,'',proxy.blankSink(explicit)))).text,text);
 const denied={...explicit,allowStickers:false};
 assert.equal((await read(proxy.streamFromText(text,null,'',proxy.blankSink(denied)))).text,'Подарок ');
});
