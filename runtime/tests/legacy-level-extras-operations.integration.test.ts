import test from 'node:test';
import assert from 'node:assert/strict';
import {LegacyLevelExtras} from '../../src/legacy-level-extras.ts';
import {authoringBinding} from '../../src/authoring-api.ts';
import type {LegacySessionPort,LegacyRecipe} from '../../src/legacy-authoring.ts';
const binding=authoringBinding('tech.en.cx',42,'opaque');
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const page=(path:string,html:string)=>({status:200,url:'https://tech.en.cx'+path,html});
const index='<form name="LevelsCreateForm"></form><table><tr><td><input name="txtLevelName_154" value="Level"><a href="/Administration/Games/LevelEditor.aspx?gid=42&level=2">2</a></td></tr><tr><td><input name="txtLevelName_155" value="Next"><a href="/Administration/Games/LevelEditor.aspx?gid=42&level=3">3</a></td></tr></table>';
function fixture(){
 let name='Before',comment='literal 001 + &',timeout=900,penalty=false,penaltyDuration=187,attempts=4,allSectors=false,sectors=1,message:{id:number;text:string;targets:number[]}|undefined;
 let messageAll=false,messageReplace=false;const calls:LegacyRecipe[]=[];let orderChanged=false,moveAfterForm=false,moveAfterWrite=false,messageRace=false,messageFormReads=0,messageDeleteHref:string|undefined;
 const field=(name:string,value:unknown,disabled=false)=>`<input name="${name}" value="${escape(String(value))}"${disabled?' disabled':''}>`;
 const meta=()=>`<input type="hidden" name="outside" value="foreign"><table><form method="post"><tr><td>${field('txtLevelName',name)}<textarea name="txtLevelComment">${escape(comment)}</textarea><input type="image" name="btnUpdate"></td></tr></form></table>`;
 const autopass=()=>`<form method="post">${field('txtApHours',Math.floor(timeout/3600))}${field('txtApMinutes',Math.floor(timeout/60)%60)}${field('txtApSeconds',timeout%60)}<input type="checkbox" name="chkTimeoutPenalty" value="false"${penalty?' checked':''}>${field('txtApPenaltyHours',Math.floor(penaltyDuration/3600),!penalty)}${field('txtApPenaltyMinutes',Math.floor(penaltyDuration/60)%60,!penalty)}${field('txtApPenaltySeconds',penaltyDuration%60,!penalty)}<input type="hidden" name="updateautopass" value=""><input type="image" name="ctl01_ctl00_ctl03"></form>`;
 const blocking=()=>`<form method="post">${field('txtAttemptsNumber',attempts)}${field('txtAttemptsPeriodHours',0)}${field('txtAttemptsPeriodMinutes',2)}${field('txtAttemptsPeriodSeconds',0)}<input type="radio" name="rbApplyForPlayer" value="1"><input type="radio" name="rbApplyForPlayer" value="2" checked><input type="hidden" name="action" value="upansblock"><input type="hidden" name="unknown" value="preserve"><input type="image" name="pnlSettings_AnswerBlockingSettings_ctl00_ctl08"></form>`;
 const sector=()=>`<form method="post"><input type="radio" name="rbSectorCompleteType" value="1"${allSectors?' checked':''}><input type="radio" name="rbSectorCompleteType" value="2"${!allSectors?' checked':''}>${field('txtRequiredSectorsCount',sectors,allSectors)}<input type="hidden" name="action" value="upsecsett"><input type="image" name="pnlSettings_SectorsCompletionSettings_ctl00_btnSave"></form>`;
 const links=()=>message?`<a href="javascript:GameEditor('/Administration/Games/MessageEdit.aspx?level=154&gid=42&mid=${message.id}','',700,700)">Message</a>`:'';
 const messageForm=(create:boolean)=>`<form method="post"><textarea name="txtMessage">${escape(message?.text??'')}</textarea><input type="checkbox" name="chkReplaceNlToBr"${messageReplace?' checked':''}><input type="radio" name="rbShowOnLevels" value="1"${messageAll?' checked':''}><input type="radio" name="rbShowOnLevels" value="2"${!messageAll?' checked':''}>${[154,155].map(id=>`<input type="checkbox" name="lvl_${id}"${(message?.targets??[154]).includes(id)?' checked':''}>`).join('')}<input type="hidden" name="action" value="${create?'save':'update'}"><input type="image" name="${create?'btnSave':'btnUpdate'}"></form>`;
 const session:LegacySessionPort={binding,currentBinding:async()=>binding,dispatch:async recipe=>{
  calls.push(recipe);const url=new URL(recipe.path,'https://tech.en.cx');
  if(recipe.effect==='mutation'){if(moveAfterWrite)orderChanged=true;
   if(recipe.kind==='message-delete')message=undefined;
   else {const body=new URLSearchParams(recipe.body);if(recipe.kind==='message-write'){messageAll=body.get('rbShowOnLevels')==='1';messageReplace=body.has('chkReplaceNlToBr');message={id:91,text:body.get('txtMessage')!.replaceAll('\r\n','\n'),targets:messageAll?[154,155]:[154,155].filter(id=>body.has('lvl_'+id))};}else if(url.pathname.endsWith('NameCommentEdit.aspx')){name=body.get('txtLevelName')!;comment=body.get('txtLevelComment')!.replaceAll('\r\n','\n');}else if(body.has('updateautopass')){timeout=Number(body.get('txtApHours'))*3600+Number(body.get('txtApMinutes'))*60+Number(body.get('txtApSeconds'));penalty=body.has('chkTimeoutPenalty');penaltyDuration=penalty?Number(body.get('txtApPenaltyHours'))*3600+Number(body.get('txtApPenaltyMinutes'))*60+Number(body.get('txtApPenaltySeconds')):0;}else if(body.get('action')==='upansblock'){assert.equal(body.get('unknown'),'preserve');attempts=Number(body.get('txtAttemptsNumber'));}else if(body.get('action')==='upsecsett'){allSectors=body.get('rbSectorCompleteType')==='1';if(!allSectors)sectors=Number(body.get('txtRequiredSectorsCount'));else assert.equal(body.has('txtRequiredSectorsCount'),false);}}
   return {status:0,url:'https://tech.en.cx'+recipe.path,html:''};
  }
  if(url.pathname.endsWith('LevelManager.aspx'))return page(recipe.path,orderChanged?index.replaceAll('level=2','level=swap').replaceAll('level=3','level=2').replaceAll('level=swap','level=3'):index);
  if(url.pathname.endsWith('NameCommentEdit.aspx')){const html=meta();if(moveAfterForm)orderChanged=true;return page(recipe.path,html);}
  if(url.pathname.endsWith('LevelInfo.aspx'))return page(recipe.path,autopass());
  if(recipe.kind==='message-view-read')return page(recipe.path,`<a href="${escape(messageDeleteHref??`/Administration/Games/MessageEdit.aspx?level=154&gid=42&action=delete&mid=${message!.id}`)}" onclick="return ConfirmDelete();">Delete</a>`);
  if(url.pathname.endsWith('MessageEdit.aspx')){if(messageRace&&++messageFormReads===2&&message)message.text='changed remotely';return page(recipe.path,messageForm(url.searchParams.get('action')==='add'));}
  return page(recipe.path,'<form name="MainForm" method="post"></form>'+blocking()+sector()+links());
 }};
 return {api:new LegacyLevelExtras(session),calls,message:()=>message,reorderAfterForm:()=>{moveAfterForm=true;},reorderAfterWrite:()=>{moveAfterWrite=true;},raceMessage:()=>{messageRace=true;messageFormReads=0;},badDeleteLink:(href:string)=>{messageDeleteHref=href;}};
}

import {EncounterOperations} from '../src/operations-core.ts';
import {authoringMetadata} from '../../src/authoring-api.ts';
import type {ApiLike,ApiRequestOptions} from '../src/types.ts';
function operationsFor(adapter:{request(path:string,init?:RequestInit):Promise<Response|undefined>},levelId:number,capabilities:Parameters<typeof authoringMetadata>[1]){
 const metadata=authoringMetadata(authoringBinding('tech.en.cx',42,'integration'),capabilities);
 const api:ApiLike={authoringMetadata:async()=>metadata,async request<T>(method:string,path:string,options:ApiRequestOptions={}){
  if(path.endsWith('/editor'))return {level:{level_id:levelId,level_number:1}} as T;
  if(path.includes('live-statistics'))throw new Error('Legacy live unavailable');
  const response=await adapter.request(path,{method,headers:options.headers,body:options.body===undefined?undefined:JSON.stringify(options.body)});
  if(!response?.ok)throw new Error('Rejected '+response?.status);return await response.json() as T;
 }};
 return new EncounterOperations(api,{name:'fixture',apiBaseUrl:'https://tech.en.cx',webBaseUrl:'https://tech.en.cx',domain:'tech.en.cx'},{writesEnabled:()=>true,saveSnapshot:async()=>{throw new Error('No snapshots');}});
}
test('runtime messages traverse actual form with revision and literal newlines',async()=>{
 const f=fixture(),operations=operationsFor(f.api,154,['message-update']);
 await operations.postMessage({gameId:42,levelId:154,messageText:'001 + &\r\nLiteral'});
 assert.deepEqual(f.message(),{id:91,text:'001 + &\nLiteral',targets:[154]});
 assert.equal(f.calls.filter(row=>row.effect==='mutation').length,1);
 assert.equal(new URLSearchParams(f.calls.find(row=>row.kind==='message-write')!.body).has('chkReplaceNlToBr'),false);
});
test('runtime legacy messages reject unprepared all-level targets',async()=>{
 const f=fixture(),operations=operationsFor(f.api,154,['message-update']);
 for(const extra of [{allLevels:true},{allLevels:true,levelIds:[154]}])await assert.rejects(operations.postMessage({gameId:42,levelId:154,messageText:'x',...extra}),/unsupported|incomplete-read/);
 assert.equal(f.calls.some(row=>row.effect==='mutation'),false);
});

test('runtime messages forward checked conversion and explicit full all-level targets through native forms',async()=>{
 const f=fixture(),operations=operationsFor(f.api,154,['message-update']);
 await operations.postMessage({gameId:42,levelId:154,messageText:'A\rB\r\nC',allLevels:true,levelIds:[154,155],replaceNlToBr:true});
 assert.deepEqual(f.message(),{id:91,text:'A\nB\nC',targets:[154,155]});const body=new URLSearchParams(f.calls.find(row=>row.kind==='message-write')!.body);assert.equal(body.get('rbShowOnLevels'),'1');assert.equal(body.has('chkReplaceNlToBr'),true);assert.equal(f.calls.filter(row=>row.effect==='mutation').length,1);
});
