(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),dialog=$('#notifications-dialog'),message=$('#notifications-message');
  let api,userId,registration,device,settings,projects=[],running=false,syncing=false,generation=0,prompt;
  const supported=()=>isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const status=text=>{message.textContent=text;};
  const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(new URL(value).href)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  function key(value) {return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));}
  async function identify(value) {
    if(!registration?.active) return;
    const channel=new MessageChannel();
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{channel.port1.close();reject(new Error('Não foi possível preparar este dispositivo. Tente novamente.'));},5000);
      channel.port1.onmessage=()=>{clearTimeout(timeout);channel.port1.close();resolve();};
      registration.active.postMessage({type:'identity',userId:value},[channel.port2]);
    });
  }
  function controls() {
    $('#notifications-enable').textContent=device ? 'Salvar sistemas acompanhados' : 'Ativar neste dispositivo';
    $('#notifications-stop').hidden=!device;
    $('#notifications-test').hidden=!device;
    $('#notifications-enable').disabled=!settings || !supported() || Notification.permission==='denied';
    $('#notifications-button').textContent=device ? '◉ Notificações ativas' : '◉ Notificações';
  }
  function systemOptions() {
    const all=$('#notifications-all');all.checked=!device?.systemIds;
    $('#notifications-systems').replaceChildren();
    for(const project of projects) {
      const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
      input.type='checkbox';input.value=project.id;input.checked=all.checked || device.systemIds.includes(project.id);
      text.textContent=project.name;label.append(input,text);$('#notifications-systems').append(label);
    }
    for(const input of $('#notifications-systems').querySelectorAll('input')) input.disabled=all.checked;
  }
  async function current() {
    const sub=await registration.pushManager.getSubscription();
    return api('/api/notifications'+(sub ? '?device='+await hash(sub.endpoint) : ''));
  }
  async function ack(summary) {
    if(summary?.cursor) await api('/api/notifications?action=seen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cursor:summary.cursor})});
    if(navigator.clearAppBadge) await navigator.clearAppBadge().catch(()=>{});
  }
  function showSummary(summary) {
    if(!summary?.total) return;
    const banner=$('#notifications-summary');banner.hidden=false;
    $('#notifications-summary-text').textContent=`${summary.total} novo${summary.total===1?' relato':'s relatos'} desde seu último acesso · `+summary.systems.map(item=>`${item.name}: ${item.count}`).join(' · ');
    $('#notifications-summary-open').onclick=()=>{window.dispatchEvent(new CustomEvent('central-notification-open',{detail:summary.systems.map(item=>item.id)}));banner.hidden=true;};
  }
  async function start(options) {
    api=options.api;userId=options.userId;const version=++generation;running=false;device=null;settings=null;
    $('#notifications-button').disabled=false;
    $('#notifications-button').title='Preferências deste dispositivo';
    if(!supported()) {status('Este navegador não oferece notificações. No iPhone, abra a Central adicionada à Tela de Início.');controls();return;}
    try {
      registration=await navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'});
      registration=await navigator.serviceWorker.ready;
      if(version!==generation) return;
      await identify(userId);
      if(!await registration.pushManager.getSubscription()) {status('Ative as notificações para receber os novos relatos neste dispositivo.');controls();return;}
      const result=await current();if(version!==generation)return;
      settings=result;device=result.device;running=!!device;controls();
      if(result.summary?.total && Notification.permission==='granted') {
        showSummary(result.summary);
        await registration.showNotification(`Central de Bugs · ${result.summary.total} ${result.summary.total===1?'novo relato':'novos relatos'}`,{
          body:result.summary.systems.map(item=>`${item.name.slice(0,60)}: ${item.count}`).join(' · ').slice(0,500),
          tag:'central-new-reports',icon:'/icons/icon-192.png',silent:true,data:{url:'/?notifications=1&systems='+encodeURIComponent(result.summary.systems.map(item=>item.id).join(','))}
        });
        await ack(result.summary);
      }
    } catch {status('Não foi possível conferir as notificações. Abra esta opção para tentar novamente.');controls();}
  }
  async function open() {
    const version=generation;
    if(dialog.open)return;dialog.showModal();status('Carregando preferências…');
    if(!supported()){status('Notificações não estão disponíveis neste navegador. No iPhone, adicione a Central à Tela de Início e abra por esse ícone.');controls();return;}
    try {
      if(!registration) {registration=await navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'});registration=await navigator.serviceWorker.ready;}
      const result=await current();if(version!==generation)return;settings=result;device=settings.device;running=!!device;systemOptions();controls();
      status(Notification.permission==='denied' ? 'O navegador bloqueou as notificações. Libere a permissão nas configurações do site para ativar.' : device ? 'Este dispositivo recebe resumos agrupados a cada minuto, quando há novos relatos.' : 'Escolha os sistemas e ative. O navegador vai pedir sua autorização.');
    } catch(error){status(error.message);controls();}
  }
  async function activate() {
    const version=generation;
    const ids=$('#notifications-all').checked ? null : [...$('#notifications-systems').querySelectorAll('input:checked')].map(input=>input.value);
    if(ids && !ids.length){status('Escolha pelo menos um sistema ou marque Todos os sistemas.');return;}
    $('#notifications-enable').disabled=true;
    status(device ? 'Salvando preferências…' : 'Ativando notificações…');
    try {
      const permission=Notification.permission==='granted' ? 'granted' : await Notification.requestPermission();
      if(version!==generation)return;
      if(permission!=='granted'){status('Notificações não autorizadas. Você pode ativar depois.');return;}
      await identify(userId);
      if(version!==generation){await identify('');return;}
      let sub=await registration.pushManager.getSubscription();
      if(sub && !device){await sub.unsubscribe();sub=null;}
      sub=sub || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(settings.publicKey)});
      if(version!==generation){await sub.unsubscribe();return;}
      await api('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),systemIds:ids})});
      const result=await current();if(version!==generation){await sub.unsubscribe();return;}settings=result;device=settings.device;running=!!device;status('Notificações ativadas neste dispositivo.');controls();
    } catch(error){status(error.message || 'Não foi possível ativar. Tente novamente.');}
    finally{controls();}
  }
  async function stop({silent=false}={}) {
    running=false;const version=++generation;
    try {
      registration=registration || await navigator.serviceWorker?.getRegistration('/');
      await identify('');
      const sub=await registration?.pushManager.getSubscription();
      if(sub) {
        try{await api('/api/notifications',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:await hash(sub.endpoint)})});}catch{}
        if(!await sub.unsubscribe())throw new Error('Falha ao desativar no navegador.');
      }
      for(const notice of await registration?.getNotifications() || [])notice.close();
      if(navigator.clearAppBadge)await navigator.clearAppBadge().catch(()=>{});
      if(version===generation){device=null;if(silent)settings=null;$('#notifications-summary').hidden=true;controls();if(!silent)status('Notificações desativadas neste dispositivo.');}
    } catch(error){if(!silent)status('Não foi possível concluir a desativação. Tente novamente.');}
  }
  async function tick() {
    if(!running || syncing || document.hidden || !document.hasFocus())return;
    const version=generation;syncing=true;
    try{
      const result=await current();if(version!==generation)return;device=result.device;running=!!device;
      if(result.summary?.total){
        showSummary(result.summary);
        // Preservar os relatos até o envio push, mesmo com o painel em foco.
        if(!result.summary.pending)await ack(result.summary);
      }
      controls();
    }catch{}
    finally{syncing=false;}
  }
  function reset() {generation++;running=false;device=null;settings=null;dialog.close();$('#notifications-summary').hidden=true;void identify('').catch(()=>{});controls();}
  $('#notifications-button').onclick=()=>void open();$('#notifications-close').onclick=()=>dialog.close();
  $('#notifications-enable').onclick=()=>void activate();$('#notifications-stop').onclick=()=>void stop();
  $('#notifications-all').onchange=()=>{for(const input of $('#notifications-systems').querySelectorAll('input'))input.disabled=$('#notifications-all').checked;};
  $('#notifications-test').onclick=async()=>{try{await registration.showNotification('Central de Bugs · teste',{body:'As notificações estão funcionando neste dispositivo.',icon:'/icons/icon-192.png',tag:'central-test',data:{url:'/'}});status('Notificação de teste enviada. Confira a área de notificações do aparelho.');}catch{status('Não foi possível mostrar a notificação. Confira a permissão do navegador.');}};
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;$('#install-app').hidden=false;});
  window.addEventListener('appinstalled',()=>{$('#install-app').hidden=true;prompt=null;});
  $('#install-app').onclick=async()=>{if(prompt){await prompt.prompt();prompt=null;$('#install-app').hidden=true;}};
  window.CentralNotifications={start,stop,reset,tick,setProjects(value){projects=value;if(!dialog.open)systemOptions();}};
})();
