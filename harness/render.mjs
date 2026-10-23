/** Shared document generation: Node/Playwright uses the packaged runtime shells. */
const json=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function renderScriptPage(mode,author,fixture,renderer,assets,{layout='desktop'}={}) {
  if(mode==='legacy-enplus-react-native') {
    const bootstrap='<script src="/rn-host.js"></script>';
    return renderer.buildGameHtml({taskHtml:author,sectors:fixture.sectors??[],messages:fixture.messages??[],hints:fixture.hints??[],bonuses:fixture.bonuses??[],colors:fixture.colors??renderer.colors,translations:fixture.translations??renderer.translations,activeSection:'task',lang:'ru',classicTaskDisplay:fixture.classicTaskDisplay??true,documentToken:fixture.documentToken??1,engineAside:fixture.engineAside,authorStorageSeed:fixture.authorStorageSeed??{},injectedRuntime:renderer.buildInjectedJs()}).replace('<head>',()=>'<head>'+bootstrap);
  }
  if(mode!=='enplus')throw new Error('Encounter checks require the native /preview runtime: use en-engine-check');
  const state=fixture.state;
  const task='<div data-en="tasks"><div class="engine-task" id="task-900010" data-task-id="900010">'+author+'</div></div>';
  const bootstrap='<script>window.__fixture='+json({mode})+';window.__initialEnState='+json(state)+';window.__initialServerTimeMs='+Date.now()+';</script><script src="/host.js"></script>';
  const forms='<form data-en="answer-form" class="answers_form"><input type="hidden" name="LevelId" value="'+state.level.id+'"><input type="hidden" name="LevelNumber" value="'+state.level.number+'"><input type="text" id="Answer" data-en="answer-input" name="LevelAction.Answer"><button type="submit">Отправить код</button></form><form data-en="bonus-form"><input type="text" id="BonusAnswer" data-en="bonus-input" name="BonusAction.Answer"><button type="submit">Отправить бонус</button></form>';
  const panel='<aside id="harness-panel" style="position:fixed;bottom:0;left:0;right:0;background:#eee;color:#111;padding:8px;z-index:2147483647"><label>Эмуляция ввода приложения <input id="harness-input"></label><button id="harness-send">Отправить</button><output id="harness-status"></output></aside>';
  if(mode==='enplus') {
    let html=renderer.buildGameHtml({taskHtml:task,sectors:fixture.sectors??[],messages:fixture.messages??[],hints:fixture.hints??[],bonuses:fixture.bonuses??[],colors:fixture.colors??renderer.colors,translations:fixture.translations??renderer.translations,activeSection:'task',lang:'ru',levelTitle:{name:state.level.name,number:state.level.number,total:state.levels.length},formDocumentToken:'synthetic-document',classicTaskDisplay:true,injectedRuntime:''});
    html=html.replace('<head>',()=>'<head>'+bootstrap+'<link rel="stylesheet" href="/snapshot/enplus.css">');
    return html.replace('</body>',()=>forms.replaceAll('<form ','<form hidden ')+panel+'<script src="/snapshot/enplus-injected.js"></script></body>');
  }
}
export function renderAnnouncementPage(author,fixture,shell) {
  const text=value=>escape(value).replaceAll('>','&gt;');
  return shell.replace('{{GAME_TITLE}}',()=>text(fixture.game.title)).replace('{{START_TIME}}',()=>text(fixture.game.start_date_time)).replace('<!--AUTHOR_HTML-->',()=>fixture.is_from_author_visible?author:'');
}
export function validateHarnessRequest(request) {
  if(!request||!['script','announcement'].includes(request.kind)||typeof request.html!=='string'||request.html.length>2_000_000)throw new Error('Invalid harness document');
  const scenario=request.scenario;
  if(request.profile!==undefined&&!['modern-enplus-kotlin','legacy-enplus-react-native'].includes(request.profile))throw new Error('Invalid runtime profile');
  if(!scenario||!Array.isArray(scenario.steps)||scenario.steps.length>1000)throw new Error('Invalid scenario.steps');
  if(request.kind==='script'&&request.profile!=='legacy-enplus-react-native'&&(!scenario.state?.level||!scenario.state.game||!Array.isArray(scenario.state.levels)||!Array.isArray(scenario.responses)))throw new Error('Invalid script state/responses');
  const allowed=request.kind==='script'?['click','code','form','directSubmit','fill','press','expectOk','expectError','expectText','expectVisible','update','rebuild','expectActionCount','expectRefreshRequests']:['click','fill','press','expectVisible','expectText'];
  for(const step of scenario.steps) {
    if(!step||typeof step!=='object'||!Object.keys(step).length||Object.keys(step).some(key=>!allowed.includes(key)))throw new Error('Invalid scenario step');
    for(const key of ['click','form','expectVisible'])if(step[key]!==undefined&&(typeof step[key]!=='string'||!step[key]||step[key].length>4000))throw new Error('Invalid selector');
    for(const key of ['expectText','fill','press'])if(step[key]!==undefined&&(!step[key]||typeof step[key]!=='object'||Array.isArray(step[key])))throw new Error('Invalid '+key);
    if(step.expectText&&(typeof step.expectText.selector!=='string'||!step.expectText.selector||typeof step.expectText.text!=='string'||Object.keys(step.expectText).some(key=>!['selector','text'].includes(key))))throw new Error('Invalid expectText');
    if(step.fill&&(typeof step.fill.selector!=='string'||!step.fill.selector||typeof step.fill.value!=='string'||Object.keys(step.fill).some(key=>!['selector','value'].includes(key))))throw new Error('Invalid fill');
    if(step.press&&(typeof step.press.selector!=='string'||!step.press.selector||typeof step.press.key!=='string'||!step.press.key||Object.keys(step.press).some(key=>!['selector','key'].includes(key))))throw new Error('Invalid press');
    for(const key of ['directSubmit','expectError'])if(step[key]!==undefined&&typeof step[key]!=='boolean')throw new Error('Invalid '+key);
    if(step.code!==undefined&&typeof step.code!=='string')throw new Error('Invalid code');
    for(const key of ['expectActionCount','expectRefreshRequests'])if(step[key]!==undefined&&(!Number.isSafeInteger(step[key])||step[key]<0))throw new Error('Invalid '+key);
    if(step.update!==undefined) {
      if(step.rebuild!==undefined)throw new Error('Use one RN document mutation per step');
      if(request.profile!=='legacy-enplus-react-native'||!step.update||typeof step.update!=='object'||Object.keys(step.update).some(key=>!['section','data'].includes(key))||!['task','messages','hints','bonuses','sectors'].includes(step.update.section))throw new Error('Invalid RN update');
      const {section,data}=step.update;
      if(section==='task'?typeof data!=='string'||data.length>2_000_000:section==='hints'?!data||!Array.isArray(data.hints)||!Array.isArray(data.penaltyHints):!Array.isArray(data))throw new Error('Invalid RN update data');
    }
    if(step.rebuild!==undefined) {
      const value=step.rebuild;
      if(request.profile!=='legacy-enplus-react-native'||!value||typeof value!=='object'||Object.keys(value).some(key=>!['taskHtml','fixture','preserveStorage'].includes(key))||value.taskHtml!==undefined&&(typeof value.taskHtml!=='string'||value.taskHtml.length>2_000_000)||value.preserveStorage!==undefined&&typeof value.preserveStorage!=='boolean')throw new Error('Invalid RN rebuild');
      if(value.fixture!==undefined&&(!value.fixture||typeof value.fixture!=='object'||Object.keys(value.fixture).some(key=>!['messages','hints','bonuses','sectors','engineAside','classicTaskDisplay'].includes(key))))throw new Error('Invalid rebuild fixture');
      for(const name of ['messages','hints','bonuses','sectors'])if(value.fixture?.[name]!==undefined&&!Array.isArray(value.fixture[name]))throw new Error('Invalid rebuild section');
    }
    if(step.expectOk!==undefined&&step.expectOk!==null&&typeof step.expectOk!=='boolean')throw new Error('Invalid expectOk');
  }
  return request;
}
