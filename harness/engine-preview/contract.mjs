/** Data-only protocol shared by Playwright and WebExtension hosts. */
export function parseLegacyPreviewUrl(raw) {
  let url;try{url=new URL(raw);}catch{throw new Error('Invalid legacy preview URL');}
  const match=/^\/admin\/games\/levels\/preview\/([1-9]\d*)\/?$/.exec(url.pathname);
  const level=url.searchParams.get('level');
  if(url.protocol!=='https:'||! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.en\.cx$/.test(url.hostname)||url.hostname==='demo.en.cx'||url.port||url.username||url.password||url.hash||!match||url.searchParams.size!==1||! /^(0|[1-9]\d*)$/.test(level??'')||!Number.isSafeInteger(Number(level))||!Number.isSafeInteger(Number(match[1])))throw new Error('Use an HTTPS legacy Encounter /admin/games/levels/preview/{id}?level={number} URL');
  return {url:url.href,domain:url.hostname,gameId:Number(match[1]),levelNumber:Number(level),engine:'legacy'};
}
export function parsePreviewUrl(raw) {
  let url;try{url=new URL(raw);}catch{throw new Error('Invalid Encounter preview URL');}
  const match=/^\/admin\/games\/([1-9]\d*)\/levels\/preview\/(0|[1-9]\d*)\/?$/.exec(url.pathname);
  if(url.protocol!=='https:'||!/^([a-z0-9-]+\.)+en\.cx$/i.test(url.hostname)||url.port||url.username||url.password||url.search||url.hash||!match||!Number.isSafeInteger(Number(match[1]))||!Number.isSafeInteger(Number(match[2])))throw new Error('Use an HTTPS Encounter /admin/games/{id}/levels/preview/{number} URL without query or fragment');
  return {url:url.href,domain:url.hostname,gameId:Number(match[1]),levelNumber:Number(match[2])};
}
const actions=['answer','bonus','takeHelp','click','fill','press'];
const checks=['expectOk','expectState','expectText','expectVisible'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const string=(value,max=4000)=>typeof value==='string'&&value.length<=max;
function fields(value,allowed,required=allowed) {return object(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));}
export function validatePreviewScenario(scenario) {
  if(!fields(scenario,['steps'])||!Array.isArray(scenario.steps)||scenario.steps.length>100||JSON.stringify(scenario).length>100_000)throw new Error('Invalid preview scenario: use {steps:[...]} (no mocked state or responses)');
  for(const step of scenario.steps) {
    if(!object(step)||!Object.keys(step).length||Object.keys(step).some(key=>![...actions,...checks,'settleMs'].includes(key))||actions.filter(key=>Object.hasOwn(step,key)).length>1||!checks.some(key=>Object.hasOwn(step,key)))throw new Error('Each preview step needs an assertion and at most one action');
    for(const key of ['answer','bonus'])if(Object.hasOwn(step,key)&&!string(step[key],2000))throw new Error('Invalid answer text');
    if(Object.hasOwn(step,'takeHelp')&&(!fields(step.takeHelp,['id','confirm'],['id'])||!Number.isSafeInteger(step.takeHelp.id)||step.takeHelp.id<1||step.takeHelp.confirm!==undefined&&typeof step.takeHelp.confirm!=='boolean'))throw new Error('Invalid help action');
    for(const key of ['click','expectVisible'])if(Object.hasOwn(step,key)&&(!string(step[key],300)||!step[key]))throw new Error('Invalid selector');
    for(const [key,field] of [['fill','value'],['press','key'],['expectText','text']])if(Object.hasOwn(step,key)&&(!fields(step[key],['selector',field])||!string(step[key].selector,300)||!step[key].selector||!string(step[key][field],key==='fill'?2000:4000)))throw new Error('Invalid '+key);
    if(step.press&&!['Enter','Space','Escape','Tab'].includes(step.press.key))throw new Error('Supported keys: Enter, Space, Escape, Tab');
    if(Object.hasOwn(step,'expectOk')&&![true,false,null].includes(step.expectOk))throw new Error('Invalid verdict assertion');
    if(Object.hasOwn(step,'expectOk')&&!Object.hasOwn(step,'answer')&&!Object.hasOwn(step,'bonus'))throw new Error('expectOk requires an answer or bonus API call');
    if(Object.hasOwn(step,'expectState')&&(!fields(step.expectState,['pointer','value'])||!string(step.expectState.pointer,300)||!/^\/(game|level|levels)(\/|$)/.test(step.expectState.pointer)||step.expectState.pointer.split('/').some(key=>['__proto__','prototype','constructor'].includes(key))))throw new Error('Invalid public-state assertion');
    if(step.settleMs!==undefined&&(!Number.isInteger(step.settleMs)||step.settleMs<0||step.settleMs>5000))throw new Error('settleMs must be 0..5000');
  }
  return scenario;
}
export function scenarioHasActions(scenario){validatePreviewScenario(scenario);return scenario.steps.some(step=>actions.some(key=>Object.hasOwn(step,key)));}
function equal(actual,expected){return JSON.stringify(actual)===JSON.stringify(expected);}
function atPointer(value,pointer){return pointer.slice(1).split('/').reduce((item,key)=>item?.[key.replaceAll('~1','/').replaceAll('~0','~')],value);}
export async function runPreviewScenario(transport,scenario,{signal,allowActions=false}={}) {
  validatePreviewScenario(scenario);if(scenarioHasActions(scenario)&&!allowActions)throw new Error('Preview actions require an explicit session grant');
  const report={backend:'encounter-live-preview',subject:'current-preview-content',suppliedHtmlApplied:false,createdAt:new Date().toISOString(),runtimeDetected:false,runtimeVerified:false,passed:false,steps:[],limitations:['The website supplies the Encounter runtime and backend; no offline emulator or fallback.','Only content already saved on this preview page is tested.','Page observations are untrusted. Errors/events are collected only after attachment.','DOM inputs are synthetic; trusted keyboard/IME and device rendering are not certified.','An API call count is not a count of HTTP requests. Actions are never retried automatically.']};
  let attached=false;
  try {
    signal?.throwIfAborted();report.before=await transport({kind:'start'});attached=true;report.runtimeDetected=report.before.runtimeDetected===true;
    if(!report.runtimeDetected)throw new Error('The preview page does not expose the supported native window.EN contract');
    for(const step of scenario.steps) {
      signal?.throwIfAborted();const row={passed:false,action:actions.find(key=>Object.hasOwn(step,key))??null};report.steps.push(row);
      try {
        if(row.action)row.result=await transport({kind:row.action,value:step[row.action]});
        // Transport calls recheck document identity; a navigation never resubmits an action.
        if(step.settleMs)await new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,step.settleMs);const abort=()=>{clearTimeout(timer);reject(new Error('Preview cancelled'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
        signal?.throwIfAborted();row.observed=await transport({kind:'inspect'});
        if(!row.observed.runtimeDetected)throw new Error('Encounter runtime disappeared');
        if(Object.hasOwn(step,'expectOk')&&!equal(row.result?.verdict?.ok,step.expectOk))throw new Error('Unexpected Encounter verdict');
        if(step.expectState&&!equal(atPointer(row.observed.state,step.expectState.pointer),step.expectState.value))throw new Error('Public state does not match '+step.expectState.pointer);
        for(const kind of ['expectText','expectVisible'])if(Object.hasOwn(step,kind)) {const observed=await transport({kind:'observe',selector:kind==='expectVisible'?step[kind]:step[kind].selector});if(kind==='expectVisible'?!observed.visible:observed.text!==step[kind].text)throw new Error(kind+' assertion failed');}
        row.passed=true;
      }catch(error){row.failure=String(error?.message??error);throw error;}
    }
    report.after=await transport({kind:'inspect'});
    if(report.after.errors?.length)throw new Error('Observed page/runtime errors');
    report.passed=true;report.runtimeVerified=scenario.steps.length>0;
  }catch(error){report.failure=String(error?.message??error);}
  finally {if(attached)try{report.final=await transport({kind:'stop'});if(report.final.errors?.length){report.passed=false;report.runtimeVerified=false;report.failure='Observed page/runtime errors';}}catch(error){report.cleanupFailure=String(error?.message??error);report.passed=false;report.runtimeVerified=false;}}
  return report;
}
export function runLegacyPreviewScenario(transport,scenario,options={}) {
  validatePreviewScenario(scenario);
  if(scenario.steps.some(step=>['bonus','takeHelp','expectState','expectOk'].some(key=>Object.hasOwn(step,key))))throw new Error('Legacy verdict/state API is unverified; use scoped DOM assertions/actions');
  return runPreviewScenario(transport,scenario,options).then(report=>({...report,backend:'encounter-legacy-live-preview',limitations:[...report.limitations,'Legacy controller observes jQuery 1.6.2 and public task DOM; answer uses one same-page standard POST form. Verdict remains unknown; submission never retried.']}));
}
