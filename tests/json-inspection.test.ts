import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectJson} from '../src/json-inspection.ts';

test('oversized workbook parts lead to child pointers, then lossless string pages',()=>{
 const html='😀<div>001\n</div>'.repeat(8000),root={parts:[{name:'level',snapshot:{rows:[['001',html]]}}]};
 const top=inspectJson(root,{pointer:'/parts'});
 assert.equal(top.oversized,true);assert.equal(top.nextPointer,'/parts/0');
 const part=inspectJson(root,{pointer:top.nextPointer});
 assert.equal(part.entries?.length,2);
 const row=inspectJson(root,{pointer:'/parts/0/snapshot/rows'});
 assert.equal(row.nextPointer,'/parts/0/snapshot/rows/0');
 let offset=0,text='';
 while(offset<html.length){const page=inspectJson(root,{pointer:'/parts/0/snapshot/rows/0/1',offset,limit:1501});assert.ok(page.nextOffset!>offset);assert.ok(JSON.stringify(page).length<17000);text+=page.text;offset=page.nextOffset!;}
 assert.equal(text,html);
 assert.equal(inspectJson(root,{pointer:'/parts/0/snapshot/rows/0/0'}).text,'001');
});
test('pointer escapes, bounds, empty arrays and object pagination',()=>{
 const root={'a/b':{'~key':[1,2,3]},empty:[]};
 assert.deepEqual(inspectJson(root,{pointer:'/a~1b/~0key',offset:1,limit:1}).items,[2]);
 assert.equal(inspectJson(root,{limit:1}).nextOffset,1);
 assert.equal(inspectJson(root,{pointer:'/empty'}).complete,true);
 for(const options of [{pointer:'/missing'},{pointer:'/__proto__'},{pointer:'/a~2b'},{offset:-1},{limit:0},{pointer:'/empty',offset:1}])assert.throws(()=>inspectJson(root,options));
});
