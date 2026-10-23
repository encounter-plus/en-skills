import test from 'node:test';
import assert from 'node:assert/strict';
import {EncounterClient} from '../src/encounter.ts';
import {authoringBinding,authoringMetadata,type AuthoringApiPort} from '../src/authoring-api.ts';
import {readRecalculationEvidence} from '../src/recalculation-evidence.ts';
import {calculateRecalculation} from '../src/recalculation.ts';
import {createCorrectionPlan} from '../src/correction-plan.ts';
import {executeCorrectionPlan,verifyCorrectionPlan,verifyCorrectionStatistics,type CorrectionJournal} from '../src/correction-executor.ts';

class NativeFixture implements AuthoringApiPort {
  metadata=authoringMetadata(authoringBinding('fixture.en.cx',42,'synthetic-native-session'),['corrections','monitoring-read']);
  finished=true;writeCount=0;loseResponse=false;unstable=false;reads=0;items:Record<string,unknown>[]=[];statisticFinished=1800000000000;
  invalidate(){}
  context(){const award=this.items.reduce((sum,row)=>sum+Number(row.correction_value),0);return {
    statistics:{gameId:42,mode:'team',finished:this.finished,startTime:{value:63935596800000,timestamp:1800000000},levels:[{levelId:154,levelNumber:2,dismissed:false}],rows:[{levelId:154,levelNumber:2,teamId:7,userId:8,teamName:'Synthetic',userName:'Synthetic',spentSeconds:100,passType:0,actionTime:{value:this.statisticFinished+62135596800000,timestamp:this.statisticFinished/1000},publishedCorrectionSeconds:0}],coverage:{complete:true,reason:'synthetic full response'},finalTotalsAvailable:false},
    final:{gameId:42,cells:[{key:'team:7',levelNumber:2,spentSeconds:100,correctionSeconds:0,timeout:false,displayedAt:'15.01.2027 11:00:00.000'}],totals:[{key:'team:7',kind:'raw',seconds:100,completedLevels:1},{key:'team:7',kind:'corr',seconds:100-award,completedLevels:1}],coverage:{complete:true,atomic:false}},
    roster:[{key:'team:7',id:7,gamePlayerId:700,label:'Synthetic',eligible:true,enteredAt:null}],timezone:180,canWrite:true,complete:true,atomic:false};}
  async request(path:string,init:RequestInit={}):Promise<Response>{
    const url=new URL(path,'https://fixture.en.cx');
    if(url.pathname==='/games/42/recalculation-context')return Response.json(this.context());
    if(url.pathname==='/admin/games/42/levels/154/editor')return Response.json({game_id:42,level:{level_id:154,level_number:2},answers:[],sectors:[],bonuses:[],_authoring:{complete:false,collections:{answers:'observed',bonuses:'observed'}}});
    if(url.pathname==='/admin/games/42/levels')return Response.json({game_id:42,level_state_complete:true,levels:[{level_id:154,level_number:2}],version:'manager-v1'});
    if(url.pathname==='/games/42/monitoring'){
      const tab=Number(url.searchParams.get('tab'));this.reads++;
      const events=tab?[]:[{server_action_id:null,tab:0,level_num:2,team_id:7,user_id:8,bonus_id:null,event_kind:'answer',is_correct:false,answer_text:this.unstable&&this.reads>1?'changed':'literal 001',answer_date_time:'15.01.2027 11:00:00.000',timezone:null,progress:{total:1,closed:0,remaining:1}}];
      return Response.json({game_id:42,can_view:true,mode:tab?'bonus':'main',page:1,total_pages:1,[tab?'bonus_actions':'actions']:events,legacy_evidence:{complete:false,coverage:'one-page'}});
    }
    if(url.pathname==='/games/42/corrections'&&(init.method??'GET')==='POST'){
      assert.equal(new Headers(init.headers).get('If-Match'),'ledger-'+this.items.length);
      const body=JSON.parse(String(init.body));this.writeCount++;
      const row={correct_id:90+this.items.length,game_id:42,team_id:7,user_id:null,level_num:2,correct_date_time:'15.01.2027 11:00:00',timezone:null,correction_value:body.is_bonus?body.seconds:-body.seconds,comment:body.comment};this.items.push(row);
      if(this.loseResponse)throw new Error('synthetic lost response');return Response.json({...row,level_id:154});
    }
    if(url.pathname==='/games/42/corrections')return Response.json({game_id:42,items:this.items,version:'ledger-'+this.items.length,legacy_evidence:{complete:true}});
    const match=url.pathname.match(/^\/games\/42\/corrections\/(\d+)$/);if(match)return Response.json(this.items.find(row=>row.correct_id===Number(match[1])));
    throw new Error('Unexpected synthetic path '+path);
  }
  client(){return new EncounterClient({domain:'fixture.en.cx',api:this});}
}
const rule={id:'native-incident',reason:'native synthetic award',type:'bonus',bonusId:null,answers:['literal 001'],intendedSeconds:37,creditedSeconds:{'team:7':0},source:'main',acceptUnrecognizedInputs:true};
function host(){let stored:CorrectionJournal|null=null;return {approved:async()=>true,withLock:async<T>(_scope:string,action:()=>Promise<T>)=>action(),load:async()=>stored,save:async(journal:CorrectionJournal)=>{stored=structuredClone(journal);}};}

test('legacy evidence calculates, binds exact native identities, applies once and independently checks final totals',async()=>{
  const api=new NativeFixture(),client=api.client(),evidence=await readRecalculationEvidence(client,client.domain,'42','154');
  assert.equal(evidence.complete,true);assert.equal(evidence.participants[0].gamePlayerId,700);assert.equal(evidence.legacy?.eventIdentity,'snapshot-local-index');
  assert.equal(evidence.times[0].endMs,api.statisticFinished);assert.equal(evidence.events[0].answer,'literal 001');
  assert.equal(calculateRecalculation(evidence,rule).rows[0].bonusSeconds,37);
  const plan=await createCorrectionPlan(evidence,rule),journalHost=host();
  assert.equal((await verifyCorrectionStatistics(client,plan)).state,'unknown');
  const journal=await executeCorrectionPlan(client,plan,journalHost);assert.equal(journal.entries[0].state,'verified');assert.equal(api.writeCount,1);
  assert.equal((await verifyCorrectionStatistics(client,plan)).state,'verified');
  await executeCorrectionPlan(client,plan,journalHost);assert.equal(api.writeCount,1);
});
test('legacy lost write response reconciles by native ledger without replay; ongoing or unstable data never becomes a plan',async()=>{
  const api=new NativeFixture(),client=api.client(),evidence=await readRecalculationEvidence(client,client.domain,'42','154'),plan=await createCorrectionPlan(evidence,rule),journalHost=host();
  api.loseResponse=true;const journal=await executeCorrectionPlan(client,plan,journalHost);assert.equal(journal.entries[0].state,'unknown');
  assert.equal((await verifyCorrectionPlan(client,plan,journal)).entries[0].state,'verified');assert.equal(api.writeCount,1);
  const ongoing=new NativeFixture();ongoing.finished=false;await assert.rejects(createCorrectionPlan(await readRecalculationEvidence(ongoing.client(),'fixture.en.cx','42','154'),rule),/finished/);
  const unstable=new NativeFixture();unstable.unstable=true;await assert.rejects(readRecalculationEvidence(unstable.client(),'fixture.en.cx','42','154'),/changed/);
});
