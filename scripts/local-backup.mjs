import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const repo='Fulstak-apps/sportswire247-local-reposter';
const gh=args=>execFileSync('gh',args,{encoding:'utf8',timeout:45000});
const file='runtime/state/backup-health.json';
const previous=JSON.parse(await fs.readFile(file,'utf8').catch(()=>'{}'));
const result={checkedAt:new Date().toISOString(),lastDispatchAt:previous.lastDispatchAt};
try {
 const runs=JSON.parse(gh(['run','list','--repo',repo,'--workflow','publish-sportswire.yml','--limit','5','--json','status,conclusion,createdAt']));
 const active=runs.some(x=>x.status!=='completed');
 const recent=runs.some(x=>Date.now()-Date.parse(x.createdAt)<10*60000);
 const health=JSON.parse(gh(['api',`repos/${repo}/contents/logs/publisher-health.json`,'-H','Accept: application/vnd.github.raw+json']));
 result.publisherHealth=health;
 const overdue=Object.values(health.platforms || {}).some(x=>x.overdue===true && x.status==='healthy');
 const failed=runs[0]?.status==='completed' && runs[0]?.conclusion!=='success';
 const cooled=Date.now()-(Date.parse(previous.lastDispatchAt)||0)>=10*60000;
 result.action=active?'publisher_active':!cooled?'cooldown':overdue?'retry_overdue_post':failed?'retry_failed_run':recent?'recent_run':'retry_missing_run';
 if(!active&&(!recent||failed||overdue)&&cooled){
  gh(['workflow','run','publish-sportswire.yml','--repo',repo]);
  result.lastDispatchAt=new Date().toISOString();
  try {
   const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({model:'qwen3:4b',stream:false,think:false,prompt:'Explain this watchdog status briefly using only supplied evidence: '+JSON.stringify({runs,action:result.action}),options:{num_predict:100}})});
   result.localDiagnosis=(await response.json()).response;
  }catch{result.localDiagnosis='Ollama unavailable; backup continues';}
 }
}catch(error){result.action='check_failed';result.error=error.message;process.exitCode=1;}
await fs.writeFile(file,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
