import {requireRule} from './rules.js';

// RFC4180-style quoted fields, including embedded commas, quotes and line breaks.
export function csvQuestions(text) {
  requireRule(typeof text==='string' && text.length>0 && text.length<=1000000,'Invalid CSV');
  const rows=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=ch;continue;}
    if(ch==='"'){requireRule(!field && !closed,'Invalid CSV quote');quoted=true;}
    else if(ch===','){row.push(field);field='';closed=false;}
    else if(ch==='\r'||ch==='\n'){
      if(ch==='\r' && text[i+1]==='\n')i++;
      row.push(field);if(row.some(x=>x.length))rows.push(row);row=[];field='';closed=false;
    }else{requireRule(!closed,'Unexpected CSV character after quote');field+=ch;}
  }
  requireRule(!quoted,'Unclosed CSV quote');
  row.push(field);if(row.some(x=>x.length))rows.push(row);
  const header=rows.shift()?.map((x,i)=>i===0?x.replace(/^\uFEFF/,''):x);
  const required=['category','language','difficulty','status','text','choice1','choice2','choice3','choice4','correctIndex','explanation','source'];
  requireRule(header && new Set(header).size===header.length && required.every(x=>header.includes(x)),'Invalid CSV headers');
  return rows.map((values,index)=>{
    requireRule(values.length===header.length,`CSV row ${index+2}: wrong column count`);
    const q=Object.fromEntries(header.map((key,i)=>[key,values[i]]));
    const number=(v)=>/^\d+$/.test(v)?Number(v):null;
    return {...q,difficulty:number(q.difficulty),correctIndex:number(q.correctIndex),choices:[q.choice1,q.choice2,q.choice3,q.choice4],development:q.development===undefined?false:q.development==='true'?true:q.development==='false'?false:null};
  });
}
