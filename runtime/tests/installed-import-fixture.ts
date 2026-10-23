// Test-only dependency boundary: installed tool schemas, handlers and journals stay intact.
import {syntheticHost,sourceRows} from './import-plan-fixture.ts';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
export async function fixture(directory:string){
 await mkdir(directory,{recursive:true});
 const f=syntheticHost();await f.host.create(42);f.levels[0]!.level_name='Черновик';
 f.levels[0]!.tasks.push({task_id:7,task_text:'Старый брифинг',replace_nl_to_br:false,for_member_id:0},{task_id:8,task_text:'Сохранить служебное задание',replace_nl_to_br:false,for_member_id:0});f.failAfter('tasks');
 const names=new Set(['encounter_prepare_import_plan','encounter_create_level_from_plan','encounter_verify_import_plan','encounter_inspect_import_level','encounter_reconcile_import_plan','google_public_read']);
 return {host:f.host,attach(server:any){
  const register=server.registerTool.bind(server);
  server.registerTool=(name:string,config:unknown,handler:Function)=>register(name,config,async(...args:unknown[])=>{
   if(!names.has(name))throw Error('Synthetic evaluation blocks non-plan operations: '+name);
   const result=await handler(...args);
   await writeFile(join(directory,'state.json'),JSON.stringify({levels:f.levels,messages:f.messages,calls:f.calls,assets:f.assets},null,2));
   await appendFile(join(directory,'trace.jsonl'),JSON.stringify({name,input:args[0],result})+'\n');return result;
  });
  server.registerTool('google_public_read',{description:'Read the synthetic spreadsheet fixture; only synthetic://table is accepted.',inputSchema:{url:z.literal('synthetic://table')}},async()=>({content:[{type:'text',text:JSON.stringify({sourceUrl:'synthetic://table',rows:[...sourceRows.map(row=>row.slice(1)),['Нейродиалог 1 / сектор','Название: Звёзды; ответы буквально: 001 и Конь6'],['Нейродиалог 1 / бонус','Название: Наблюдатель; текст: Найдите телескоп; помощь: Он в башне; ответ: БОНУС; награда: 60 секунд; отрицательный: нет'],['Нейродиалог 1 / подсказка','Через 30 секунд: Посмотри вверх; не штрафная'],['Нейродиалог 1 / дополнительное задание','Точный текст: Запишите наблюдение. Получатель: все']],limitations:[]})}]}));
 }};
}
