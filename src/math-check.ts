/** Independent equivalent of skills/.../math_check.py. Confirmed whole seconds only. */
export function checkRecalculationMath(input:unknown) {
  const data=input as {timesSeconds:unknown[];targets?:{key:unknown;currentSeconds:unknown;targetSeconds:unknown}[]};
  const seconds=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error('Expected confirmed non-negative whole seconds');return Number(value);};
  if(!data||!Array.isArray(data.timesSeconds)||!data.timesSeconds.length)throw new Error('No normally completed teams: arithmetic mean is undefined');
  if(data.targets!==undefined&&!Array.isArray(data.targets))throw new Error('Expected target rows');
  const times=data.timesSeconds.map(seconds),sum=times.reduce((a,b)=>a+BigInt(b),0n),count=BigInt(times.length);
  if(sum>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Sum exceeds exact range of the floating point cross-check');
  let floating=0,correction=0;
  for(const value of times){const next=floating+value;correction+=Math.abs(floating)>=Math.abs(value)?floating-next+value:value-next+floating;floating=next;}
  if(floating+correction!==Number(sum))throw new Error('Independent sum mismatch');
  const gcd=(a:bigint,b:bigint):bigint=>b===0n?a:gcd(b,a%b),divisor=gcd(sum,count),numerator=sum/divisor,denominator=count/divisor;
  const rows=(data.targets??[]).map(row=>{if(!row||typeof row.key!=='string')throw new Error('Expected target key');const current=seconds(row.currentSeconds),target=seconds(row.targetSeconds),delta=target-current;return {key:row.key,currentSeconds:current,targetSeconds:target,bonusSeconds:Math.max(0,-delta),penaltySeconds:Math.max(0,delta)};});
  return {sumSeconds:Number(sum),count:times.length,exactMean:denominator===1n?String(numerator):`${numerator}/${denominator}`,meanSeconds:Number(sum)/times.length,roundingRequired:denominator!==1n,rows,applied:false};
}
