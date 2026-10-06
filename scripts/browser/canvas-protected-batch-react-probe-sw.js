self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin===self.location.origin)return;
 if(url.origin==='https://canvas-protected-media.invalid'&&/^\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+\.png$/.test(url.pathname)&&event.request.method==='GET'){
  event.respondWith((async()=>{const [runId,name]=url.pathname.slice(1).split('/');const response=await fetch(self.location.origin+'/__canvas-react/'+runId+'/png/'+name,{cache:'no-store'});if(!response.ok)return Response.error();return new Response(await response.arrayBuffer(),{headers:{'content-type':'image/png','access-control-allow-origin':'*','cache-control':'no-store'}});})());return;
 }
 event.respondWith(Response.error());event.waitUntil(self.clients.matchAll().then(clients=>{for(const client of clients)client.postMessage({type:'fixture-network-blocked',url:event.request.url});}));
});
