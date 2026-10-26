import {PostgresStore} from '../src/postgres.js';
import {Economy} from '../src/economy.js';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const store=PostgresStore.connect(process.env.DATABASE_URL);
try{
  let after=null,total=0,mismatches=0;
  do{const result=await new Economy(store).reconcile({repair:process.argv.includes('--repair'),after});after=result.next;total+=result.checked;mismatches+=result.mismatches;}while(after);
  console.log(JSON.stringify({checked:total,mismatches,repair:process.argv.includes('--repair')}));
}finally{await store.close();}
