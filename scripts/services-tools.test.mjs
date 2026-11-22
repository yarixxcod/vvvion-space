import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
// Use strip-types in a child because this suite also runs under plain Node.
const run = (source) =>
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    { encoding: "utf8" },
  );
test("shared YouTube links normalize without tracking or playlist expansion", () => {
  run(`import assert from 'node:assert/strict'; import {normalizeGrabUrl,youtubeFormat} from './src/lib/social/grab-options.ts';
    for (const raw of ['Посмотри https://youtu.be/dQw4w9WgXcQ?si=tracking','https://m.youtube.com/shorts/dQw4w9WgXcQ?feature=share','https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=playlist&t=30','https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ','http://youtu.be/dQw4w9WgXcQ','youtu.be/dQw4w9WgXcQ','https://music.youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com/attribution_link?a=1&u=%2Fwatch%3Fv%3DdQw4w9WgXcQ%26feature%3Dshare','https://www.youtube.com/redirect?q=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ','https://youtu.be/'+String.fromCharCode(0x200b)+'dQw4w9WgXcQ']) assert.equal(normalizeGrabUrl(raw),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    for (const raw of ['https://youtu.be/short','https://youtube.com/@channel','https://youtube.com/playlist?list=a','https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ','https://u:p@youtube.com/watch?v=dQw4w9WgXcQ']) assert.throws(()=>normalizeGrabUrl(raw));
    assert.match(normalizeGrabUrl('Вот ролик https://vm.tiktok.com/Zabc/'), /tiktok\\.com\\/Zabc/);
    assert.match(normalizeGrabUrl('https://www.instagram.com/reel/AbC123/?igsh=1'), /instagram\\.com\\/reel\\/AbC123/);
    assert.match(normalizeGrabUrl('смотри https://ig.me/s/AbCdEf'), /ig\\.me\\/s\\/AbCdEf/);
    assert.equal(youtubeFormat('audio'),'ba[ext=m4a]/ba');
    assert.ok(youtubeFormat('small').includes('height<=360')); assert.ok(!youtubeFormat('video').includes('bv'));`);
});
test("download stream handles fragmented UTF-8 and a final event without newline", () => {
  run(`import assert from 'node:assert/strict'; import {readGrabStream} from './src/lib/social/grab-stream.ts';
    const data=new TextEncoder().encode(JSON.stringify({type:'progress',phase:'open',pct:8,loaded:0,total:0})+'\\n'+JSON.stringify({type:'done',files:[{name:'Ролик.mp4'}]}));
    const events=[]; await readGrabStream(new ReadableStream({start(c){for(let i=0;i<data.length;i++)c.enqueue(data.slice(i,i+1));c.close();}}),e=>events.push(e));
    assert.equal(events.length,2);assert.equal(events[1].files[0].name,'Ролик.mp4');`);
});
test("speed units and median resist a latency outlier", () => {
  run(`import assert from 'node:assert/strict'; import {median,mbps,measureSpeed} from './src/lib/speed/measure.ts';
    assert.equal(mbps(1000000,1000),8);assert.equal(mbps(0,0),0);assert.equal(median([20,22,4000,21,19]),21);assert.equal(median([10,20]),15);
    let requests=0;globalThis.fetch=async()=>{requests++;throw new Error('unexpected');};const c=new AbortController();c.abort(); await assert.rejects(()=>measureSpeed(c.signal,()=>{}),{name:'AbortError'});assert.equal(requests,0);`);
});

test("publisher RSS preserves headlines, photographs and safe plain descriptions", () => {
  run(`import assert from 'node:assert/strict'; import {parseRss} from './src/lib/news/parse.ts';
    const xml='<rss><channel><item><title>Событие - комментарий</title><link>https://news.example/story</link><description>&lt;b&gt;Текст&lt;/b&gt; &amp; совет&nbsp; дня</description><enclosure url="https://news.example/photo.webp?a=1&amp;b=2"/><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>';
    const [item]=parseRss(xml,'KG','Издание');assert.equal(item.title,'Событие - комментарий');assert.equal(item.source,'Издание');assert.equal(item.image,'https://news.example/photo.webp?a=1&b=2');assert.equal(item.description,'Текст & совет дня');
    assert.equal(parseRss(xml.replace('https://news.example/photo.webp?a=1&amp;b=2','javascript:alert(1)'),'KG','Издание')[0].image,null);`);
});
