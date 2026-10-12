// Web Push sem cache de páginas, sessões ou respostas privadas da Central.
const stateCache='central-push-state-v1',stateURL='/__central_push_identity';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function identity() {
  const response=await (await caches.open(stateCache)).match(stateURL);
  return response ? response.text() : '';
}
self.addEventListener('message',event=>{
  if(event.data?.type==='identity') event.waitUntil((async()=>{
    const cache=await caches.open(stateCache);
    if(event.data.userId) await cache.put(stateURL,new Response(event.data.userId)); else await cache.delete(stateURL);
    event.ports[0]?.postMessage({saved:true});
  })());
});
function destination(value) {
  const url=new URL(value || '/',self.location.origin);
  return url.origin===self.location.origin && url.pathname==='/' ? url.href : self.location.origin+'/';
}
async function notify(value) {
  if(!value || value.userId!==await identity()) return;
  await self.registration.showNotification(value.title || 'Central de Bugs',{
    body:value.body || 'Novos relatos recebidos.',icon:'/icons/icon-192.png',badge:'/icons/badge.png',
    tag:'central-new-reports',renotify:false,data:{url:destination(value.url)},
    actions:[{action:'open',title:'Ver ocorrências'}]
  });
  if(navigator.setAppBadge) await navigator.setAppBadge(Number(value.total) || 0).catch(()=>{});
}
self.addEventListener('push',event=>{
  let value;try{value=event.data?.json();}catch{}
  event.waitUntil(notify(value));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=destination(event.notification.data?.url),windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows) {
      if(new URL(client.url).origin!==self.location.origin) continue;
      await client.navigate(url);await client.focus();return;
    }
    await self.clients.openWindow(url);
  })());
});
