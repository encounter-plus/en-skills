import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerImportPlanTools} from '../src/import-plan-tools.ts';
import {syntheticPlan,syntheticHost} from './import-plan-fixture.ts';
test('MCP scope journal prevents a new plan from bypassing an uncertain write',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'import-scope-')),f=syntheticHost();const handlers=new Map<string,(a:any)=>Promise<any>>();const server={registerTool:(name:string,_config:unknown,handler:(a:any)=>Promise<any>)=>handlers.set(name,handler)} as unknown as McpServer;
 registerImportPlanTools(server,async()=>f.host,()=>dir);const call=async(name:string,args:unknown)=>JSON.parse((await handlers.get(name)!(args)).content[0].text);
 try{const first=await call('encounter_prepare_import_plan',{plan:syntheticPlan});f.failAfter('tasks');await call('encounter_create_level_from_plan',{planRef:first.planRef,levelKey:'brief',confirmed:true});const second=await call('encounter_prepare_import_plan',{plan:{...syntheticPlan,request:'new plan'}});const n=f.calls.length;const blocked=await call('encounter_create_level_from_plan',{planRef:second.planRef,levelKey:'brief',confirmed:true});assert.equal(blocked.error.code,'unfinished-import');assert.equal(f.calls.length,n);await call('encounter_reconcile_import_plan',{planRef:first.planRef});assert.equal((await call('encounter_create_level_from_plan',{planRef:first.planRef,levelKey:'dialog',confirmed:true})).status,'complete');}finally{await rm(dir,{recursive:true,force:true});}
});
