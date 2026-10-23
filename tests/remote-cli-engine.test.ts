import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runRemoteCommand} from '../src/remote-cli.ts';

test('remote CLI never treats a bearer token as a legacy browser session',async()=>{
 const priorToken=process.env.ENCOUNTER_ACCESS_TOKEN,priorFile=process.env.ENCOUNTER_LEGACY_SESSION_FILE,priorFetch=globalThis.fetch;
 let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No live requests allowed');};
 process.env.ENCOUNTER_ACCESS_TOKEN='synthetic-bearer';delete process.env.ENCOUNTER_LEGACY_SESSION_FILE;
 try{await assert.rejects(runRemoteCommand('encounter-game',{domain:'fixture.en.cx',game:'42'}),/ENCOUNTER_LEGACY_SESSION_FILE/);assert.equal(calls,0);await assert.rejects(runRemoteCommand('encounter-game',{domain:'evil.test',game:'42'}),/Unsupported Encounter/);}
 finally{globalThis.fetch=priorFetch;if(priorToken===undefined)delete process.env.ENCOUNTER_ACCESS_TOKEN;else process.env.ENCOUNTER_ACCESS_TOKEN=priorToken;if(priorFile===undefined)delete process.env.ENCOUNTER_LEGACY_SESSION_FILE;else process.env.ENCOUNTER_LEGACY_SESSION_FILE=priorFile;}
});
