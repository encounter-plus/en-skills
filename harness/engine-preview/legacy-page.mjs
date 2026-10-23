/** Legacy DOM controller. No arbitrary script evaluation or authoring API calls. */
export async function legacyPreviewPageCommand(request) {
  const fail=message=>{throw new Error(message);};
  const match=/^\/admin\/games\/levels\/preview\/([1-9]\d*)\/?$/.exec(location.pathname);
  if(location.href!==request.expectedUrl||!match||Number(match[1])!==request.gameId||Number(new URL(location.href).searchParams.get('level'))!==request.levelNumber)fail('Legacy preview page changed');
  if(request.documentTime!==undefined&&performance.timeOrigin!==request.documentTime)fail('Legacy preview document changed; outcome unknown, do not retry');
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(request.session))fail('Invalid preview session');
  const key='__enAuthorLegacyPreview_'+request.session;
  const submissionKey='__enAuthorLegacySubmission_'+request.session;
  const meta=()=>({url:location.href,documentTime:performance.timeOrigin,viewport:{width:innerWidth,height:innerHeight},readyState:document.readyState,runtimeDetected:window.jQuery?.fn?.jquery==='1.6.2'&&!!document.querySelector('.task,#TaskText,#task-content'),engine:'legacy',state:null,errors:window[key]?.errors??[],events:[]});
  if(request.kind==='start') {
    window[key]?.dispose?.();
    const observer={errors:[]};
    const error=event=>{if(observer.errors.length<20)observer.errors.push(String(event.message??event.reason?.message??event.reason??'Page error').slice(0,1000));};
    addEventListener('error',error);addEventListener('unhandledrejection',error);
    observer.dispose=()=>{removeEventListener('error',error);removeEventListener('unhandledrejection',error);delete window[key];};window[key]=observer;
    return meta();
  }
  if(!window[key]&&request.kind==='inspect')return meta();
  if(!window[key])fail('Legacy observer lost; reconnect without retrying an action');
  if(request.kind==='inspect')return meta();
  if(request.kind==='stop'){const result=meta();window[key].dispose();return result;}
  const eligibleForm=form=>form instanceof HTMLFormElement&&form.method.toLowerCase()==='post'&&(!form.target||form.target==='_self')&&new URL(form.action||location.href,location.href).href===location.href&&!form.querySelector('[formaction],[formtarget],[formmethod],[formenctype]')&&form.querySelector('input[name="LevelAction.Answer"]')&&/^[1-9]\d*$/.test(form.querySelector('input[type=hidden][name=LevelId]')?.value??'')&&form.querySelector('input[type=hidden][name=LevelNumber]')?.value===String(request.levelNumber);
  if(request.kind==='answer') {
    if(typeof request.value!=='string'||request.value.length>2000)fail('Invalid legacy answer');
    const forms=[...document.forms].filter(eligibleForm);if(forms.length!==1)fail('Expected one standard same-page legacy preview answer form');
    const form=forms[0],input=form.querySelector('input[name="LevelAction.Answer"]');
    if(window[submissionKey])fail('Previous legacy submit outcome is unknown; inspect without retrying');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,request.value);
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    window[submissionKey]=true;form.requestSubmit();
    return {...meta(),dispatched:true,verdict:{ok:null},outcome:'unknown',retryAllowed:false};
  }
  if(!['observe','click','fill','press'].includes(request.kind))fail('Legacy player API actions/state assertions are unsupported');
  const selector=request.kind==='observe'?request.selector:request.kind==='click'?request.value:request.value?.selector;
  if(typeof selector!=='string'||!selector||selector.length>300)fail('Invalid selector');
  const elements=document.querySelectorAll(selector);
  if(elements.length!==1)fail('Selector must match exactly one public task element');
  const element=elements[0];
  const form=element.form??element.closest('form');
  if(!(element.closest('.task,#TaskText,#task-content,.en-user-html')||eligibleForm(form))||element.closest('script,style,iframe,object,input[type=password],input[type=hidden],input[type=file]'))fail('Selector outside public legacy task');
  const visible=()=>{const rect=element.getBoundingClientRect(),style=getComputedStyle(element);return !element.closest('[hidden],[inert],[aria-hidden=true]')&&rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none';};
  if(request.kind==='observe')return {...meta(),visible:visible(),text:(element.innerText??element.textContent??'').slice(0,8000)};
  if(!visible()||element.matches(':disabled')||element.closest('a[href],[contenteditable]'))fail('Ineligible legacy control');
  if(form&&!eligibleForm(form))fail('Only standard same-page legacy preview answer forms are supported');
  if(request.kind==='fill') {
    if(!(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)||element.readOnly||element instanceof HTMLInputElement&&!['text','search','tel'].includes(element.type)||typeof request.value.value!=='string'||request.value.value.length>2000)fail('Ineligible legacy input');
    Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set.call(element,request.value.value);
    element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
  }else if(request.kind==='click') {
    if(!element.matches('button[type=button],input[type=button],[role=button]')&&!(form&&element.matches('button[type=submit],input[type=submit]')))fail('Legacy click requires an author widget or preview submit button');
    if(form&&element.matches('button[type=submit],input[type=submit]')){if(window[submissionKey])fail('Previous legacy submit outcome unknown; do not retry');window[submissionKey]=true;}
    element.click();
  }else {
    const key=request.value.key;if(!['Enter','Space','Escape','Tab'].includes(key))fail('Unsupported key');
    element.focus();const value=key==='Space'?' ':key;
    const proceed=element.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
    element.dispatchEvent(new KeyboardEvent('keyup',{key:value,bubbles:true,cancelable:true}));
    if(proceed&&['Enter','Space'].includes(key)&&element.matches('button[type=button],input[type=button],[role=button]'))element.click();
    else if(proceed&&key==='Enter'&&form&&element instanceof HTMLInputElement){if(window[submissionKey])fail('Previous legacy submit outcome unknown; do not retry');window[submissionKey]=true;form.requestSubmit();}
  }
  return {...meta(),dispatched:true,trustedInput:false};
}
