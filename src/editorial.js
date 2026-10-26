import { randomUUID } from 'node:crypto';
import { integer, requireRule } from './rules.js';
import { Competitions } from './competitions.js';
import {csvQuestions} from './csv-questions.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateQuestion(body) {
  requireRule(body && typeof body === 'object' && !Array.isArray(body), 'Invalid question');
  for (const [key,max] of [['text',2000],['explanation',4000],['source',1000]])
    requireRule(typeof body[key] === 'string' && body[key].trim().length > 0 && body[key].length <= max, `Invalid ${key}`);
  requireRule(Array.isArray(body.choices) && body.choices.length === 4 && body.choices.every(x=>typeof x === 'string' && x.trim().length > 0 && x.length <= 500) && new Set(body.choices.map(x=>x.trim())).size === 4, 'Four distinct choices required');
  integer(body.correctIndex,0,3,'correct index'); integer(body.difficulty,1,5,'difficulty');
  requireRule(['fr','en','ar'].includes(body.language),'Invalid language');
  requireRule(['draft','validated','retired'].includes(body.status),'Invalid question status');
  requireRule(typeof body.category==='string' && /^[a-z0-9_-]{1,50}$/.test(body.category),'Invalid category');
  requireRule(body.development === undefined || typeof body.development === 'boolean','Invalid development flag');
  let media=null;
  if(body.media!=null){
    requireRule(body.media.type==='image'&&typeof body.media.url==='string'&&body.media.url.length<=2000&&typeof body.media.alt==='string'&&body.media.alt.trim().length>0&&body.media.alt.length<=300,'Invalid media');
    let url;try{url=new URL(body.media.url);}catch{requireRule(false,'Invalid media URL');}
    requireRule(url.protocol==='https:'&&!url.username&&!url.password,'HTTPS media URL required');
    media={type:body.media.type,url:url.href,alt:body.media.alt.trim()};
  }
  return {text:body.text.trim(),choices:body.choices.map(x=>x.trim()),correctIndex:body.correctIndex,explanation:body.explanation.trim(),source:body.source.trim(),media};
}

export class Editorial {
  constructor(store) {this.store=store;this.admin=new Competitions(store);}
  async authorize(c,user) {
    const {rows:[role]}=await c.query('SELECT role FROM user_roles WHERE user_id=$1 FOR SHARE',[user.id]);
    requireRule(['administrator','moderator'].includes(role?.role),'Editorial role required',403);
  }
  async category(user,body) {
    requireRule(typeof body.slug==='string' && /^[a-z0-9_-]{1,50}$/.test(body.slug),'Invalid category');
    requireRule(typeof body.name==='string' && body.name.trim().length>0 && body.name.length<=100,'Invalid category name');
    return this.store.transaction(async c=>{
      await this.authorize(c,user);
      const {rows:[row]}=await c.query('INSERT INTO question_categories(slug,name) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET name=excluded.name RETURNING *',[body.slug,body.name.trim()]);
      await this.admin.audit(c,user.id,'catalog.category',user.id,{slug:body.slug});
      return row;
    });
  }
  async write(c,user,body,id) {
    const content=validateQuestion(body);
    const {rowCount}=await c.query('SELECT 1 FROM question_categories WHERE slug=$1',[body.category]);
    requireRule(rowCount,'Unknown category');
    let row;
    if (id) {
      requireRule(uuid.test(id),'Invalid question ID');
      const {rows:[old]}=await c.query('SELECT * FROM editorial_questions WHERE id=$1 FOR UPDATE',[id]);
      requireRule(old,'Question not found',404);
      requireRule(body.version===old.version,'Question version conflict',409);
      ({rows:[row]}=await c.query(`UPDATE editorial_questions SET version=version+1,category=$2,language=$3,difficulty=$4,status=$5,development=$6,content=$7,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[id,body.category,body.language,body.difficulty,body.status,body.development??false,JSON.stringify(content)]));
    } else {
      ({rows:[row]}=await c.query('INSERT INTO editorial_questions(id,category,language,difficulty,status,development,content) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),body.category,body.language,body.difficulty,body.status,body.development??false,JSON.stringify(content)]));
    }
    await c.query('INSERT INTO question_versions(question_id,version,snapshot,actor_id) VALUES($1,$2,$3,$4)',[row.id,row.version,JSON.stringify(row),user.id]);
    await this.admin.audit(c,user.id,'catalog.question',row.id,{version:row.version});
    return row;
  }
  async save(user,body,id) {
    return this.store.transaction(async c=>{await this.authorize(c,user);return this.write(c,user,body,id);});
  }
  async import(user,body) {
    if(body.format==='csv') body={questions:csvQuestions(body.csv)};
    requireRule(Array.isArray(body.questions) && body.questions.length>0 && body.questions.length<=200,'Import 1–200 questions');
    return this.store.transaction(async c=>{
      await this.authorize(c,user);
      const errors=[];
      for (const [index,q] of body.questions.entries()) {
        try {
          validateQuestion(q);
          const {rowCount}=await c.query('SELECT 1 FROM question_categories WHERE slug=$1',[q.category]);
          requireRule(rowCount,'Unknown category');
        } catch(e) { if(!e.status) throw e; errors.push({row:index+1,error:e.message}); }
      }
      if(errors.length) return {imported:0,errors};
      const questions=[];
      for(const q of body.questions) questions.push(await this.write(c,user,q));
      return {imported:questions.length,errors:[],questions};
    });
  }
  async list(user,page={}) {
    const {limit,offset}=this.admin.pagination(page);
    return this.store.transaction(async c=>{
      await this.authorize(c,user);
      const {rows:questions}=await c.query('SELECT * FROM editorial_questions ORDER BY updated_at DESC,id LIMIT $1 OFFSET $2',[limit+1,offset]);
      const {rows:categories}=await c.query('SELECT * FROM question_categories ORDER BY slug');
      return {questions:questions.slice(0,limit),categories,nextOffset:questions.length>limit?offset+limit:null};
    });
  }
  async history(user,id) {
    requireRule(typeof id==='string' && uuid.test(id),'Invalid question ID');
    return this.store.transaction(async c=>{
      await this.authorize(c,user);
      const {rows:versions}=await c.query('SELECT * FROM question_versions WHERE question_id=$1 ORDER BY version DESC LIMIT 100',[id]);
      return {versions};
    });
  }
  async statistics(user) {
    return this.store.transaction(async c=>{
      await this.authorize(c,user);
      const {rows:statistics}=await c.query(`SELECT q.question_id,q.version,count(*)::int AS answers,
        avg(a.response_ms)::float AS mean_response_ms,
        avg(CASE WHEN a.choice=(q.snapshot->'content'->>'correctIndex')::int THEN 1.0 ELSE 0.0 END)::float AS accuracy
        FROM competition_answers a JOIN competition_questions q ON q.competition_id=a.competition_id AND q.position=a.question_no
        JOIN competition_rounds r ON r.competition_id=a.competition_id AND r.question_no=a.question_no
        GROUP BY q.question_id,q.version ORDER BY count(*) DESC,q.question_id LIMIT 100`);
      return {statistics,scope:'submitted_answers_in_closed_competition_rounds'};
    });
  }
}
