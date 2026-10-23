import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {parsePublicWorkbook} from '../src/google-workbook.ts';
const fixture=(cell='<c r="A1" t="s"><v>0</v></c>')=>zipSync(Object.fromEntries(Object.entries({
 'xl/workbook.xml':'<workbook><sheets><sheet name="Hidden" sheetId="3" state="hidden" r:id="r1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/sharedStrings.xml':'<sst><si><t>001 &amp; &lt;b&gt;text&lt;/b&gt;</t></si></sst>',
 'xl/worksheets/sheet1.xml':`<worksheet><sheetData><row r="1">${cell}</row></sheetData><drawing r:id="drawing1"/></worksheet>`,
 }).map(([key,value])=>[key,strToU8(value)])));
test('public workbook preserves hidden sheets, codes and drawings without executing HTML',()=>{
 const result=parsePublicWorkbook(fixture());assert.equal(result[0].hidden,'hidden');assert.equal(result[0].hasDrawing,true);assert.equal(result[0].rows[0][0],'001 & <b>text</b>');
});
test('workbook bounds sparse coordinates and retains formulas separately',()=>{
 assert.throws(()=>parsePublicWorkbook(fixture('<c r="A9999999"><v>1</v></c>')),/limit/);
 const result=parsePublicWorkbook(fixture('<c r="B1" t="str"><f>CONCAT("00","1")</f><v>001</v></c>'));
 assert.deepEqual(result[0].rows,[['','001']]);assert.equal((result[0].cells.B1 as any).formula,'CONCAT("00","1")');
});
