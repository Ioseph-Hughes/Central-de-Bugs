const {createHash,randomBytes,timingSafeEqual,ECDH}=require('node:crypto');
const webpush=require('web-push');
const {fail,authorizeAdmin,canView}=require('./registry.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const checked=result=>{if(result.error?.message==='device_limit')throw fail(409,'O limite é de dez dispositivos por administrador.');if(result.error) throw fail(503,'Notificações indisponíveis. Confira a instalação no banco.'); return result.data;};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
function subscription(input) {
  try {
    const url=new URL(input?.endpoint),host=url.hostname;
    if(url.protocol!=='https:' || url.username || url.password || url.hash || url.port && url.port!=='443' || input.endpoint.length>3000 ||
      !(host==='fcm.googleapis.com' || host.endsWith('.push.services.mozilla.com') || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com'))) throw Error();
    for(const [key,size] of [['p256dh',65],['auth',16]]) {
      if(typeof input.keys?.[key]!=='string' || !/^[\w-]+={0,2}$/.test(input.keys[key]) || Buffer.from(input.keys[key],'base64url').length!==size) throw Error();
    }
    ECDH.convertKey(Buffer.from(input.keys.p256dh,'base64url'),'prime256v1');
    return {endpoint:url.href,keys:{p256dh:input.keys.p256dh,auth:input.keys.auth}};
  } catch {throw fail(400,'A inscrição de notificações é inválida. Ative novamente neste dispositivo.');}
}
async function config(client,origin) {
  let value=checked(await client.from('central_push_config').select('*').eq('id',true).maybeSingle());
  if(!value) {
    const keys=webpush.generateVAPIDKeys();
    checked(await client.from('central_push_config').upsert({id:true,public_key:keys.publicKey,private_key:keys.privateKey,dispatch_token:randomBytes(32).toString('base64url'),origin},{onConflict:'id',ignoreDuplicates:true}));
    value=checked(await client.from('central_push_config').select('*').eq('id',true).single());
  }
  if(value.origin!==origin) throw fail(503,'Confira a origem configurada para as notificações.');
  return value;
}
function payload(summary,userId) {
  const lines=summary.systems.slice(0,4).map(item=>`${item.name.slice(0,60)}: ${item.count}`);
  if(summary.systems.length>4) lines.push(`+ ${summary.systems.length-4} sistema(s)`);
  return {title:`Central de Bugs · ${summary.total} novo${summary.total===1?' relato':'s relatos'}`,body:lines.join(' · '),total:summary.total,userId,
    url:'/?notifications=1&systems='+encodeURIComponent(summary.systems.map(item=>item.id).join(','))};
}
function createHandler({client,centralOrigin,send=(...args)=>webpush.sendNotification(...args)}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try {
      if(!client || !centralOrigin) throw fail(503,'Notificações disponíveis somente na Central online configurada.');
      if(req.headers.origin && req.headers.origin!==centralOrigin) throw fail(403,'Configure notificações no painel da Central.');
      const url=new URL(req.url,centralOrigin),action=url.searchParams.get('action');
      if(action==='dispatch') {
        if(req.method!=='POST') throw fail(405,'Método não permitido.');
        const cfg=await config(client,centralOrigin),token=req.headers.authorization?.replace(/^Bearer /,'') || '';
        if(Buffer.byteLength(token)!==Buffer.byteLength(cfg.dispatch_token) || !timingSafeEqual(Buffer.from(token),Buffer.from(cfg.dispatch_token))) throw fail(401,'Agendador não autorizado.');
        const devices=checked(await client.rpc('central_push_claim'));
        let sent=0,expired=0,failed=0;
        const started=Date.now();
        for(let index=0;index<devices.length && Date.now()-started<45000;index+=10) await Promise.all(devices.slice(index,index+10).map(async device=>{
          try {
            const summary=checked(await client.rpc('central_push_summary',{p_device:device.id}));
            if(summary.pending && summary.total) {
              await send(device.subscription,JSON.stringify(payload(summary,device.user_id)),{TTL:3600,urgency:'normal',topic:'central-new-reports',timeout:5000,
                vapidDetails:{subject:centralOrigin,publicKey:cfg.public_key,privateKey:cfg.private_key}});
              sent++;
            }
            checked(await client.from('central_push_devices').update({delivered_id:Math.max(device.delivered_id,summary.cursor),lease_until:null}).eq('id',device.id).eq('user_id',device.user_id).eq('lease_until',device.lease_until));
          } catch(error) {
            if([404,410].includes(error.statusCode)) {checked(await client.from('central_push_devices').delete().eq('id',device.id).eq('user_id',device.user_id));expired++;}
            else {failed++;console.error('Falha Web Push:',error.statusCode || error.status || 'network');}
          }
        }));
        json(res,200,{sent,expired,failed});return;
      }
      const user=await authorizeAdmin(client,req);
      if(req.method==='GET') {
        const cfg=await config(client,centralOrigin),id=url.searchParams.get('device');
        const device=id && /^[a-f0-9]{64}$/.test(id) ? checked(await client.from('central_push_devices').select('id,system_ids').eq('id',id).eq('user_id',user.id).maybeSingle()) : null;
        const summary=device ? checked(await client.rpc('central_push_summary',{p_device:device.id})) : null;
        json(res,200,{publicKey:cfg.public_key,device:device && {id:device.id,systemIds:device.system_ids},summary});return;
      }
      const chunks=[];let size=0;
      if(req.body!==undefined) chunks.push(Buffer.from(typeof req.body==='string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body)));
      else for await(const chunk of req){size+=chunk.length;if(size>16384) throw fail(413,'Configuração muito grande.');chunks.push(chunk);}
      const raw=Buffer.concat(chunks);if(raw.length>16384)throw fail(413,'Configuração muito grande.');
      let input;try{input=JSON.parse(raw.toString());if(!input || typeof input!=='object' || Array.isArray(input))throw Error();}catch{throw fail(400,'Configuração inválida.');}
      if(action==='seen' && req.method==='POST') {
        if(!Number.isSafeInteger(input.cursor) || input.cursor<0) throw fail(400,'Resumo inválido.');
        checked(await client.rpc('central_push_ack',{p_user:user.id,p_cursor:input.cursor}));json(res,200,{saved:true});return;
      }
      if(req.method==='DELETE') {
        if(!/^[a-f0-9]{64}$/.test(input.id || '')) throw fail(400,'Dispositivo inválido.');
        checked(await client.from('central_push_devices').delete().eq('id',input.id).eq('user_id',user.id));json(res,200,{removed:true});return;
      }
      if(req.method!=='POST') throw fail(405,'Método não permitido.');
      const sub=subscription(input.subscription),id=hash(sub.endpoint);
      const systems=input.systemIds;
      if(systems!==null && (!Array.isArray(systems) || !systems.length || systems.length>100 || !systems.every(value=>typeof value==='string'))) throw fail(400,'Escolha pelo menos um sistema ou todos os sistemas.');
      if(systems) {
        const allowed=checked(await client.from('central_projects').select('*')).filter(project=>canView(project,user));
        if(systems.some(value=>!allowed.some(project=>project.id===value))) throw fail(400,'Um dos sistemas selecionados não existe mais.');
      }
      await config(client,centralOrigin);
      checked(await client.rpc('central_push_register',{p_user:user.id,p_id:id,p_subscription:sub,p_system_ids:systems===null ? null : [...new Set(systems)]}));
      json(res,200,{id,saved:true});
    } catch(error){if(!error.status)console.error('Central Web Push:',error.code || error.name);json(res,error.status || 503,{error:error.status ? error.message : 'Não foi possível configurar as notificações. Tente novamente.'});}
  };
}
module.exports={createHandler,subscription,payload,config};
