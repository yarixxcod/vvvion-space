import test from 'node:test';import {execFileSync} from 'node:child_process';
test('Connect agent config, protobuf and persistent per-account counters',()=>{execFileSync('python3',['scripts/connect/test_agent.py'],{stdio:'pipe'});});
