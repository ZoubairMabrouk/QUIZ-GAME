import { WebSocketServer, WebSocket } from 'ws';
import { requireRule } from './rules.js';
import {randomUUID} from 'node:crypto';
export function originAllowed(origin, config) {
  return !origin || (config.allowedOrigins ?? ['http://localhost:5173','http://127.0.0.1:5173','http://localhost:5174','http://127.0.0.1:5174']).includes(origin);
}
export class Realtime {
  constructor({server,store,security,rooms,competitions,config}) {
    Object.assign(this,{server,store,security,rooms,competitions,config});
    this.channel=security.prefix+'room-events';this.stopped=false;this.busy=false;this.presenceTasks=new Set();
    this.wss=new WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:false});
    this.wss.on('connection',(ws,req)=>this.connected(ws,req));
    this.upgrade=(req,socket,head)=>{
      socket.on('error',()=>{});
      if(req.url!=='/ws' || !originAllowed(req.headers.origin,config) || this.wss.clients.size>=1000){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      security.limit('ws-connect',req.socket.remoteAddress,30,60).then(()=>{
        if(!socket.destroyed)this.wss.handleUpgrade(req,socket,head,ws=>this.wss.emit('connection',ws,req));
      }).catch(()=>socket.destroy());
    };
    server.on('upgrade',this.upgrade);
  }
  async start(){
    this.subscriber=this.security.client.duplicate();this.subscriber.on('error',()=>{});
    await this.subscriber.connect();
    await this.subscriber.subscribe(this.channel,code=>{if(/^[A-Z2-9]{6}$/.test(code))void this.broadcast(code);});
    if(this.competitions) {
      this.competitionTimer=setInterval(()=>void this.competitionEvents(),1000);this.competitionTimer.unref();
    }
    this.tickTimer=setInterval(()=>void this.sweep(),this.config.tickMs??250);this.tickTimer.unref();
    this.repairTimer=setInterval(()=>void this.repair(),5000);this.repairTimer.unref();
    this.heartbeat=setInterval(()=>{
      for(const ws of this.wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}
    },5000);this.heartbeat.unref();
  }
  send(ws,data){
    if(ws.readyState!==WebSocket.OPEN)return;
    if(ws.bufferedAmount>65536){ws.close(1013,'Slow connection');return;}
    ws.send(JSON.stringify({v:1,...data}));
  }
  connected(ws){
    ws.alive=true;ws.connectionId=randomUUID();
    ws.on('pong',()=>{ws.alive=true;if(ws.competitionId)this.backgroundPresence(ws,true);});ws.on('error',()=>{});
    const timer=setTimeout(()=>ws.close(4401,'Authentication required'),5000);
    ws.on('close',()=>{clearTimeout(timer);if(ws.competitionId)this.backgroundPresence(ws,false);});
    let chain=Promise.resolve(),pending=0,windowStart=Date.now(),count=0;
    ws.on('message',(raw,binary)=>{
      if(binary || ++pending>16){ws.close(1008,'Invalid message');return;}
      // Sample before the per-socket queue; consume errors inside the queued handler.
      let isAnswer=false;try{isAnswer=JSON.parse(raw.toString())?.type==='competition.answer';}catch{}
      const receipt=isAnswer?this.competitions?.receipt().then(now=>({now}),error=>({error})):undefined;
      chain=chain.then(async()=>{
        if(Date.now()-windowStart>=60000){windowStart=Date.now();count=0;}
        requireRule(++count<=60,'Too many messages',429);
        let m;try{m=JSON.parse(raw.toString());}catch{requireRule(false,'Invalid JSON');}
        requireRule(m&&typeof m==='object'&&!Array.isArray(m),'Invalid message');
        if(!ws.user){
          requireRule(m.type==='auth','Authentication required',401);
          const user=await this.store.authenticate(m.accessToken);
          requireRule(user.audience!=='admin','Player phone session required',403);
          requireRule(this.config.mode!=='production'||user.phoneVerified,'Verified phone required',403);
          requireRule([...this.wss.clients].filter(s=>s.user?.id===user.id).length<5,'Too many connections',429);
          ws.user=user;ws.token=m.accessToken;clearTimeout(timer);this.send(ws,{type:'authenticated'});return;
        }
        ws.user=await this.store.authenticate(ws.token);
        if(m.type==='subscribe'){
          requireRule(typeof m.code==='string'&&/^[A-Z2-9]{6}$/.test(m.code),'Invalid room code');
          const state=await this.rooms.snapshot(ws.user,m.code);ws.roomCode=m.code;ws.roomRevision=state.revision;this.send(ws,{type:'room.state',state});
        }else if(m.type==='competition.subscribe'){
          requireRule(this.competitions,'Competition unavailable',503);
          if(ws.competitionId)await this.competitions.presence(ws.user,ws.competitionId,ws.connectionId,false);
          ws.competitionId=null;
          ws.connectionId=randomUUID();
          const state=await this.competitions.play(ws.user,m.id);
          await this.competitions.presence(ws.user,m.id,ws.connectionId);
          ws.competitionId=m.id;
          ws.eventRevision=Number.isSafeInteger(m.afterRevision)&&m.afterRevision>=0?Math.min(m.afterRevision,state.revision):state.revision;
          ws.stateRevision=state.revision;ws.statePersonalRevision=state.personalRevision;
          this.send(ws,{type:'competition.state',state});
        }else if(m.type==='competition.answer'){
          requireRule(this.competitions && ws.competitionId===m.id,'Subscribe to competition first',403);
          const received=await receipt;if(received.error)throw received.error;
          this.send(ws,{type:'competition.answer.accepted',...(await this.competitions.play(ws.user,m.id,{questionNo:m.questionNo,choice:m.choice},received.now))});
        }else if(m.type==='competition.unsubscribe'){await this.competitions.presence(ws.user,ws.competitionId,ws.connectionId,false);ws.competitionId=null;this.send(ws,{type:'unsubscribed'});}
        else if(m.type==='unsubscribe'){ws.roomCode=null;this.send(ws,{type:'unsubscribed'});}
        else if(m.type==='ping'){this.send(ws,{type:'pong',clientTime:m.clientTime,serverTime:Date.now()});}
        else requireRule(false,'Unknown message type');
      }).catch(e=>{
        this.send(ws,{type:'error',status:e.status??503,message:e.status?e.message:'Service temporarily unavailable'});
        if([401,403].includes(e.status))ws.close(4401,'Session invalid');
      }).finally(()=>{pending--;});
    });
  }
  backgroundPresence(ws,connected){
    const task=this.competitions.presence(ws.user,ws.competitionId,ws.connectionId,connected).catch(()=>{});
    this.presenceTasks.add(task);void task.finally(()=>this.presenceTasks.delete(task));
  }
  async snapshot(ws){
    try{
      const user=await this.store.authenticate(ws.token);
      if(ws.roomCode){const state=await this.rooms.snapshot(user,ws.roomCode);if(ws.roomRevision!==state.revision){this.send(ws,{type:'room.state',state});ws.roomRevision=state.revision;}}
    }catch(e){if(e.status===401||e.status===403)ws.close(4401,'Session invalid');}
  }
  async broadcast(code){await Promise.all([...this.wss.clients].filter(ws=>ws.roomCode===code).map(ws=>this.snapshot(ws)));}
  async publish(code){
    // Mutations have already committed; failed publication must not tell clients to replay them.
    try{await this.security.client.publish(this.channel,code);}catch{console.error(JSON.stringify({event:'room_publish_failed'}));}
  }
  async repair(){
    if(this.repairBusy||this.stopped)return;this.repairBusy=true;
    try{for(const ws of this.wss.clients){if(ws.user){await this.snapshot(ws);if(ws.competitionId){
      try{const user=await this.store.authenticate(ws.token);
        const {rows:[probe]}=await this.store.pool.query('SELECT c.revision,r.answer_revision FROM competitions c JOIN competition_registrations r ON r.competition_id=c.id WHERE c.id=$1 AND r.user_id=$2',[ws.competitionId,user.id]);
        if(probe && (ws.stateRevision!==Number(probe.revision) || ws.statePersonalRevision!==probe.answer_revision)){
          const state=await this.competitions.play(user,ws.competitionId);this.send(ws,{type:'competition.state',state});ws.stateRevision=state.revision;ws.statePersonalRevision=state.personalRevision;
        }
      }catch(e){if(e.status===401||e.status===403)ws.close(4401,'Session invalid');}
    }}}}finally{this.repairBusy=false;}
  }
  async competitionEvents(){
    if(this.competitionBusy||this.stopped)return;this.competitionBusy=true;
    try {
      const groups=new Map();
      for(const ws of this.wss.clients)if(ws.competitionId){const previous=groups.get(ws.competitionId);groups.set(ws.competitionId,Math.min(previous??Infinity,ws.eventRevision??0));}
      for(const [id,revision] of groups){
        // A sequence ID is not commit order. Revision is serialized by the competition row lock.
        const {rows}=await this.store.pool.query('SELECT id::text,competition_id,revision,state FROM competition_events WHERE competition_id=$1 AND revision>$2 ORDER BY revision LIMIT 100',[id,revision]);
        for(const event of rows)for(const ws of this.wss.clients) if(ws.competitionId===id && Number(event.revision)>(ws.eventRevision??0)){
          try {await this.store.authenticate(ws.token);this.send(ws,{type:'competition.updated',eventId:event.id,id,revision:Number(event.revision),state:event.state});ws.eventRevision=Number(event.revision);}
          catch(e){if(e.status===401||e.status===403)ws.close(4401,'Session invalid');}
        }
      }
    }catch{console.error(JSON.stringify({event:'competition_events_failed'}));}
    finally{this.competitionBusy=false;}
  }
  async sweep(){
    if(this.busy||this.stopped)return;this.busy=true;
    try{
      const {rows}=await this.store.pool.query(`SELECT code FROM rooms WHERE state->>'status'='question'
        AND (state->>'startedAt')::double precision+(state->>'durationMs')::double precision <= EXTRACT(EPOCH FROM clock_timestamp())*1000 LIMIT 100`);
      for(const {code} of rows)if(await this.rooms.settle(code))await this.publish(code);
    }catch{console.error(JSON.stringify({event:'room_scheduler_failed'}));}finally{this.busy=false;}
  }
  async close(){
    this.stopped=true;clearInterval(this.tickTimer);clearInterval(this.repairTimer);clearInterval(this.heartbeat);clearInterval(this.competitionTimer);
    this.server.off('upgrade',this.upgrade);for(const ws of this.wss.clients)ws.terminate();
    await new Promise(resolve=>this.wss.close(resolve));
    await Promise.allSettled([...this.presenceTasks]);
    if(this.subscriber?.isOpen)await this.subscriber.quit();
    while(this.busy)await new Promise(r=>setTimeout(r,10));
    while(this.competitionBusy)await new Promise(r=>setTimeout(r,10));
    while(this.repairBusy)await new Promise(r=>setTimeout(r,10));
  }
}
