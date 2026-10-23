(() => {
  window.__harness={actions:[],results:[],messages:[],errors:[],events:[]};
  for(const name of ['en:state','en:level','en:sector','en:help','en:bonus']){
    document.addEventListener(name,()=>window.__harness.events.push(name));
  }
  window.ReactNativeWebView={postMessage(raw){
    const msg=JSON.parse(raw);window.__harness.messages.push(msg);
    if(msg.type!=='enAction')return;
    window.__harness.actions.push(msg);
    fetch('/__mock/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(msg)})
      .then(async r=>{if(!r.ok)throw new Error('Mock server HTTP '+r.status);return r.json();})
      .then(result=>{
        if(result.requestId!==msg.requestId)throw new Error('Mismatched request ID');
        if(result.snapshot){
          window.__enplus.updateEnState(result.snapshot,result.serverTimeMs);
          const sectors=result.snapshot.level.sectors.map((s,index)=>({id:s.id,order:index+1,name:s.name,isAnswered:s.isAnswered,
            answer:s.isAnswered?{code:s.answer,login:'SyntheticPlayer',time:'00:01'}:null}));
          window.__enplus.updateSectors(sectors);
        }
        window.__enplus.resolveEnAction(msg.requestId,{ok:result.ok});
        window.__harness.results.push(result);
        document.querySelector('#harness-status').textContent=result.ok===true?'Верно':result.ok===false?'Неверно':'Не проверено';
      }).catch(error=>{
        window.__enplus.rejectEnAction(msg.requestId,{message:error.message});
        window.__harness.results.push({error:error.message});
        document.querySelector('#harness-status').textContent=error.message;
      });
  }};
  window.addEventListener('error',e=>window.__harness.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection',e=>window.__harness.errors.push(String(e.reason)));
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelector('#harness-send').onclick=()=>window.EN.answer(document.querySelector('#harness-input').value).catch(()=>{});
  });
})();
