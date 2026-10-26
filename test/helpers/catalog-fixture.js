import {randomUUID} from 'node:crypto';
// Explicit test data persisted through SQL; never a runtime fallback.
export async function catalogFixture(store){
  await store.pool.query("INSERT INTO question_categories(slug,name) VALUES('fixture','Fixture') ON CONFLICT DO NOTHING");
  if((await store.pool.query("SELECT id FROM editorial_questions WHERE category='fixture' LIMIT 1")).rowCount)return;
  for(let i=0;i<40;i++)await store.pool.query("INSERT INTO editorial_questions(id,category,language,difficulty,status,content) VALUES($1,'fixture','fr',1,'validated',$2)",[randomUUID(),{text:`Fixture ${i}`,choices:['A','B','C','D'],correctIndex:0,explanation:'Fixture answer',source:'Explicit test fixture'}]);
}
