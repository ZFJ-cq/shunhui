import { io } from 'socket.io-client';
export async function createRemoteSfu(notify) {
 if (!process.env.INTERNAL_SECRET) throw Error('INTERNAL_SECRET required for remote SFU');
 const socket = io(process.env.SFU_URL, { auth: { secret: process.env.INTERNAL_SECRET }, reconnection: false });
 await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(Error('SFU connection timeout')),15000); socket.once('connect',()=>{clearTimeout(timer);resolve()});socket.once('connect_error',e=>{clearTimeout(timer);reject(e)}) });
 socket.on('notification', ({ id,type,payload,target }) => notify(id,type,payload,target));
 socket.on('disconnect',()=>{ console.error('SFU connection lost; restart required'); process.exit(1) });
 function call(method,args) { return new Promise((resolve,reject)=>socket.timeout(15000).emit('rpc',{method,args},(error,result)=>error||!result||result.error?reject(Error(error?.message||result?.error||'SFU no response')):resolve(result.data))) }
 return { request:(...args)=>call('request',args), leave:(...args)=>call('leave',args), pause:(...args)=>call('pause',args), resume:(...args)=>call('resume',args), close(){socket.removeAllListeners('disconnect');socket.disconnect()} };
}
