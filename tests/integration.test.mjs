import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { startServer } from '../server/index.mjs';

test('authenticated meeting lifecycle and isolated signaling', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'shunhui-test-')); process.env.DB_FILE = join(dir, 'db.sqlite');
 const fakeSfu = { request: async (_id,_uid,method,data) => method==='capabilities'?{codecs:[{mimeType:'audio/opus'}]}:method==='createTransport'?{id:'test-transport',iceCandidates:[{ip:data.announcedIp || '127.0.0.1'}]}:{}, leave: async()=>{}, pause:async()=>{},resume:async()=>{},close:()=>{} };
 const oldAdminPhone=process.env.ADMIN_PHONE, oldAdminPassword=process.env.ADMIN_PASSWORD, oldAnnouncedIp=process.env.RTC_ANNOUNCED_IP;
 process.env.ADMIN_PHONE='13800138000'; process.env.ADMIN_PASSWORD='test-admin-password-123'; process.env.RTC_ANNOUNCED_IP='192.168.110.217';
 const server = await startServer(0, process.env.REAL_SFU === '1' ? {} : { sfu: fakeSfu }), base = `http://127.0.0.1:${server.port}`; const sockets = [];
 const call = async (path, token, method = 'GET', body) => {
  const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
 };
 const guest = async name => (await call('/user/guest-login', '', 'POST', { nickname: name })).data;
 const connect = token => new Promise((resolve,reject) => { const s = io(base, { auth: { token, announcedIp: '192.168.110.227' }, reconnection:false }); sockets.push(s); s.once('connect',()=>resolve(s)); s.once('connect_error',reject); });
 const request = (s,type,payload) => new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error(`signaling request timed out: ${type}`)),5000); s.emit('request',{type,payload},result=>{clearTimeout(timer);resolve(result)}); });
 const nextSignal = (s, type) => new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error(`signal timed out: ${type}`)),5000); const listener=e=>{if(e.type===type){clearTimeout(timer);s.off('signal',listener);resolve(e.payload)}}; s.on('signal',listener); });
 try {
  const a=await guest('主持人'), b=await guest('参与者'), c=await guest('旁观者');
  assert.equal((await fetch(base+'/health')).status,200);
  assert.equal((await call('/meetings','')).status,401);
  assert.equal((await call('/admin/overview',a.token)).status,403);
  const adminLogin=await call('/user/login','', 'POST',{phone:'13800138000',password:'test-admin-password-123'});
  assert.equal(adminLogin.status,200); assert.equal((await call('/admin/overview',adminLogin.data.token)).status,200);
  const registered=await call('/user/register','', 'POST',{phone:'13922222222',nickname:'自助注册',password:'user-password-123'});
  assert.equal(registered.status,200); assert.equal(registered.data.user.nickname,'自助注册'); assert.ok(registered.data.token);
  assert.equal((await call('/user/register','', 'POST',{phone:'13922222222',nickname:'重复',password:'user-password-123'})).status,409);
  assert.equal((await call('/user/login','', 'POST',{phone:'13922222222',password:'user-password-123'})).status,200);
  const account=await call('/admin/users',adminLogin.data.token,'POST',{phone:'13911111111',nickname:'测试账号',password:'test-user-password-123'});
  assert.equal(account.status,200); assert.equal((await call(`/admin/users/${account.data.id}`,adminLogin.data.token,'PUT',{disabled:true})).data.disabled,true);
  assert.equal((await call('/user/login','', 'POST',{phone:'13911111111',password:'test-user-password-123'})).status,401);
  const snake=(await call('/meetings/schedule',a.token,'POST',{meeting_title:'字段兼容预约',start_time:new Date(Date.now()+3600000).toISOString(),duration:60,max_participants:10,default_mute:true,join_before_host:true})).data;
  assert.equal(snake.title,'字段兼容预约'); assert.equal(snake.maxParticipants,10);
  assert.equal((await call(`/meetings/${snake.id}`,a.token,'DELETE')).status,200);
  const adminManaged=(await call('/meetings/create',a.token,'POST',{title:'管理员操作测试'})).data;
  assert.equal((await call(`/admin/meetings/${adminManaged.id}/end`,adminLogin.data.token,'PUT')).status,200);
  assert.equal((await call(`/meetings/${adminManaged.id}`,a.token)).data.status,'ended');
  const m=(await call('/meetings/create',a.token,'POST',{title:'集成测试',password:'123456',maxParticipants:2})).data;
  assert.equal(m.hasPassword,true); assert.equal(m.passwordHash,undefined);
  assert.equal((await call(`/meetings/${m.id}/join`,b.token,'POST',{nickname:'参与者',password:'000000'})).status,403);
  const ja=(await call(`/meetings/${m.id}/join`,a.token,'POST',{nickname:'主持人'})).data;
  const jb=(await call(`/meetings/${m.id}/join`,b.token,'POST',{nickname:'参与者',password:'123456'})).data;
  assert.equal((await call(`/meetings/${m.id}/join`,c.token,'POST',{nickname:'旁观者',password:'123456'})).status,409);
  let sa=await connect(ja.token); const sb=await connect(jb.token);
  assert.equal((await call(`/meetings/${m.id}/lock`,b.token,'PUT',{locked:true})).status,403);
  assert.equal((await call(`/meetings/${m.id}/chat`,b.token,'PUT',{chatClosed:true})).status,403);
  assert.equal((await call(`/meetings/${m.id}/participant/mute`,b.token,'PUT',{targetUserId:a.userId,media:'audio',mute:true})).status,403);
  assert.equal((await call(`/meetings/${m.id}/participant/${a.userId}`,b.token,'DELETE')).status,403);
  assert.equal((await call(`/meetings/${m.id}/end`,b.token,'PUT')).status,403);
  assert.equal((await call(`/meetings/${m.id}/lock`,b.token,'PUT',{locked:true})).status,403);
  const lockedState=nextSignal(sb,'room_state');
  assert.equal((await call(`/meetings/${m.id}/lock`,a.token,'PUT',{locked:true})).status,200);
  assert.equal((await lockedState).meeting.locked,true);
  assert.equal((await request(sa,'switch_layout',{layout:'speaker'})).error,undefined);
  assert.equal((await request(sa,'switch_layout',{layout:'speaker'})).data.layout,'speaker');
  assert.equal((await request(sb,'switch_layout',{layout:'gallery'})).error,undefined);
  const cap=await request(sa,'sfu',{method:'capabilities'}); assert.ok(cap.data.codecs.length>0);
  const transport=await request(sa,'sfu',{method:'createTransport',data:{direction:'send'}}); assert.ok(transport.data.iceCandidates.length);
  assert.equal(transport.data.iceCandidates[0].ip, '192.168.110.227');
  if (process.env.REAL_SFU !== '1') {
   await request(sa,'sfu',{method:'produce',data:{transportId:transport.data.id,kind:'video',rtpParameters:{},source:'screen'}});
   assert.equal((await call(`/meetings/${m.id}/participants`,a.token)).data.find(p=>p.userId===a.userId).screenShare,true);
   await request(sa,'sfu',{method:'closeTransport',data:{transportId:transport.data.id,direction:'send'}});
   assert.equal((await call(`/meetings/${m.id}/participants`,a.token)).data.find(p=>p.userId===a.userId).screenShare,false);
  }
  if (process.env.REAL_SFU === '1') { const foreign=await request(sb,'sfu',{method:'connectTransport',data:{transportId:transport.data.id,dtlsParameters:{}}}); assert.ok(foreign.error); }
  const oldSession = sa;
  const replaced = new Promise(resolve => oldSession.once('disconnect', resolve));
  sa = await connect(ja.token);
  await replaced;
  assert.equal((await request(sa,'state',{})).data.participants.filter(p=>p.userId===a.userId).length,1);
  assert.equal((await call(`/meetings/${m.id}/participants`,a.token)).data.filter(p=>p.userId===a.userId).length,1);
  // A transient transport loss retains the seat and room JWT; reconnect must
  // release old media transports before accepting a replacement transport.
  sa.io.reconnection(false); sa.io.engine.close();
  sa=await connect(ja.token);
  const restored=await request(sa,'state',{});
  assert.equal(restored.data.participants.filter(p=>p.userId===a.userId).length,1);
  const replacement=await request(sa,'sfu',{method:'createTransport',data:{direction:'send'}});
  assert.ok(replacement.data.id);
  if (process.env.REAL_SFU === '1') {
    assert.notEqual(replacement.data.id,transport.data.id);
    assert.ok((await request(sa,'sfu',{method:'connectTransport',data:{transportId:transport.data.id,dtlsParameters:{}}})).error);
  }
  const received=new Promise(resolve=>sb.on('signal',e=>{ if(e.type==='chat_message')resolve(e.payload) }));
  await request(sa,'chat',{content:'你好 <script>alert(1)</script>'});
  assert.equal((await received).text,'你好 <script>alert(1)</script>');
  const closedState=nextSignal(sb,'room_state');
  assert.equal((await call(`/meetings/${m.id}/chat`,a.token,'PUT',{chatClosed:true})).status,200);
  assert.equal((await closedState).meeting.chatClosed,true);
  assert.ok((await request(sb,'chat',{content:'应被阻止'})).error);
  const reopenedState=nextSignal(sb,'room_state');
  assert.equal((await call(`/meetings/${m.id}/chat`,a.token,'PUT',{chatClosed:false})).status,200);
  assert.equal((await reopenedState).meeting.chatClosed,false);
  const reopenedMessage=nextSignal(sa,'chat_message');
  assert.equal((await request(sb,'chat',{content:'重新开放后可发送'})).error,undefined);
  assert.equal((await reopenedMessage).text,'重新开放后可发送');
  assert.equal((await call(`/meetings/${m.id}/participant/mute`,a.token,'PUT',{targetUserId:b.userId,media:'audio',mute:true})).status,200);
  let participants=(await call(`/meetings/${m.id}/participants`,a.token)).data;
  assert.equal(participants.find(p=>p.userId===b.userId).audioOff,true);
  assert.equal((await call(`/meetings/${m.id}/participant/mute`,a.token,'PUT',{targetUserId:b.userId,media:'video',mute:true})).status,200);
  participants=(await call(`/meetings/${m.id}/participants`,a.token)).data;
  assert.equal(participants.find(p=>p.userId===b.userId).videoOff,true);
  const hostAudioBeforeAllMute=participants.find(p=>p.userId===a.userId).audioOff;
  assert.equal((await call(`/meetings/${m.id}/participant/mute`,a.token,'PUT',{targetUserId:'all',media:'audio',mute:true})).status,200);
  participants=(await call(`/meetings/${m.id}/participants`,a.token)).data;
  assert.equal(participants.find(p=>p.userId===b.userId).audioOff,true);
  assert.equal(participants.find(p=>p.userId===a.userId).audioOff,hostAudioBeforeAllMute);
  assert.equal((await call(`/meetings/${m.id}/participant/${b.userId}`,a.token,'DELETE')).status,200);
  assert.equal((await call(`/meetings/${m.id}/join`,b.token,'POST',{nickname:'参与者',password:'123456'})).status,403);
  assert.equal((await call(`/meetings/${m.id}/end`,a.token,'PUT')).status,200);
  assert.equal((await call(`/meetings/${m.id}/join`,a.token,'POST',{nickname:'主持人'})).status,409);
  assert.equal((await call(`/meetings/${m.id}`,c.token)).data.participantCount,0);
 } finally { sockets.forEach(s=>s.disconnect()); await server.close(); await rm(dir,{recursive:true,force:true}); if(oldAdminPhone===undefined)delete process.env.ADMIN_PHONE;else process.env.ADMIN_PHONE=oldAdminPhone; if(oldAdminPassword===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=oldAdminPassword; if(oldAnnouncedIp===undefined)delete process.env.RTC_ANNOUNCED_IP;else process.env.RTC_ANNOUNCED_IP=oldAnnouncedIp; }
});
