import {PostgresStore} from '../src/postgres.js';
import {Editorial} from '../src/editorial.js';
import {questions} from '../src/catalog.js';

if (process.env.NODE_ENV === 'production') throw new Error('Development seed disabled in production');
const user={id:process.argv[2]};
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id??'')) throw new Error('Existing editorial user UUID required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const store=PostgresStore.connect(process.env.DATABASE_URL);
const editorial=new Editorial(store);
try {
  const result=await store.transaction(async c=>{
    await editorial.authorize(c,user);
    await c.query('SELECT pg_advisory_xact_lock(21410004)');
    const {rowCount}=await c.query('SELECT 1 FROM editorial_questions WHERE development=true LIMIT 1');
    if(rowCount) return 'Development bank already present; nothing changed.';
    for (const category of new Set(questions.map(q=>q.category)))
      await c.query('INSERT INTO question_categories(slug,name) VALUES($1,$1) ON CONFLICT DO NOTHING',[category]);
    for (const q of questions) await editorial.write(c,user,{...q,language:'fr',status:'validated',development:true,source:'Quiz Game — banque de développement, non éditoriale'});
    return 'Five development questions imported; not a production bank.';
  });
  console.log(result);
} finally {await store.close();}
