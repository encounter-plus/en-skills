import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const array=(value:any):any[]=>value===undefined?[]:Array.isArray(value)?value:[value];
const literal=(value:any):string=>typeof value==='string'?value:typeof value?.['#text']==='string'?value['#text']:'';
const rich=(value:any):string=>value?.t!==undefined?literal(value.t):array(value?.r).map(run=>literal(run.t)).join('');
/** Bounded XLSX extraction; no formulas, links or embedded scripts are executed. */
export function parsePublicWorkbook(bytes:Uint8Array) {
 let total=0;
 const files=unzipSync(bytes,{filter:file=>{
  total+=file.originalSize;if(total>100*1024*1024||file.originalSize>10*1024*1024)throw new Error('Workbook expansion limit');
  return /\.xml$|\.rels$/.test(file.name);
 }});
 const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false});
 const xml=(path:string)=>{const data=files[path];if(!data)throw new Error('Missing workbook part');const text=new TextDecoder('utf-8',{fatal:true}).decode(data);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Unsupported XML declaration');return parser.parse(text);};
 const workbook=xml('xl/workbook.xml').workbook;
 const relations=array(xml('xl/_rels/workbook.xml.rels').Relationships.Relationship);
 const shared=files['xl/sharedStrings.xml']?array(xml('xl/sharedStrings.xml').sst.si).map(rich):[];
 const styles=files['xl/styles.xml']?xml('xl/styles.xml').styleSheet:{};
 const formats=new Map(array(styles.numFmts?.numFmt).map(format=>[format['@_numFmtId'],format['@_formatCode']]));
 const cellStyles=array(styles.cellXfs?.xf);
 const sheets=array(workbook.sheets?.sheet);if(!sheets.length||sheets.length>100)throw new Error('Workbook sheet limit');
 return sheets.map(sheet=>{
  const rel=relations.find(row=>row['@_Id']===sheet['@_r:id']);if(!rel||rel['@_TargetMode']==='External')throw new Error('Invalid worksheet relationship');
  const target=String(rel['@_Target']);const path=target.startsWith('/')?target.slice(1):'xl/'+target;
  if(path.includes('..')||!path.startsWith('xl/worksheets/'))throw new Error('Invalid worksheet path');
  const data=xml(path).worksheet,rows:string[][]=[],cells:Record<string,unknown>={};let count=0;
  for(const row of array(data.sheetData?.row))for(const cell of array(row.c)) {
   if(cell.v===undefined&&cell.f===undefined&&cell.is===undefined)continue;
   const address=String(cell['@_r']),match=/^([A-Z]{1,3})([1-9]\d*)$/.exec(address);if(!match)throw new Error('Invalid cell address');
   const r=Number(match[2])-1,c=[...match[1]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
   if(r>=10000||c>=500||++count>100000)throw new Error('Workbook cell limit');
   const raw=literal(cell.v),type=cell['@_t'];let value=type==='s'?shared[Number(raw)]:type==='inlineStr'?rich(cell.is):raw;
   if(value===undefined)throw new Error('Invalid shared string');
   const numFmtId=cellStyles[Number(cell['@_s']??0)]?.['@_numFmtId']??'0',format=formats.get(numFmtId);
   if((!type||type==='n')&&typeof format==='string'&&/^0+$/.test(format)&&/^\d+$/.test(raw))value=raw.padStart(format.length,'0');
   cells[address]={value,raw,type:type??'n',...(cell.f!==undefined?{formula:literal(cell.f),formulaAttributes:typeof cell.f==='object'?cell.f:undefined}:{}),style:cell['@_s']??'0',numberFormat:format??numFmtId};
   if(!rows[r])rows[r]=[];rows[r][c]=value;
  }
  const dense=Array.from({length:rows.length},(_,r)=>Array.from({length:rows[r]?.length??0},(_,c)=>rows[r]?.[c]??''));
  return {id:String(sheet['@_sheetId']),name:String(sheet['@_name']),hidden:sheet['@_state']??'visible',rows:dense,cells,mergedCells:array(data.mergeCells?.mergeCell).map(cell=>cell['@_ref']),hasDrawing:!!data.drawing,columns:data.cols??null,rowProperties:array(data.sheetData?.row).filter(row=>row['@_hidden']==='1').map(row=>row['@_r']),limitations:['Numeric/date display formats other than zero-padding are retained as format metadata, not rendered.','Images, comments and visual style semantics require separate inspection; empty styled cells are omitted and an empty cell list does not mean an empty sheet.']};
 });
}
