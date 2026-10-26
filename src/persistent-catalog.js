import {integer,requireRule} from './rules.js';
export class PersistentCatalog {
  constructor(store){this.store=store;}
  async select(c,{users=[],categories=[],language='fr',count=3,repetitionDays=7,globalRepeat=false,difficulty=null}={}) {
    integer(count,1,200,'question count');integer(repetitionDays,0,365,'repetition days');
    requireRule(['fr','en','ar'].includes(language),'Invalid language');
    requireRule(Array.isArray(categories)&&categories.length<=20&&categories.every(x=>typeof x==='string'&&/^[a-z0-9_-]{1,50}$/.test(x)),'Invalid categories');
    const {rows}=await c.query(`WITH candidates AS (
      SELECT q.*,row_number() OVER(PARTITION BY q.category ORDER BY random()) AS category_turn FROM editorial_questions q
      WHERE q.status='validated' AND NOT q.development AND q.language=$1
      AND (cardinality($2::text[])=0 OR q.category=ANY($2::text[]))
      AND ($7::int IS NULL OR q.difficulty=$7)
      AND NOT EXISTS(SELECT 1 FROM question_exposures h WHERE h.question_id=q.id AND h.user_id=ANY($3::uuid[])
        AND h.seen_at>=clock_timestamp()-$4::int*interval '1 day')
      AND (NOT $5::boolean OR NOT EXISTS(SELECT 1 FROM competition_questions cq JOIN competitions previous ON previous.id=cq.competition_id
        WHERE cq.question_id=q.id AND previous.state<>'ANNULEE' AND previous.questions_frozen_at>=clock_timestamp()-$4::int*interval '1 day'))
      ) SELECT * FROM candidates ORDER BY category_turn,random() LIMIT $6`,[language,categories,users,repetitionDays,globalRepeat,count,difficulty]);
    requireRule(rows.length===count,'Insufficient eligible catalogue',409);
    return rows.map(({category_turn,...q})=>q);
  }
  async expose(c,users,questions,sourceId){
    for(const user of [...users].sort())for(const question of questions)
      await c.query('INSERT INTO question_exposures(user_id,question_id,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[user,question.id,sourceId]);
  }
  async categories(){
    const {rows}=await this.store.pool.query(`SELECT c.slug,c.name,count(q.id)::int AS questions FROM question_categories c
      JOIN editorial_questions q ON q.category=c.slug AND q.status='validated' AND NOT q.development GROUP BY c.slug,c.name ORDER BY c.slug`);
    return {categories:rows};
  }
}
