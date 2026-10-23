/* Synthetic native boundary; deliberately does not install window.EN. */
(() => {
  const harness=window.__harness={actions:[],results:[],events:[],errors:[],storage:{},refreshRequests:[]};
  let disposed=false;
  let seeded=false;
  addEventListener('pagehide',()=>{disposed=true;},{once:true});
  window.ReactNativeWebView={postMessage(raw) {
    const message=JSON.parse(raw);
    if(disposed||message.documentToken!==undefined&&message.documentToken!==window.__documentToken)return;
    if(!seeded&&window.__authorStorageSeed){harness.storage={...window.__authorStorageSeed};seeded=true;}
    harness.events.push(message);
    if(message.type==='bridgeError')harness.errors.push(message.message??'RN bridge error');
    if(message.type==='authorStorageSync'||message.type==='authorReload')harness.storage=message.snapshot;
    if(message.type==='authorLifecycleRefreshRequest'||message.type==='authorReload')harness.refreshRequests.push(message);
    if(!['answerCodeSubmit','engineAnswerSubmit','engineJsonRequest'].includes(message.type))return;
    const action={...message,answer:message.code,action:message.bonus?'bonus':'answer'};
    harness.actions.push(action);
    fetch('/__mock/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)}).then(async response=>{
      if(disposed||!window.__enplus)return;
      if(!response.ok)throw new Error('Mock host HTTP '+response.status);
      const result=await response.json();
      if(disposed)return;
      if(message.requestId&&result.requestId!==message.requestId)throw new Error('Mismatched RN request ID');
      if(message.requestId&&(!result.engineJson||typeof result.engineJson!=='object'||Array.isArray(result.engineJson)))throw new Error('Synthetic engineJson response not supplied');
      harness.results.push(result);
      if(message.requestId)window.__enplus.resolveEngineJsonRequest(message.requestId,result.engineJson);
    }).catch(error=>{if(disposed)return;harness.results.push({error:error.message});if(message.requestId)window.__enplus?.rejectEngineJsonRequest(message.requestId,error.message);});
  }};
})();
