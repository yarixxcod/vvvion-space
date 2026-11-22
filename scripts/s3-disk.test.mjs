import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import ts from "typescript";
const objects=new Map();let calls=0;
class Command {constructor(input){this.input=input;}}
class PutObjectCommand extends Command {}
class GetObjectCommand extends Command {}
class DeleteObjectCommand extends Command {}
class S3Client {
  constructor(config){assert.equal(config.forcePathStyle,true);}
  destroy(){}
  async send(command){
    calls++;const c=command.input;
    if(command instanceof PutObjectCommand){objects.set(c.Key,Buffer.from(c.Body));assert.notEqual(c.ACL,"public-read");return {};}
    if(command instanceof DeleteObjectCommand){objects.delete(c.Key);return {};}
    const bytes=objects.get(c.Key);if(!bytes)throw {$metadata:{httpStatusCode:404}};
    return {ContentLength:bytes.length,Body:(async function*(){yield bytes;})()};
  }
}
const output=ts.transpileModule(readFileSync("src/lib/storage/s3.server.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const storage={};new Function("require","exports",output)(id=>id==="node:crypto"?crypto:{S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand},storage);
Object.assign(process.env,{VVVION_S3_ENDPOINT:"https://example.com",VVVION_S3_BUCKET:"vvionspace",VVVION_S3_ACCESS_KEY_ID:"test",VVVION_S3_SECRET_ACCESS_KEY:"test",VVVION_DISK_S3_ENABLED:"true"});
test("new disk blobs go to private S3 and legacy base64 remains readable",async()=>{
  const pointer=await storage.encodeDiskBlob("alice",Buffer.from("hello"));assert.ok(pointer.startsWith("@vv-s3:1:"));
  assert.equal((await storage.decodeDiskBlob("alice",pointer)).toString(),"hello");
  assert.equal((await storage.decodeDiskBlob("alice","b2xk")).toString(),"old");
  const n=calls;await assert.rejects(storage.decodeDiskBlob("bob",pointer),/ссылка/);assert.equal(calls,n);
  process.env.VVVION_DISK_S3_ENABLED="false";
  assert.equal(await storage.encodeDiskBlob("alice",Buffer.from("old")),"b2xk");
  assert.equal((await storage.decodeDiskBlob("alice",pointer)).toString(),"hello");
  await storage.removeDiskBlob("alice",pointer);assert.equal(objects.size,0);
});
test("corruption never masquerades as a successfully read file",async()=>{
  process.env.VVVION_DISK_S3_ENABLED="true";
  const pointer=await storage.encodeDiskBlob("alice",Buffer.from("hello"));
  const [key]=objects.keys();objects.set(key,Buffer.from("other"));
  await assert.rejects(storage.decodeDiskBlob("alice",pointer),/недоступен/);
});
