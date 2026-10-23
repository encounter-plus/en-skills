/** Fixed, serializable controller. MAIN for EN; ISOLATED for DOM. No eval or runtime replacement. */
export async function previewPageCommand(request) {
  const fail=message=>{throw new Error(message);};
  const match=/^\/admin\/games\/([1-9]\d*)\/levels\/preview\/(0|[1-9]\d*)\/?$/.exec(location.pathname);
  if(location.href!==request.expectedUrl||!match||Number(match[1])!==request.gameId||Number(match[2])!==request.levelNumber)fail('Preview page changed');
  if(request.documentTime!==undefined&&performance.timeOrigin!==request.documentTime)fail('Preview document changed; reconnect without retrying the action');
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(request.session))fail('Invalid preview session');
  const clipped=value=>typeof value==='string'?value.slice(0,4000):typeof value==='boolean'||typeof value==='number'||value===null?value:undefined;
  const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>clipped(value?.[key])!==undefined).map(key=>[key,clipped(value[key])]));
  const snapshot=state=>state?{
    game:pick(state.game,['id','number','title','zoneId','sequence']),
    level:{...pick(state.level,['id','number','name','startedAt','deadlineAt','isPassed','isDismissed','sectorsLeft']),
      sectors:Array.from(state.level?.sectors??[]).slice(0,1000).map(value=>pick(value,['id','name','isAnswered','answer','answeredBy','answeredAt'])),
      helps:Array.from(state.level?.helps??[]).slice(0,1000).map(value=>pick(value,['id','number','text','openAt','isPenalty','penaltySeconds','requiresConfirm','status'])),
      bonuses:Array.from(state.level?.bonuses??[]).slice(0,1000).map(value=>pick(value,['id','number','name','text','awardSeconds','isAnswered']))},
    levels:Array.from(state.levels??[]).slice(0,1000).map(value=>pick(value,['id','number','name','isPassed','isCurrent']))}:null;
  const pageMeta=()=>({url:location.href,documentTime:performance.timeOrigin,viewport:{width:innerWidth,height:innerHeight},readyState:document.readyState});
  const domKinds=['click','fill','press','observe'];
  if(domKinds.includes(request.kind)) {
    const selector=request.kind==='observe'?request.selector:request.kind==='click'?request.value:request.value?.selector;
    if(typeof selector!=='string'||!selector||selector.length>300)fail('Invalid selector');
    let elements;try{elements=document.querySelectorAll(selector);}catch{fail('Invalid CSS selector');}
    if(elements.length!==1)fail('Selector must match exactly one task element');
    const element=elements[0];
    const root=element.closest('[data-en="tasks"], [data-en="sectors"], [data-en="helps"], [data-en="bonuses"], [data-en="level-title"], [data-en="answer-form"], [data-en="bonus-form"], .task-text, #TaskText, .en-user-html');
    if(!root||element.closest('script,style,iframe,object'))fail('Selector is outside public game content');
    const visible=node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return !node.closest('[hidden],[inert],[aria-hidden="true"]')&&style.visibility!=='hidden'&&style.display!=='none'&&rect.width>0&&rect.height>0;};
    if(request.kind==='observe') {
      const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let text='';
      while(walker.nextNode()){const node=walker.currentNode,parent=node.parentElement;if(parent&&!parent.closest('input,textarea,select,script,style,[hidden],[aria-hidden="true"]')&&visible(parent))text+=(node.textContent??'');if(text.length>8000)break;}
      return {...pageMeta(),visible:visible(element),text:text.slice(0,8000)};
    }
    if(!visible(element)||element.matches(':disabled')||element.closest('a[href], [contenteditable], input[type="password"], input[type="hidden"], input[type="file"]'))fail('Element is not an eligible preview control');
    const form=element.closest('form');
    if(form) {
      if(!form.matches('[data-en="answer-form"],[data-en="bonus-form"]')||form.target&&form.target!=='_self'||new URL(form.action||location.href,location.href).href!==location.href||form.querySelector('[formaction],[formtarget],[formmethod],[formenctype]'))fail('Only same-page standard preview forms are supported');
    }
    if(request.kind==='fill') {
      if(!(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)||element.readOnly||element instanceof HTMLInputElement&&!['text','search','tel'].includes(element.type)||typeof request.value.value!=='string'||request.value.value.length>2000)fail('Element is not an editable task text field');
      Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set.call(element,request.value.value);
      element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
    } else if(request.kind==='click') {
      if(!element.matches('button,input[type="submit"],input[type="button"],[role="button"]'))fail('Click requires a task button');
      element.click();
    } else {
      const key=request.value.key;if(!['Enter','Space','Escape','Tab'].includes(key))fail('Unsupported key');
      element.focus();const keyboardKey=key==='Space'?' ':key;
      const proceed=element.dispatchEvent(new KeyboardEvent('keydown',{key:keyboardKey,code:key==='Space'?'Space':key,bubbles:true,cancelable:true}));
      element.dispatchEvent(new KeyboardEvent('keyup',{key:keyboardKey,bubbles:true}));
      if(proceed&&(key==='Enter'||key==='Space')&&element.matches('button,input[type="submit"],input[type="button"]'))element.click();
      else if(proceed&&key==='Enter'&&element instanceof HTMLInputElement&&form)form.requestSubmit();
    }
    return {...pageMeta(),dispatched:true,trustedInput:false};
  }
  const en=window.EN;
  let nativeState=en?.getState?.();
  if(!nativeState&&request.kind==='start'&&en?.ready?.then)nativeState=await Promise.race([en.ready,new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
  const detected=en?.version===1&&['getState','subscribe','serverTime','answer','bonus','takeHelp'].every(key=>typeof en?.[key]==='function')&&!!nativeState?.level;
  if(detected&&(nativeState.game?.id!==request.gameId||nativeState.level?.number!==request.levelNumber))fail('Public EN state belongs to another game or level');
  const key='__enAuthorPreview_'+request.session;
  if(request.kind==='start') {
    window[key]?.dispose?.();
    const observer={events:[],errors:[],dispose:undefined};
    const event=e=>{if(observer.events.length<100)observer.events.push({type:e.type,at:Date.now()});};
    const error=e=>{if(observer.errors.length<20)observer.errors.push({type:e.type,message:String(e.message??e.reason?.message??e.reason??e.violatedDirective??'Page error').slice(0,1000)});};
    const names=['en:state','en:level','en:sector','en:help','en:bonus'];for(const name of names)document.addEventListener(name,event);
    window.addEventListener('error',error);window.addEventListener('unhandledrejection',error);document.addEventListener('securitypolicyviolation',error);
    observer.dispose=()=>{for(const name of names)document.removeEventListener(name,event);window.removeEventListener('error',error);window.removeEventListener('unhandledrejection',error);document.removeEventListener('securitypolicyviolation',error);delete window[key];};window[key]=observer;
  }
  const observer=window[key];
  if(!['start','inspect'].includes(request.kind)&&!observer)fail('Preview observer lost; reconnect without retrying an action');
  let verdict;
  if(['answer','bonus','takeHelp'].includes(request.kind)) {
    if(!detected)fail('Native Encounter runtime unavailable');
    let result;
    if(request.kind==='takeHelp') {const value=request.value;if(!Number.isSafeInteger(value?.id)||value.id<1||value.confirm!==undefined&&typeof value.confirm!=='boolean')fail('Invalid help action');result=en.takeHelp(value.id,{confirm:value.confirm===true});}
    else {if(typeof request.value!=='string'||request.value.length>2000)fail('Invalid code');result=en[request.kind](request.value);}
    const completed=await Promise.race([Promise.resolve(result),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Encounter action timed out; outcome unknown, do not retry automatically')),20000))]);
    if(request.kind!=='takeHelp') {if(!completed||![true,false,null].includes(completed.ok))fail('Encounter returned no usable verdict; outcome unknown');verdict={ok:completed.ok,answer:clipped(completed.answer)};}
    nativeState=en.getState();
    if(nativeState?.game?.id!==request.gameId||nativeState?.level?.number!==request.levelNumber)fail('Encounter changed level after action; inspect before continuing');
  } else if(!['start','inspect','stop'].includes(request.kind))fail('Unknown preview command');
  const result={...pageMeta(),runtimeDetected:detected,version:clipped(en?.version),state:snapshot(nativeState),...(verdict?{verdict}:{}),events:observer?.events.slice()??[],errors:observer?.errors.slice()??[],stateTruncated:JSON.stringify(nativeState??null).length>100_000};
  if(JSON.stringify(result).length>200_000)fail('Public state too large; narrow the preview fixture');
  if(request.kind==='stop')observer?.dispose();
  return result;
}
