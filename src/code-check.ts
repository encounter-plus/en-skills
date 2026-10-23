/** Local text equality only: not a simulation of engine timing, limits or progression. */
export interface CodeCandidate {
  kind:'answer'|'bonus'; id:number; text:string; sectorId:number|null;
  recipient:{kind:'all'|'unknown'}|{kind:'user'|'team';id:number};
  negative:boolean|null;
}
export function compareCodes(codes:string[], candidates:CodeCandidate[]) {
  if(!Array.isArray(codes)||!codes.length||codes.length>100||codes.some(code=>typeof code!=='string'||!code.trim()||code.length>200)) throw new Error('Invalid codes');
  return codes.map(code=>{
    const normalized=code.trim().toLowerCase();
    return {code,matches:candidates.filter(candidate=>candidate.text.trim().toLowerCase()===normalized).map(({text,...match})=>match)};
  });
}
