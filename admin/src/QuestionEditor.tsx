import React from 'react';
type Question=Record<string,unknown>;
export function QuestionEditor({value,onChange,disabled}:{value:string;onChange:(value:string)=>void;disabled:boolean}){
  const q=JSON.parse(value) as Question;
  const set=(key:string,next:unknown)=>onChange(JSON.stringify({...q,[key]:next},null,2));
  const choices=(q.choices??['','','','']) as string[];
  const media=(q.media??{type:'image',url:'',alt:''}) as Record<string,string>;
  return <fieldset disabled={disabled}><legend>Question éditoriale</legend>
    <div className="grid">
      <label>Catégorie<input value={String(q.category??'')} onChange={e=>set('category',e.target.value)} maxLength={50}/></label>
      <label>Langue<select value={String(q.language)} onChange={e=>set('language',e.target.value)}>{['fr','en','ar'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Difficulté<input type="number" min={1} max={5} value={Number(q.difficulty)} onChange={e=>set('difficulty',Number(e.target.value))}/></label>
      <label>Statut<select value={String(q.status)} onChange={e=>set('status',e.target.value)}><option value="draft">Brouillon</option><option value="validated">Validée</option><option value="retired">Retirée</option></select></label>
    </div>
    <label>Énoncé<textarea rows={3} value={String(q.text??'')} maxLength={2000} onChange={e=>set('text',e.target.value)}/></label>
    {choices.map((choice,index)=><label key={index}>Réponse {index+1}<input value={choice} maxLength={500} onChange={e=>set('choices',choices.map((x,i)=>i===index?e.target.value:x))}/><span><input type="radio" name="correct-answer" checked={q.correctIndex===index} onChange={()=>set('correctIndex',index)}/>Bonne réponse</span></label>)}
    <label>Explication<textarea value={String(q.explanation??'')} maxLength={4000} onChange={e=>set('explanation',e.target.value)}/></label>
    <label>Source<input value={String(q.source??'')} maxLength={1000} onChange={e=>set('source',e.target.value)}/></label>
    <label>Image HTTPS facultative<input type="url" value={media.url??''} onChange={e=>set('media',e.target.value?{...media,type:'image',url:e.target.value}:null)}/></label>
    {media.url&&<label>Description accessible de l'image<input value={media.alt??''} maxLength={300} onChange={e=>set('media',{...media,alt:e.target.value})}/></label>}
    <label><input type="checkbox" checked={q.development===true} onChange={e=>set('development',e.target.checked)}/>Contenu de développement : exclu de tous les jeux réels</label>
  </fieldset>;
}
