import test from 'node:test';import assert from 'node:assert/strict';
import {LegacyAuthoringAdapter,type LegacyRecipe,type LegacySessionPort} from '../../src/legacy-authoring.ts';
import {authoringBinding} from '../../src/authoring-api.ts';
import {EncounterOperations} from '../src/operations-core.ts';
import {executeRuntimeOperation,operationInputs} from '../src/operation-inputs.ts';
import type {ApiLike,ApiRequestOptions} from '../src/types.ts';
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;');
function fixture(checked:boolean){
 const binding=authoringBinding('tech.en.cx',42,'real-task-forms'),tasks=[{id:77,text:'Literal\n001<br>&',member:0,checked},{id:78,text:'Sibling code',member:0,checked:false}],requests:LegacyRecipe[]=[];
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,async dispatch(recipe){requests.push(recipe);const url=new URL(recipe.path,'https://tech.en.cx'),id=Number(url.searchParams.get('tid'));
  if(recipe.effect==='mutation'){assert.equal(recipe.kind,'task-update');const fields=new URLSearchParams(recipe.body);assert.equal(fields.get('unknown'),'preserve-'+id);const task=tasks.find(row=>row.id===id)!;task.text=fields.get('inputTask')!.replace(/\r\n|\r/g,'\n');task.member=Number(fields.get('forMemberID'));task.checked=fields.has('chkReplaceNlToBr');throw new Error('Opaque redirect');}
  let html:string;
  if(recipe.kind==='level-index')html='<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_9" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&amp;level=1">Level</a></td></tr></table>';
  else if(recipe.kind==='level-editor-read')html=tasks.map(task=>`<a href="javascript:GameEditor('./TaskEdit.aspx?gid=42&amp;level=1&amp;tid=${task.id}','Task_42_1_${task.id}')">Task</a>`).join('');
  else if(recipe.kind==='game-read')html='<table><tr><td>Играем:</td><td>В одиночку</td></tr></table>';
  else if(recipe.kind==='task-edit-read'){const task=tasks.find(row=>row.id===id)!;html=`<table><form method="post"><tr><td><textarea name="inputTask">${escape(task.text)}</textarea><select name="forMemberID"><option value="0"${task.member===0?' selected':''}>All</option><option value="900077"${task.member===900077?' selected':''}>Native member</option></select><input type="checkbox" name="chkReplaceNlToBr" value="false"${task.checked?' checked':''}><input name="unknown" value="preserve-${id}"><input type="image" name="btnUpdate"></td></tr></form></table>`;}
  else throw new Error('Unsupported fixture collection');
  return {status:200,url:'https://tech.en.cx'+recipe.path,html};
 }};
 const adapter=new LegacyAuthoringAdapter(session),api:ApiLike={authoringMetadata:async()=>adapter.metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){const response=await adapter.request(path,{method,headers:options.headers,...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});if(!response.ok)throw new Error('Rejected '+response.status);return await response.json()as T;}};
 const operations=new EncounterOperations(api,{name:'fixture',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx',domain:'tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async()=>''});return {adapter,operations,tasks,requests};
}
test('real canonical forms project newline state and support runtime flag-only, text and native-recipient writes',async()=>{
 for(const initial of [false,true]){
  const f=fixture(initial),sibling=structuredClone(f.tasks[1]);
  for(const path of ['/admin/games/42/levels/9/editor','/admin/games/42/levels/9/tasks','/admin/games/42/levels/9/tasks/77']){const dto=await(await f.adapter.request(path)).json();assert.equal(dto.tasks[0].replace_nl_to_br,initial);}
  f.requests.length=0;
  const flagOnly={gameId:42,levelId:9,taskId:77,replaceNlToBr:!initial,confirmed:true};assert.doesNotThrow(()=>operationInputs['update-task'].parse(flagOnly));await executeRuntimeOperation(f.operations,'update-task',flagOnly);assert.equal(f.tasks[0].checked,!initial);assert.equal(f.tasks[0].text,'Literal\n001<br>&');
  await executeRuntimeOperation(f.operations,'update-task',{gameId:42,levelId:9,taskId:77,taskText:'A\rB\r\nC\n<br>&',replaceNlToBr:initial,confirmed:true});assert.equal(f.tasks[0].checked,initial);assert.equal(f.tasks[0].text,'A\nB\nC\n<br>&');
  await executeRuntimeOperation(f.operations,'update-task',{gameId:42,levelId:9,taskId:77,forMemberId:900077,confirmed:true});assert.equal(f.tasks[0].member,900077);assert.equal(f.tasks[0].checked,initial);assert.equal(f.tasks[0].text,'A\nB\nC\n<br>&');assert.deepEqual(f.tasks[1],sibling);assert.equal(f.requests.filter(recipe=>recipe.effect==='mutation').length,3);
  assert.ok(f.requests.every(recipe=>!['hint-edit-read','bonus-form-read','answer-list-read'].includes(recipe.kind)));
 }
});
