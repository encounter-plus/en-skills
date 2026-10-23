import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {registerImportPlanTools} from '../src/import-plan-tools.ts';
import {syntheticHost,sourceRows} from './import-plan-fixture.ts';
const directory=resolve(process.argv[2]!);await mkdir(directory,{recursive:true});
const f=syntheticHost(),server=new McpServer({name:'synthetic-import',version:'1.0.0'});
await f.host.create(42);f.levels[0]!.level_name='Черновик';f.levels[0]!.tasks.push({task_id:7,task_text:'Старый брифинг',replace_nl_to_br:false,for_member_id:0},{task_id:8,task_text:'Сохранить служебное задание',replace_nl_to_br:false,for_member_id:0});f.failAfter('tasks');
const register=server.registerTool.bind(server);
server.registerTool=((name:string,config:unknown,handler:Function)=>register(name,config as never,(async(...args:unknown[])=>{
 const result=await handler(...args);
 await writeFile(join(directory,'state.json'),JSON.stringify({levels:f.levels,messages:f.messages,calls:f.calls,assets:f.assets},null,2));
 await appendFile(join(directory,'trace.jsonl'),JSON.stringify({name,input:args[0],result})+'\n');return result;
}) as never)) as typeof server.registerTool;
registerImportPlanTools(server,async()=>f.host,()=>join(directory,'plans'));
server.registerTool('google_public_read',{description:'Read the synthetic spreadsheet fixture with sections and literal cell text. Only synthetic://table is accepted.',inputSchema:{url:z.literal('synthetic://table')}},async()=>({content:[{type:'text',text:JSON.stringify({sourceUrl:'synthetic://table',rows:[...sourceRows.map(row=>row.slice(1)),['Нейродиалог 1 / сектор','Название: Звёзды; ответы буквально: 001 и Конь6'],['Нейродиалог 1 / бонус','Название: Наблюдатель; текст: Найдите телескоп; помощь: Он в башне; ответ: БОНУС; награда: 60 секунд; отрицательный: нет'],['Нейродиалог 1 / подсказка','Через 30 секунд: Посмотри вверх; не штрафная'],['Нейродиалог 1 / дополнительное задание','Точный текст: Запишите наблюдение. Получатель: все']],limitations:[]})}]}));
await server.connect(new StdioServerTransport());
