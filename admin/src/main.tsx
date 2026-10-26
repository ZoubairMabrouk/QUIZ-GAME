import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

type Json=Record<string,unknown>;
let access='',refresh='',expires=0,rotating:Promise<void>|null=null;
async function request(path:string,body?:unknown,auth=true):Promise<Json>{
  if(auth && Date.now()>expires-45000){
    if(!rotating) rotating=request('/auth/refresh',{refreshToken:refresh},false).then(session).catch(e=>{access='';refresh='';throw e;}).finally(()=>{rotating=null;});
    await rotating;
  }
  const response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+access}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();
  if(!response.ok) {if(auth && response.status===401){access='';refresh='';}throw new Error(result.error??'Service indisponible');}
  return result;
}
function session(data:Json){access=String(data.accessToken);refresh=String(data.refreshToken);expires=Date.parse(String(data.expiresAt));}
const pretty=(value:unknown)=>JSON.stringify(value,null,2);
function App(){
  const [signed,setSigned]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState('');
  const [tab,setTab]=useState('competitions'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[output,setOutput]=useState<Json>({});
  const [catalog,setCatalog]=useState<Json[]>([]),[events,setEvents]=useState<Json[]>([]),[questionId,setQuestionId]=useState('');
  const [question,setQuestion]=useState(pretty({category:'science',language:'fr',difficulty:1,status:'draft',text:'',choices:['','','',''],correctIndex:0,explanation:'',source:'',development:false}));
  const [importText,setImportText]=useState('{"questions":[]}');
  const [csv,setCsv]=useState('');
  const [adjustment,setAdjustment]=useState(pretty({userId:'',currency:'silver',amount:0,reason:'',key:crypto.randomUUID()}));
  const [category,setCategory]=useState('science'),[categoryName,setCategoryName]=useState('Science');
  const [title,setTitle]=useState('Compétition quotidienne'),[date,setDate]=useState(''),[zone,setZone]=useState(Intl.DateTimeFormat().resolvedOptions().timeZone),[cost,setCost]=useState(0),[minimum,setMinimum]=useState(2),[limit,setLimit]=useState(30),[language,setLanguage]=useState('fr'),[milestone,setMilestone]=useState(1),[winner,setWinner]=useState(5);
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){if(!access){setSigned(false);setOutput({});}setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}
  async function load(){const data=await request('/v1/competitions');setEvents(data.competitions as Json[]);}
  async function loadCatalog(){const data=await request('/v1/admin/catalog');setCatalog(data.questions as Json[]);setOutput({categories:data.categories});}
  const button=(label:string,action:()=>Promise<void>)=><button disabled={busy} onClick={()=>void run(action)}>{label}</button>;
  return <main><header><div><small>QUIZ GAME</small><h1>Administration</h1></div>{signed&&button('Déconnexion',async()=>{await request('/auth/logout',{});access='';refresh='';setSigned(false);setOutput({});setEvents([]);setCatalog([]);setCurrentPassword('');setNewPassword('');})}</header>
    {error&&<p role="alert" className="error">{error}</p>}{busy&&<p role="status">Opération en cours…</p>}
    {!signed?<section><h2>Connexion administrateur</h2><p>Connectez-vous avec votre nom d’utilisateur et votre mot de passe. Le rôle administrateur est vérifié par le serveur.</p>
      <form onSubmit={e=>{e.preventDefault();void run(async()=>{const data=await request('/v1/admin/auth/login',{username,password},false);session(data);setPassword('');setSigned(true);await load();});}}>
      <label>Nom d’utilisateur<input name="username" value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={64}/></label>
      <label>Mot de passe<input name="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required maxLength={1024}/></label>
      <button type="submit" disabled={busy}>Se connecter</button></form>
    </section>:<><nav>{['competitions','catalogue','audit','compte'].map(item=><button key={item} aria-pressed={tab===item} onClick={()=>{setTab(item);setOutput({});}}>{item}</button>)}</nav>
    {tab==='compte'&&<section><h2>Changer le mot de passe</h2><form onSubmit={e=>{e.preventDefault();void run(async()=>{session(await request('/v1/admin/auth/password',{currentPassword,newPassword}));setCurrentPassword('');setNewPassword('');setOutput({message:'Mot de passe modifié. Les autres sessions administrateur ont été révoquées.'});});}}>
    <label>Mot de passe actuel<input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} autoComplete="current-password" required/></label>
    <label>Nouveau mot de passe (12 caractères minimum)<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" minLength={12} maxLength={1024} required/></label><button type="submit" disabled={busy}>Enregistrer le mot de passe</button></form></section>}
    {tab==='competitions'&&<><section><h2>Planifier une compétition</h2><div className="grid">
      <label>Titre<input value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>Départ (heure locale du navigateur)<input type="datetime-local" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>Fuseau de référence<input value={zone} onChange={e=>setZone(e.target.value)}/></label>
      <label>Catégories (séparées par virgules)<input value={category} onChange={e=>setCategory(e.target.value)}/></label>
      <label>Coût Silver<input type="number" min="0" value={cost} onChange={e=>setCost(Number(e.target.value))}/></label>
      <label>Minimum de joueurs<input type="number" min="2" value={minimum} onChange={e=>setMinimum(Number(e.target.value))}/></label>
      <label>Plafond de questions<input type="number" min="1" max="200" value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label>
      <label>Langue<select value={language} onChange={e=>setLanguage(e.target.value)}>{['fr','en','ar'].map(l=><option key={l}>{l}</option>)}</select></label>
      <label>Golden au palier<input type="number" min="0" value={milestone} onChange={e=>setMilestone(Number(e.target.value))}/></label>
      <label>Golden vainqueur<input type="number" min="0" value={winner} onChange={e=>setWinner(Number(e.target.value))}/></label>
    </div><p>Les heures saisies sont celles du navigateur, converties en UTC. Le fuseau de référence est conservé pour l’affichage. Les cadeaux réels sont désactivés.</p>
    {button('Créer',async()=>{setOutput(await request('/v1/admin/competitions',{title,startsAt:new Date(date).toISOString(),timeZone:zone,silverCost:cost,minimumPlayers:minimum,categories:category.split(',').map(x=>x.trim()),questionLimit:limit,language,milestoneGolden:milestone,winnerGolden:winner}));await load();})}</section>
    <section><h2>Supervision</h2>{button('Actualiser',load)}{events.map(event=><article key={String(event.id)}><h3>{String(event.title)}</h3><p>{String(event.state)} • {String(event.participants)} inscrits • {new Date(String(event.starts_at)).toLocaleString()}</p><div className="actions">{button('Ouvrir',async()=>{setOutput(await request(`/v1/admin/competitions/${event.id}/open`,{}));await load();})}{button('Détails',async()=>setOutput(await request(`/v1/competitions/${event.id}`)))}{button('Annuler et rembourser',async()=>{if(window.confirm('Annuler cette compétition et rembourser les inscrits ?')){setOutput(await request(`/v1/admin/competitions/${event.id}/cancel`,{}));await load();}})}</div></article>)}</section></>}
    {tab==='catalogue'&&<><section><h2>Catégories</h2><label>Identifiant<input value={category} onChange={e=>setCategory(e.target.value)}/></label><label>Nom<input value={categoryName} onChange={e=>setCategoryName(e.target.value)}/></label>{button('Enregistrer la catégorie',async()=>setOutput(await request('/v1/admin/categories',{slug:category,name:categoryName})))}</section>
    <section><h2>Questions</h2>{button('Charger le catalogue',loadCatalog)}<p>QCM à quatre choix. Les erreurs sont signalées par le serveur. La version est obligatoire lors d’une modification.</p>
    <label>Question (JSON)<textarea value={question} onChange={e=>setQuestion(e.target.value)} rows={18}/></label><div className="actions">{button(questionId?'Enregistrer la modification':'Créer la question',async()=>{setOutput(await request('/v1/admin/questions'+(questionId?'/'+questionId:''),JSON.parse(question)));await loadCatalog();})}{button('Nouvelle question',async()=>{setQuestionId('');const data=JSON.parse(question);delete data.version;setQuestion(pretty(data));})}</div>
    {catalog.map(q=><article key={String(q.id)}><strong>{String((q.content as Json).text)}</strong><p>{String(q.status)} • {String(q.category)} • v{String(q.version)}</p><div className="actions">{button('Modifier',async()=>{setQuestionId(String(q.id));setQuestion(pretty({...q,...q.content as Json}));})}{button('Historique',async()=>setOutput(await request(`/v1/admin/questions/${q.id}/history`)))}</div></article>)}</section>
    <section><h2>Import JSON / CSV</h2><label>Objet contenant questions[]<textarea rows={12} value={importText} onChange={e=>setImportText(e.target.value)}/></label>{button('Valider et importer le JSON',async()=>setOutput(await request('/v1/admin/questions/import',JSON.parse(importText))))}
    <label>CSV (correctIndex de 0 à 3)<textarea rows={6} value={csv} onChange={e=>setCsv(e.target.value)} placeholder="category,language,difficulty,status,text,choice1,choice2,choice3,choice4,correctIndex,explanation,source"/></label>{button('Valider et importer le CSV',async()=>setOutput(await request('/v1/admin/questions/import',{format:'csv',csv})))}
    {button('Statistiques des questions',async()=>setOutput(await request('/v1/admin/catalog/statistics')))}</section></>}
    {tab==='audit'&&<section><h2>Audit et ledger</h2>{button('Charger les dernières actions',async()=>setOutput(await request('/v1/admin/audit')))}{button('Charger le ledger',async()=>setOutput(await request('/v1/admin/ledger')))}{button('Utilisateurs',async()=>setOutput(await request('/v1/admin/users')))}
    <h3>Ajustement audité</h3><p>La clé identifie l’opération : conserver la même clé après une erreur réseau, en choisir une nouvelle pour un nouvel ajustement.</p><label>Écriture JSON<textarea rows={8} value={adjustment} onChange={e=>setAdjustment(e.target.value)}/></label>{button('Appliquer l’ajustement',async()=>{if(window.confirm('Confirmer cette écriture dans le ledger ?'))setOutput(await request('/v1/admin/wallet/adjustments',JSON.parse(adjustment)));})}</section>}
    </>}
    {Object.keys(output).length>0&&<section><h2>Résultat</h2><pre>{pretty(output)}</pre></section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
