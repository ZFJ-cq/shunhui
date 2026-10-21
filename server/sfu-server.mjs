import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createSfu } from './sfu.mjs';
if (!process.env.INTERNAL_SECRET || process.env.INTERNAL_SECRET.length < 32) throw Error('INTERNAL_SECRET must have 32+ characters');
const server=createServer((req,res)=>{
 if(req.url!=='/health'){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'not_found'}));return}
 res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({status:'ok'}));
});
const io=new Server(server,{maxHttpBufferSize:100000});
const sfu=await createSfu((id,type,payload,target)=>io.emit('notification',{id,type,payload,target}));
io.use((socket,next)=>{ const candidate=Buffer.from(String(socket.handshake.auth.secret||'')), secret=Buffer.from(process.env.INTERNAL_SECRET); if(candidate.length!==secret.length||!timingSafeEqual(candidate,secret))return next(Error('Unauthorized'));next() });
let client;
io.on('connection',socket=>{
 if(client?.connected){socket.disconnect(true);return}client=socket;
 const queues=new Map();
 socket.on('rpc',({method,args},ack)=>{
  if(!['request','leave','pause','resume'].includes(method)||!Array.isArray(args))return ack({error:'Invalid RPC'});
  const id=args[0];const task=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(()=>sfu[method](...args));queues.set(id,task);
  task.then(data=>ack({data}),e=>ack({error:e.message}));void task.finally(()=>{if(queues.get(id)===task)queues.delete(id)}).catch(()=>{});
 });
 socket.on('disconnect',()=>{console.error('Authoritative API disconnected; restarting SFU');process.exit(1)});
});
server.listen(Number(process.env.SFU_PORT||3002),'0.0.0.0',()=>console.log('Remote SFU ready'));
