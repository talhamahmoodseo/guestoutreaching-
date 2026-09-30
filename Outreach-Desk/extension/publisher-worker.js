/* Campaign engine. State mutations are serialized; only page I/O runs in parallel.
   Several websites are researched at once (each in its own background tab), and each
   research wave is saved so stop/resume and worker restarts continue from the same place. */
importScripts('vendor/publisher-deps.js','publisher-core.js','publisher-connections.js','publisher-rules.js','publisher-da.js','publisher-language.js','publisher-ai.js','publisher-topics.js','publisher-model.js','publisher-sheets.js','publisher-output.js','publisher-mail.js');
(function(){
'use strict';
const C=PublisherCore,R=PublisherRules,M=PublisherModel,KEY='publisherDesk',LEADS='publisherLeads:',ACCOUNTS='publisherMailAccounts',ALARM='publisher-recover';
let chain=Promise.resolve(),timer,cache=null;const written=new Map();
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MAX_PARALLEL=8,DEFAULT_PARALLEL=5,ENGINE=chrome.runtime.getManifest?.().version||'dev';
const defaults=()=>({version:3,senderProfiles:[],databases:[],leads:[],campaigns:[],output:{status:'Not connected',pendingIds:[],lastSyncedAt:'',error:'',endpoint:''},settings:{excludePlatforms:true,researchUnclear:false,parallel:DEFAULT_PARALLEL,mailHistory:false,geminiModel:'gemini-3.1-flash-lite',blocklist:['forbes.com','wikipedia.org','medium.com','reddit.com','facebook.com','linkedin.com','youtube.com','quora.com'],sender:{name:'',email:'',company:'',website:'',subject:'Guest contribution enquiry',message:''}},activeId:null});

/* ---------- Storage: campaigns/settings in one key, leads split per campaign ---------- */
async function read(){
 if(cache)return cache;
 const meta=(await chrome.storage.local.get(KEY))[KEY];
 const s=M.migrate(meta?structuredClone(meta):defaults());
 const keys=Array.isArray(s.leadKeys)?s.leadKeys:[];delete s.leadKeys;
 if(keys.length){const stored=await chrome.storage.local.get(keys);for(const k of keys){const rows=stored[k];if(Array.isArray(rows)){s.leads.push(...rows);written.set(k,JSON.stringify(rows));}}}
 s.output ||= {status:'Not connected',pendingIds:[],lastSyncedAt:'',error:'',endpoint:''};s.output.pendingIds=(s.output.pendingIds||[]).filter(pid=>s.leads.some(r=>r.id===pid));if(s.output.status==='Pending'&&!s.output.pendingIds.length)s.output.status=s.output.error?'Error':'Connected';s.settings.parallel ||= DEFAULT_PARALLEL;
 for(const c of s.campaigns)upgradeCampaign(c);
 for(const r of s.leads)if(r.bucket==='no_email'&&!r.visitedURLs?.length)M.recompute(r);
 s.settings.sheetMode ||= 'manual';
 if(s.output.useAsHistory===undefined)s.output.useAsHistory=s.databases.some(d=>d.kind==='output');
 if(s.metricRun?.inFlight?.length){if(s.metricRun.batchCounts)Object.assign(s.metricRun,s.metricRun.batchCounts);s.metricRun.queue=C.uniq([...s.metricRun.inFlight,...s.metricRun.queue]);s.metricRun.inFlight=[];}
 if(!(await outputConfig())?.endpoint&&s.output.endpoint){s.output.endpoint='';s.output.status='Not connected';s.output.error='The Apps Script URL is not saved in this Chrome profile. Paste it again in Export destinations.';}
 cache=s;return s;
}
async function save(s){
 const groups=new Map();for(const r of s.leads){const k=LEADS+(r.campaignId||'none');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const changes={},remove=[];
 for(const [k,rows] of groups){const text=JSON.stringify(rows);if(written.get(k)!==text){changes[k]=rows;written.set(k,text);}}
 for(const k of [...written.keys()])if(k.startsWith(LEADS)&&!groups.has(k)){remove.push(k);written.delete(k);}
 const {leads,...rest}=s,meta={...rest,leadKeys:[...groups.keys()]},text=JSON.stringify(meta);
 if(written.get(KEY)!==text){changes[KEY]=meta;written.set(KEY,text);}
 if(Object.keys(changes).length)await chrome.storage.local.set(changes);
 if(remove.length)await chrome.storage.local.remove(remove);
}
async function accounts(){return ((await chrome.storage.local.get(ACCOUNTS))[ACCOUNTS]||[]).filter(a=>a&&a.id&&a.endpoint);}
function upgradeCampaign(c){c.opened ||= C.uniq([...(c.jobs||[]).map(j=>j.domain),...(c.pending||[]).map(p=>p.domain)]);if(c.current&&!c.jobs){c.jobs=[c.current];}delete c.current;c.jobs ||= [];c.tabPool ||= [];if(c.researchTabId&&!c.jobs.some(j=>j.tabId)){if(c.jobs[0])c.jobs[0].tabId=c.researchTabId;}delete c.researchTabId;}

// Only results you sent to the Sheet are kept in sync (for example after a metrics recheck).
function queueAuto(s,r){if(s.settings.sheetMode!=='auto'||!s.output?.endpoint||r.sheetSentAt||r.doNotContact||!candidate(s.campaigns.find(c=>c.id===r.campaignId)||{},r))return;if(!s.output.pendingIds.includes(r.id))s.output.pendingIds.push(r.id);s.output.status='Pending';wakeSheet();}
let sheetTimer;const wakeSheet=(ms=6000,force=false)=>{clearTimeout(sheetTimer);sheetTimer=setTimeout(()=>syncOutput(force).catch(console.error),ms);};
function queueOutput(s,id){const lead=s.leads.find(r=>r.id===id);if(!lead?.sheetSentAt)return;if(!s.output?.pendingIds.includes(id))s.output.pendingIds.push(id);if(s.output?.endpoint)s.output.status='Pending';}
let syncing=false;
async function syncOutput(force=false){
 if(syncing)return {status:'Pending',pending:0};syncing=true;try{return await deliverOutput(force);}finally{syncing=false;}
}
async function deliverOutput(force){
 const s=await read(),o=s.output;
 if(!o.pendingIds.length)return {status:o.status,pending:0};
 const config=await outputConfig();
 if(!config?.endpoint)return {status:'Not connected',pending:o.pendingIds.length};
 if(!force&&(o.health==='attention'||o.retryAt&&Date.now()<Date.parse(o.retryAt)))return {status:o.status,pending:o.pendingIds.length};
 const revision=o.revision||0,ids=o.pendingIds.slice(0,40),records=ids.map(id=>s.leads.find(r=>r.id===id)).filter(Boolean);
 const snapshots=new Map(records.map(r=>[r.id,JSON.stringify(PublisherOutput.record(r))]));o.lastAttemptAt=now();await save(s);
 let error=null;
 // The network call runs outside the queue so nothing else waits on it.
 try{if(records.length)await sendRows(config,records.map(PublisherOutput.record));}catch(e){error=e;}
 return serial(async()=>{const s2=await read(),o2=s2.output;
  if(o2.endpoint!==config.endpoint||(o2.revision||0)!==revision)return {status:o2.status,pending:o2.pendingIds.length};
  if(error){PublisherConnections.failed(o2,error);o2.status=o2.health==='retrying'?'Retrying':'Needs attention';}
  else{PublisherConnections.healthy(o2);for(const r of s2.leads)if(ids.includes(r.id))r.sheetSentAt ||= now();
   o2.pendingIds=o2.pendingIds.filter(id=>!ids.includes(id)||s2.leads.some(r=>r.id===id&&JSON.stringify(PublisherOutput.record(r))!==snapshots.get(id)));o2.status=o2.pendingIds.length?'Pending':'Connected';o2.lastSyncedAt=now();o2.error='';if(o2.pendingIds.length)wakeSheet(3000);}
  await save(s2);return {status:o2.status,pending:o2.pendingIds.length,error:o2.error};},'sheetApply');
}
const serial=(fn,label='op')=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
const wake=(ms=1200)=>{clearTimeout(timer);timer=setTimeout(()=>serial(tick,'tick').catch(console.error),ms);};
const active=s=>s.campaigns.find(c=>c.id===s.activeId);
function log(c,message){c.message=message;c.events=[{at:now(),message},...(c.events||[])].slice(0,100);}
async function closeTabs(ids){for(const tabId of C.uniq(ids||[]))try{await chrome.tabs.remove?.(tabId);}catch{}}
function flushJob(s,c,j){const at=s.leads.findIndex(r=>r.id===j.record.id);const keep=['notes','dealStatus','doNotContact','reviewDecision','selectedEmail'];if(at>=0)s.leads[at]={...j.record,...Object.fromEntries(keep.map(k=>[k,s.leads[at][k]]))};}
function finish(s,c,reason){for(const j of c.jobs||[])flushJob(s,c,j);const tabs=[...(c.tabPool||[]),...(c.jobs||[]).map(j=>j.tabId)].filter(Boolean);c.jobs=[];c.tabPool=[];closeTabs(tabs);c.status='complete';c.completedAt=now();log(c,reason);
 if(s.settings.autoMetrics!==false){const ids=s.leads.filter(r=>r.campaignId===c.id&&r.visitedURLs?.length&&r.bucket!=='rejected'&&!r.metricsCheckedAt&&['da','dr','spam','age','traffic'].some(k=>!Number.isFinite(r[k]))).map(r=>r.id);if(ids.length){if(s.metricRun&&['running','scheduled'].includes(s.metricRun.status)){s.metricRun.queue=C.uniq([...s.metricRun.queue,...ids]);s.metricRun.total=(s.metricRun.done||0)+s.metricRun.queue.length;}else s.metricRun={status:'scheduled',queue:ids,total:ids.length,done:0,updated:0,missing:0,parallel:2,tabs:[],startedAt:now(),automatic:true};wakeMetrics(1000);}}
}
function jobSummary(j){return {domain:j.domain,url:j.pages[0]||j.visited[j.visited.length-1]||'',pagesRead:j.visited.length,parked:!!j.parked};}
function publicState(s){return {...s,metricRun:s.metricRun?(({tabs,queue,...r})=>({...r,left:queue.length}))(s.metricRun):null,databases:s.databases.map(({domains,emails,contactedDomains,contactedEmails,...d})=>({...d,count:domains?.length||0,emailCount:emails?.length||0,contactedCount:contactedDomains?.length||0})),campaigns:s.campaigns.map(({seen,pending,jobs,tabPool,serpSnapshot,...c})=>({...c,progress:M.progress(s,{...c,pending,jobs}),queued:pending?.length||0,jobs:(jobs||[]).map(jobSummary),current:jobs?.[0]?jobSummary(jobs[0]):null}))};}
const within=(promise,ms,label)=>{let t;return Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error(label)),ms);})]).finally(()=>clearTimeout(t));};
async function groupTab(c,tabId){if(!chrome.tabs.group)return;try{if(c.groupId!=null){try{await chrome.tabs.group({groupId:c.groupId,tabIds:[tabId]});return;}catch{c.groupId=null;}}c.groupId=await chrome.tabs.group({tabIds:[tabId]});await chrome.tabGroups?.update(c.groupId,{title:'Outreach Desk',collapsed:true,color:'blue'});}catch{}}
async function navigate(target,kind,url,c){let tab;try{if(target[kind])tab=await chrome.tabs.get(target[kind]);}catch{}if(tab)tab=await chrome.tabs.update(tab.id,{url,active:false});else {tab=await chrome.tabs.create({url,active:false});target[kind]=tab.id;if(c)await groupTab(c,tab.id);}const start=Date.now();while(Date.now()-start<11000){await sleep(450);try{tab=await chrome.tabs.get(tab.id);}catch{throw Error('Research tab was closed.');}if(tab.status==='complete')break;}await sleep(900);return tab.id;}
async function collect(tabId,method,data){await within(chrome.scripting.executeScript({target:{tabId},files:['vendor/publisher-deps.js','publisher-core.js','publisher-rules.js','publisher-da.js','publisher-collector.js']}),5000,'Page does not allow extraction.');const results=await within(chrome.scripting.executeScript({target:{tabId},func:(name,arg)=>globalThis.PublisherCollector[name](arg),args:[method,data||{}]}),5000,'Page extraction timed out.');if(!results[0]?.result)throw Error('Page returned no readable content.');return results[0].result;}
async function outputConfig(){return (await chrome.storage.local.get('publisherOutputConfig')).publisherOutputConfig||null;}
// Transient network or Apps Script hiccups must not look like "not connected".
async function reachable(config,label){try{return await PublisherMail.ping(config);}catch(e){e.message=label+': '+e.message;throw e;}}
// Sending rows retries transient failures too, so one hiccup never looks like a broken connection.
async function sendRows(config,records){return PublisherConnections.retry(()=>PublisherOutput.send(config,'upsert',records));}
async function syncOne(db){db.status='syncing';try{let result;if(db.kind==='output'){const config=await outputConfig();if(!config?.endpoint)throw Error('Output Sheet is not connected.');result=await PublisherMail.history(config);}else result=await PublisherSheets.fetchSheet(db.url);const name=db.customName?db.name:result.name||db.name;Object.assign(db,result,{name,status:'ready',lastSyncedAt:now(),error:''});PublisherConnections.healthy(db);}catch(e){db.status='error';PublisherConnections.failed(db,e);throw e;}}
const researchSources=s=>s.databases.filter(d=>d.kind!=='output'||s.output.useAsHistory);
let refreshing=false;
async function refreshSources(){if(refreshing)return;const s=await read();if(active(s)?.status==='running')return;const db=researchSources(s).find(d=>d.kind==='sheet'&&PublisherConnections.due(d,60*60000));if(!db)return;
 refreshing=true;const before=db.lastSyncedAt,copy=structuredClone(db);try{await syncOne(copy);}catch{}finally{await serial(async()=>{const latest=await read(),existing=latest.databases.find(d=>d.id===copy.id);if(existing&&existing.lastSyncedAt===before){const name=existing.customName?existing.name:copy.name;Object.assign(existing,copy,{name,customName:existing.customName});await save(latest);}});refreshing=false;}}
let probing=false;
async function probeConnections(){if(probing)return;const s=await read();if(active(s)?.status==='running')return;probing=true;try{
 const list=await accounts(),a=list.find(a=>PublisherConnections.due(a,60*60000));
 if(a){const before=a.checkedAt;let info,error;try{info=await PublisherMail.ping(a);if(!info.gmail)throw Error('This script cannot read Gmail. Update its deployment.');}catch(e){error=e;}await serial(async()=>{const latest=await accounts(),current=latest.find(x=>x.id===a.id&&x.endpoint===a.endpoint&&x.checkedAt===before);if(current){if(error){PublisherConnections.failed(current,error);current.status=current.health==='retrying'?'Retrying':'Needs attention';}else{PublisherConnections.healthy(current);current.status='Connected';current.email=info.account||current.email;}await chrome.storage.local.set({[ACCOUNTS]:latest});}});return;}
 if(s.output.endpoint&&!s.output.pendingIds.length&&PublisherConnections.due(s.output,60*60000)){const config=await outputConfig(),revision=s.output.revision||0;let error;try{const info=await PublisherMail.ping(config);if(!info.sheet)throw Error('This script is not inside a Sheet. Update the deployment.');}catch(e){error=e;}await serial(async()=>{const current=await read();if(current.output.endpoint!==config?.endpoint||(current.output.revision||0)!==revision)return;if(error){PublisherConnections.failed(current.output,error);current.output.status=current.output.health==='retrying'?'Retrying':'Needs attention';}else{PublisherConnections.healthy(current.output);current.output.status=current.output.pendingIds.length?'Pending':'Connected';}await save(current);});}
 }finally{probing=false;}}
function blockConnection(c,status,e){c.status=status;c.retryAt=PublisherConnections.transient(e)?new Date(Date.now()+60000).toISOString():'';log(c,e.message+(c.retryAt?' Will retry automatically; your progress is saved.':' Update the connection, then Resume.'));}
function contactedStatus(value){return /^(contacted|follow-up|responded|negotiating|agreed|do not contact)$/i.test(C.clean(value));}

/* ---------- Contact history (domain level) ---------- */
function historyIndex(s,c){
 const contacted=new Map(),known=new Map(),add=(map,key,why)=>{if(key&&!map.has(key))map.set(key,why);};
 if(c.checkContacted!==false){for(const d of researchSources(s)){const why='Marked contacted in '+d.name;for(const x of d.contactedDomains||[])add(contacted,x,why);for(const e of d.contactedEmails||[]){add(contacted,e,why);add(contacted,C.companyDomain(e),why);}}
  for(const r of s.leads)if(r.campaignId!==c.id&&contactedStatus(r.dealStatus)){const why='Marked '+r.dealStatus+' in campaign '+(r.campaignName||'earlier campaign');add(contacted,r.domain,why);for(const e of r.emails||[]){add(contacted,e.email,why);add(contacted,C.companyDomain(e.email),why);}}}
 if(c.checkDatabase!==false)for(const d of researchSources(s)){const why='Already in '+d.name;for(const x of d.domains||[])add(known,x,why);for(const e of d.emails||[])add(known,e,why);}
 return {contacted,known};
}
function checkContacts(s,c,r){const {contacted,known}=historyIndex(s,c);let hit=null;
 for(const e of r.emails){const d=C.companyDomain(e.email);e.contacted=contacted.has(e.email)||!!d&&contacted.has(d);e.databaseDuplicate=known.has(e.email);if(!hit&&e.contacted)hit={email:e.email,why:contacted.get(e.email)||contacted.get(d)};}
 // Contacted before (you asked for domain level): one contacted address excludes the whole domain.
 if(hit){r.hardReject={code:'contacted_email',reason:'Contacted before: '+hit.email+' ('+hit.why+')'};return;}
 // Sources without a contacted status keep the original rule: reject only when every email is already in them.
 if(r.emails.length&&r.emails.every(e=>e.databaseDuplicate))r.hardReject={code:'contacted_email',reason:'Every collected email is already in your sources'};}
// Campaigns remember account ids. Re-adding an account gives it a new id, so fall back to matching its address.
async function selectedAccounts(c){if(!c.checkMail)return [];const all=await accounts(),ids=c.mailAccountIds||[],labels=c.mailAccountLabels||[],chosen=[];
 for(let i=0;i<ids.length;i++){let a=all.find(a=>a.id===ids[i]);if(!a&&labels[i])a=all.find(a=>(a.email||a.label).toLowerCase()===labels[i].toLowerCase());if(!a||chosen.includes(a))throw Error('A selected email account is no longer connected. Reconnect it in Email history, then Resume.');chosen.push(a);}
 if(!chosen.length)throw Error('No selected email account is connected. Add it in Email history, then Resume.');c.mailAccountIds=chosen.map(a=>a.id);return chosen;}
function mailReason(hits){const h=hits[0];return 'Contacted before: '+PublisherMail.describe(h);}

/* ---------- Gemini: once per site, rate limited ---------- */
let aiNext=0;
async function aiSlot(){const wait=Math.max(0,aiNext-Date.now());aiNext=Math.max(aiNext,Date.now())+4200;if(wait)await sleep(wait);}
async function aiConfig(s){return {key:(await chrome.storage.local.get('publisherGeminiKey')).publisherGeminiKey||'',model:s.settings.geminiModel||'gemini-3.1-flash-lite'};}
async function aiReview(s,c,r,j){
 if(!c.useGemini||c.aiDisabledReason||r.hardReject||r.aiAttempted||!j.ai?.text)return;
 if(!r.emails.length&&!r.forms?.length)return;
 r.aiAttempted=true;const config=await aiConfig(s);if(!config.key){c.aiDisabledReason='Gemini key is not configured';return;}
 const ev=j.ai;await aiSlot();
 try{const result=await PublisherAI.assess(config,{niche:c.niche,topics:c.relatedTopics?c.subtopics:'',url:ev.url,title:ev.title,heading:ev.heading,description:ev.description,text:ev.text,emails:r.emails.slice(0,8).map(e=>({email:e.email,context:String(e.context||'').slice(0,120),kind:e.kind}))});
  r.aiAssessment={relevant:result.relevant,opportunity:result.opportunity,confidence:result.confidence,evidence:result.evidence,reason:result.reason,url:ev.url};c.aiCalls=(c.aiCalls||0)+1;c.aiRateLimited=0;
  if(result.terms)r.terms={...result.terms,source:ev.url};
  if(result.confidence>=80&&result.evidence){
   if(!result.relevant&&!r.opportunities.some(o=>o.decision==='qualified'))r.hardReject={code:'ai_irrelevant',reason:result.reason||'Website does not match the campaign niche'};
   if(PublisherLanguage.supported.includes(result.language)&&r.languageConfidence<85){r.language=result.language;r.languageConfidence=result.confidence;r.languageSource='Gemini with page evidence';if(PublisherLanguage.mismatch({code:r.language,confidence:r.languageConfidence},c.researchLanguage))r.hardReject={code:'language',reason:'Website language '+r.language+' does not match '+c.researchLanguage};}
   for(const role of result.emailRoles||[]){const e=r.emails.find(x=>x.email===role.email);if(e&&e.suitability!=='excluded'&&['Editorial','Submissions','Advertising','Partnerships','General contact'].includes(role.kind)){e.kind=role.kind;e.suitability=role.kind==='General contact'?'fallback':'recommended';e.reason='Gemini classified this published mailbox from page context';}}}
  M.recompute(r);
 }catch(e){if(/429|quota|rate/i.test(e.message)){c.aiRateLimited=(c.aiRateLimited||0)+1;aiNext=Date.now()+20000;if(c.aiRateLimited>=4){c.aiDisabledReason='Gemini rate limit reached repeatedly';log(c,'Gemini paused for this campaign after repeated rate limits; local scoring continues.');}}else{c.aiDisabledReason=e.message;log(c,'Gemini unavailable; continuing with local scoring. '+e.message);}}
}

/* ---------- Lightweight MX check (public DNS over HTTPS) ---------- */
const mxCache=new Map();
async function mailServer(domain){if(mxCache.has(domain))return mxCache.get(domain);let result='unknown';
 try{const ask=async type=>{const res=await within(fetch('https://dns.google/resolve?name='+encodeURIComponent(domain)+'&type='+type,{credentials:'omit',cache:'no-store'}),5000,'DNS timeout');if(!res.ok)throw Error('DNS '+res.status);return res.json();};
  const mx=await ask('MX');result=mx.Status===3?'none':'ok';}catch{result='unknown';}
 mxCache.set(domain,result);return result;}
async function mxCheck(r){for(const e of R.usableContacts(r)){const d=C.emailDomain(e.email);if(!d||C.freeMail(d))continue;const status=await mailServer(d);e.mx=status;if(status==='none'&&e.override!=='include'){e.suitability='excluded';e.reason='The domain '+d+' does not exist; emails to this address would bounce';}}M.recompute(r);}

/* ---------- Research jobs ---------- */
function createJob(s,c,p){const record=s.leads.find(l=>l.id===p.leadId)||M.blank(id(),p.domain,c.niche);record.campaignId=c.id;record.campaignName=c.name;record.incompleteReason='';return {domain:p.domain,pages:C.uniq([p.url,...(p.extraURLs||[]),record.website]),visited:[],elapsed:0,record:structuredClone(record),tabId:(c.tabPool||[]).pop()||null};}
function completeLead(s,c,j,reason){if(!c.jobs.includes(j))return;const r=j.record,saved=s.leads.find(x=>x.id===r.id);if(saved){for(const k of ['notes','dealStatus','reviewDecision','doNotContact','selectedEmail'])r[k]=saved[k];for(const e of r.emails){const old=saved.emails.find(x=>x.email===e.email);if(old){e.override=old.override;e.suppressed=old.suppressed;}}}if(!r.mailHistory?.length)checkContacts(s,c,r);M.recompute(r);if(r.hardReject?.code==='contacted_email')c.stats.emailDuplicate=(c.stats.emailDuplicate||0)+1;r.collectedAt=now();r.stopReason=reason;r.pagesRead=r.visitedURLs.length;r.history=[{at:now(),decision:r.bucket,reason:r.decisionReason,pages:j.visited.length},...(r.history||[])].slice(0,50);
 const i=s.leads.findIndex(x=>x.id===r.id);if(i>=0)s.leads[i]=r;else s.leads.push(r);queueOutput(s,r.id);if(candidate(c,r))queueAuto(s,r);c.researchedIds=C.uniq([...c.researchedIds,r.id]);c.jobs=c.jobs.filter(x=>x!==j);if(j.tabId)c.tabPool.push(j.tabId);const qualified=M.tally(s,c);
 for(const [query,q] of Object.entries(c.queryStats))q.ready=s.leads.filter(l=>c.researchedIds.includes(l.id)&&l.bucket==='ready'&&l.discoveries.some(d=>d.query===query)).length;
 log(c,`${r.domain}: ${reason}`);if(qualified>=c.target)finish(s,c,`Target reached: ${qualified} relevant websites with suitable contacts.`);}
const candidate=(c,r)=>r.bucket==='ready'||(c.contactGoal==='form'||c.contactGoal==='any'||c.includeForms)&&r.bucket==='form';
const limited=(c,j)=>!j.pages.length||j.visited.length>=c.pageLimit||j.elapsed>=c.budget*1000;
async function finalize(s,c,j){const r=j.record,wasCandidate=j.finalize.candidate;
 if(!r.hardReject){
  if(c.checkMail&&!j.mailDone){let list;try{list=await selectedAccounts(c);}catch(e){return {blocked:e.message,error:e};}const emails=r.emails.map(e=>e.email),domains=C.uniq(emails.map(C.companyDomain).filter(d=>d&&d!==j.domain)),free=emails.filter(e=>!C.companyDomain(e));
   try{const hits=await PublisherMail.check(list,{domains,emails:free});const found=[...domains.flatMap(d=>hits.domains[d]||[]),...free.flatMap(e=>hits.emails[e]||[])];if(found.length){r.mailHistory=found;r.hardReject={code:'mail_history',reason:mailReason(found)};c.stats.mailHistory=(c.stats.mailHistory||0)+1;}j.mailDone=true;}
   catch(e){return {blocked:e.message,error:e};}}
  if(!r.hardReject){await aiReview(s,c,r,j);if(!r.hardReject&&R.usableContacts(r).length)await mxCheck(r);}
 }
 delete j.finalize;
 if(r.hardReject)return {done:r.hardReject.reason};
 if(wasCandidate&&candidate(c,r))return {done:'Publisher offer, topic match and suitable contact found.'};
 if(!limited(c,j))return {};
 return {done:j.elapsed>=c.budget*1000?'Research time limit reached; partial findings saved.':'Relevant page or time limit reached; all findings saved.'};
}
async function jobStep(s,c,j){
 if(j.finalize)return finalize(s,c,j);
 while(j.pages.length&&j.visited.includes(j.pages[0]))j.pages.shift();
 if(limited(c,j)){j.finalize={candidate:candidate(c,j.record)};return finalize(s,c,j);}
 const next=j.pages[0],started=Date.now();j.record.attempted=true;let data;
 try{let tabId;if(j.resumeInPlace&&j.tabId){try{const tab=await chrome.tabs.get(j.tabId);if(C.domain(tab.url)===j.domain)tabId=tab.id;}catch{}}j.resumeInPlace=false;if(!tabId)tabId=await navigate(j,'tabId',next,c);data=await collect(tabId,'scan');}catch(e){data={blocked:'unavailable',error:e.message};}
 j.elapsed+=Date.now()-started;
 // Many challenges (Cloudflare "Just a moment") clear by themselves. Wait and re-read before giving up.
 for(let attempt=0;data.blocked==='verification'&&attempt<3;attempt++){await sleep(3000);try{data=await collect(j.tabId,'scan');}catch(e){data={blocked:'unavailable',error:e.message};}}
 if(data.blocked==='verification'){if(c.onVerification==='pause'){j.parked=true;return {parked:true};}j.pages.shift();j.visited.push(next);j.record.hardReject={code:'verification',reason:'Verification / CAPTCHA could not be completed'};c.stats.verificationSkipped=(c.stats.verificationSkipped||0)+1;return {done:'Verification / CAPTCHA could not be completed; skipped.'};}
 j.pages.shift();j.visited.push(next);
 if(data.blocked){j.record.incompleteReason='Access incomplete: '+(data.error||data.blocked);return {done:'Website unavailable: '+(data.error||'access restricted')};}
 if(C.domain(data.url)!==j.domain){j.record.incompleteReason='Redirected to a different domain; contact attribution needs review';return {done:'Redirected to a different website; review required.'};}
 const r=M.mergePage(j.record,data,c);const home=new URL(data.url).pathname.replace(/\/+$/,'')==='';if(home){const pageGate=R.screen({url:data.url,title:data.pageEvidence?.title},{niche:c.niche,relatedTopics:c.relatedTopics,subtopics:c.subtopics,excludePlatforms:true});if(pageGate.code==='wrong_niche')r.hardReject={code:pageGate.code,reason:pageGate.reason};}
 const language=PublisherLanguage.detect(data.pageEvidence||{});if(language.confidence>=(r.languageConfidence||0)){r.language=language.code;r.languageConfidence=language.confidence;r.languageSource=language.source;}if(PublisherLanguage.mismatch(language,c.researchLanguage)){r.hardReject={code:'language',reason:'Website language '+language.code+' does not meet campaign language '+c.researchLanguage};c.stats.languageRejected++;}
 checkContacts(s,c,r);M.recompute(r);
 const assessment=r.opportunities.find(o=>o.url===data.url),ev=data.pageEvidence;
 if(ev?.mainText){const rank=assessment?.decision==='qualified'?2:1;if(!j.ai||rank>j.ai.rank)j.ai={rank,url:data.url,title:String(ev.title||'').slice(0,240),heading:String(ev.heading||'').slice(0,180),description:String(ev.description||'').slice(0,400),text:ev.mainText.slice(0,6000)};}
 const closed=assessment?.decision==='reject'&&['listicle','closed'].includes(assessment.code)&&!r.opportunities.some(o=>o.decision==='qualified');
 j.pages=C.uniq([...(data.candidates||[]).map(l=>l.url),...j.pages]).filter(u=>C.domain(u)===j.domain&&!j.visited.includes(u)&&!R.platform(u)).slice(0,24);
 if(r.hardReject)return {done:r.hardReject.reason};
 if(closed)return {done:assessment.reason};
 if(candidate(c,r)||limited(c,j)){j.finalize={candidate:candidate(c,r)};return finalize(s,c,j);}
 return {};
}
function slotTarget(s,c){const qualified=M.tally(s,c);return Math.max(1,Math.min(c.parallel||DEFAULT_PARALLEL,MAX_PARALLEL,c.target-qualified));}

/* Sent-mail check for queued domains, before any tab is opened. */
async function mailPrecheck(s,c){const todo=c.pending.filter(p=>!p.mailChecked).slice(0,10);if(!todo.length)return true;let hits;
 try{const list=await selectedAccounts(c);hits=await PublisherMail.check(list,{domains:todo.map(p=>p.domain)});}catch(e){blockConnection(c,'mail_blocked',e);return false;}
 for(const p of todo){const found=hits.domains[p.domain]||[];p.mailChecked=true;if(!found.length)continue;
  c.pending=c.pending.filter(x=>x!==p);c.stats.contacted++;c.stats.mailHistory=(c.stats.mailHistory||0)+1;const reason=mailReason(found);c.skips.unshift({domain:p.domain,query:p.query,url:p.url,title:p.title,reason,at:now()});
  const lead=s.leads.find(l=>l.id===p.leadId);if(lead){lead.mailHistory=found;lead.hardReject={code:'mail_history',reason};lead.bucket='rejected';lead.score=0;lead.decisionReason=reason;lead.collectedAt=now();lead.rejectionScope='universal';queueOutput(s,lead.id);c.researchedIds=C.uniq([...c.researchedIds,lead.id]);}}
 return true;}
const METRIC_KEYS=['da','pa','dr','spam','age','traffic'];
const METRIC_BOUNDS=['daMin','daMax','drMin','drMax','spamMin','spamMax','ageMinMonths','ageMaxMonths','trafficMin','trafficMax'];
function metricSettings(c){return {requireDA:c.requireDA&&!c.manual,...Object.fromEntries(METRIC_BOUNDS.map(k=>[k,c[k]])),missingMetric:c.missingMetric};}
function neededMetrics(c){const k=[];for(const [key,min,max] of [['da','daMin','daMax'],['dr','drMin','drMax'],['spam','spamMin','spamMax'],['age','ageMinMonths','ageMaxMonths'],['traffic','trafficMin','trafficMax']])if(c[min]!=null||c[max]!=null)k.push(key);return k.length?k:['da'];}
function addResults(s,c,results){
 const {contacted,known}=historyIndex(s,c),seen=new Set(c.seen),opened=new Set(c.opened||[]);
 for(const raw of results){const u=C.url(raw.url),d=C.domain(u);if(!d)continue;const query=c.queries[c.queryIndex]||'Manual URLs';const q=c.queryStats[query] ||= {pages:0,links:0,rejected:0,queued:0,ready:0};q.links++;c.stats.links++;
 const existing=s.leads.find(l=>l.domain===d&&l.campaignId===c.id),key=R.pageKey(u),discovery={query,url:u,title:C.clean(raw.title),snippet:C.clean(raw.snippet).slice(0,700),at:now()};
 if(!seen.has(d)){seen.add(d);c.stats.unique++;}else c.stats.repeats++;
 if(existing&&!existing.discoveries.some(x=>x.query===query&&R.pageKey(x.url)===key))existing.discoveries.push(discovery);
 const reason=s.leads.some(l=>l.domain===d&&l.doNotContact)?'Do not contact, saved by you':contacted.has(d)?'Contacted before: '+contacted.get(d):known.has(d)?known.get(d):'';
 if(reason){if(contacted.has(d))c.stats.contacted++;else if(known.has(d))c.stats.database++;else c.stats.existing++;c.skips.unshift({domain:d,query,url:u,title:raw.title,reason,at:now()});
  if(contacted.has(d)&&!existing){const lead=M.blank(id(),d,c.niche);Object.assign(lead,{campaignId:c.id,campaignName:c.name,query,discoveredURL:u,title:raw.title||d,discoveries:[discovery],bucket:'rejected',score:0,decisionReason:reason,hardReject:{code:'contacted',reason},collectedAt:now()});for(const k of METRIC_KEYS)if(Number.isFinite(raw[k]))lead[k]=raw[k];s.leads.push(lead);c.researchedIds=C.uniq([...c.researchedIds,lead.id]);}
  continue;}
 const triage=R.screen({...raw,url:u,manual:c.manual},{...s.settings,niche:c.niche,subtopics:c.subtopics,relatedTopics:c.relatedTopics,tlds:c.tlds,...metricSettings(c)});discovery.screen=triage;
 let lead=existing;if(!lead){lead=M.blank(id(),d,c.niche);lead.campaignId=c.id;lead.campaignName=c.name;lead.query=query;lead.discoveredURL=u;lead.title=raw.title||d;lead.discoveries=[discovery];s.leads.push(lead);}lead.lastSeenAt=now();lead.screenReason=triage.reason;lead.screenCode=triage.code;lead.lastScreen=triage.decision;queueOutput(s,lead.id);
 for(const k of METRIC_KEYS)if(Number.isFinite(raw[k]))lead[k]=raw[k];if(Number.isInteger(raw.da)){lead.pa=Number.isInteger(raw.pa)?raw.pa:null;lead.daSource=raw.daSource||'Visible Google result metric';}if(raw.metricSource)lead.metricSource=raw.metricSource;
 if(triage.decision==='reject'){q.rejected++;if(['da_missing','da_range','metric_range','metric_missing'].includes(triage.code))c.stats.daRejected++;if(triage.code==='tld')c.stats.tldRejected++;if(triage.code==='wrong_niche')c.stats.wrongNiche++;if(['platform','domain'].includes(triage.code))c.stats.excluded++;else if(!['da_missing','da_range','metric_range','metric_missing','tld'].includes(triage.code))c.stats.titleRejected++;if(!lead.visitedURLs.length&&!lead.opportunities.length){lead.bucket='rejected';lead.decisionReason=triage.reason;lead.score=0;lead.rejectionScope=['platform','domain'].includes(triage.code)?'universal':'campaign';lead.hardReject={code:triage.code,reason:triage.reason};}c.skips.unshift({domain:d,query,url:u,title:raw.title,reason:triage.reason,at:now()});continue;}
 if(triage.decision==='review')c.stats.screenReview++;delete lead.hardReject;
 if(lead.id!==c.recheckId&&(lead.reviewDecision==='reject'||['ready','form'].includes(lead.bucket)||lead.visitedURLs.includes(key))){c.stats.existing++;continue;}
 // Strict rule: a domain is opened at most once per campaign, whichever keyword or Google page finds it again.
 if(opened.has(d)&&!c.pending.some(p=>p.domain===d)&&!c.jobs.some(j=>j.domain===d)){c.stats.repeats++;continue;}
 let pending=c.pending.find(j=>j.domain===d)||c.jobs.find(j=>j.domain===d);if(pending){if(pending.extraURLs)pending.extraURLs=C.uniq([...pending.extraURLs,u]);else if(pending.pages&&!pending.visited.includes(u))pending.pages=C.uniq([...pending.pages,u]);continue;}
 const upgrades=c.attempts[d]||0;if(upgrades>=2){c.stats.existing++;continue;}
 c.attempts[d]=upgrades+1;q.queued++;opened.add(d);c.pending.push({url:u,domain:d,title:raw.title,query,leadId:lead.id,extraURLs:[]});
 }
 c.seen=[...seen];c.opened=[...opened];c.skips=c.skips.slice(0,1000);
}
async function searchStep(s,c){
 const gap=3500-(Date.now()-(c.lastSearchAt||0));if(!c.serpSnapshot&&gap>0)await sleep(gap);
 const query=c.queries[c.queryIndex];if(!c.searchURL)c.searchURL='https://www.google.com/search?q='+encodeURIComponent(query);
 c.lastSearchAt=Date.now();
 let data;try{if(c.serpSnapshot)data=c.serpSnapshot;else{if(!c.searchLoaded){await navigate(c,'searchTabId',c.searchURL);c.searchLoaded=true;}data=await collect(c.searchTabId,'search');}}catch(e){c.status='paused';log(c,'Search page could not be read: '+e.message+' Resume to retry.');c.searchLoaded=false;return;}
 if(data.blocked){c.status=data.blocked==='verification'?'verification':'paused';c.verificationKind='search';log(c,'Google needs attention. Open the search tab, complete any verification, then Resume.');return;}
 if(data.empty){c.status='paused';log(c,'No organic results could be read. Review the search tab for consent, an empty result page, or a layout change. Resume retries; Skip moves to the next query.');return;}
 // SEO extensions fill their badges in after the page loads. Re-read until the count stops growing.
 if(!c.serpSnapshot&&!c.daBypass){let seen=PublisherDA.metricCount(data.results),stable=0;const polls=c.requireDA?8:3;for(let attempt=0;attempt<polls&&seen<data.results.length&&stable<2;attempt++){await sleep(1500);try{const later=await collect(c.searchTabId,'search');if(later.results?.length){const n=PublisherDA.metricCount(later.results);if(n>seen){data=later;seen=n;stable=0;}else stable++;}}catch{break;}}}
 if(c.requireDA){const need=neededMetrics(c),check=PublisherDA.preflight(data.results,need);
  if(!check.ok&&!c.stats.searchPages&&!c.daBypass){c.status='da_blocked';c.serpSnapshot=data;log(c,'No SEO metrics are visible on Google. Continue without metric filters (you can recheck metrics later) or stop. Your place is saved.');return;}
  if(!check.ok)log(c,'No metrics visible on this Google page; results are kept with unknown metrics.');
  if(check.ok&&check.missing?.length&&!c.metricWarning){c.metricWarning='Not visible on Google: '+check.missing.map(k=>PublisherDA.LABELS[k]).join(', ');log(c,c.metricWarning+'. Results without a value are kept as unknown.');}}
 log(c,`Searched query ${c.queryIndex+1}/${c.queries.length}, page ${c.pageNumber}: ${query}`);
 addResults(s,c,data.results);delete c.serpSnapshot;c.stats.searchPages++;c.queryStats[query] ||= {pages:0,links:0};c.queryStats[query].pages++;
 if(data.nextURL&&c.pageNumber<c.maxPages&&!c.visitedSearch.includes(data.nextURL)){c.visitedSearch.push(c.searchURL);c.searchURL=data.nextURL;c.pageNumber++;}else {c.queryIndex++;c.pageNumber=1;c.searchURL='';c.visitedSearch=[];}c.searchLoaded=false;
}
async function tick(){const s=await read(),c=active(s);if(!c||c.status!=='running')return;try{
 if(c.phase==='sync'){
  const sources=researchSources(s);if(c.checkDatabase===false&&c.checkContacted===false)c.syncIndex=sources.length;const db=sources[c.syncIndex];
  if(db){if((db.kind==='sheet'||db.kind==='output')&&(db.status!=='ready'||!db.lastSyncedAt||Date.now()-Date.parse(db.lastSyncedAt)>15*60000)){log(c,'Checking database: '+db.name);await save(s);
   try{await syncOne(db);}catch(e){e.message=db.name+': '+e.message;blockConnection(c,'database_blocked',e);await save(s);return;}}c.syncIndex++;await save(s);wake(100);return;}
  c.phase=c.manual?'research':'search';log(c,'All databases checked. Starting discovery.');
  if(c.manual&&c.manualURLs?.length){addResults(s,c,c.manualURLs.map(u=>({url:u,domain:C.domain(u),title:C.domain(u)})));c.manualURLs=[];}
 }
 if(c.checkMail&&c.pending.some(p=>!p.mailChecked)){if(!await mailPrecheck(s,c)){await save(s);return;}}
 const want=slotTarget(s,c);
 while(c.jobs.length<want){const p=c.pending.find(x=>!c.checkMail||x.mailChecked);if(!p)break;c.pending=c.pending.filter(x=>x!==p);c.jobs.push(createJob(s,c,p));}
 const running=c.jobs.filter(j=>!j.parked),moreSearch=!c.manual&&c.queryIndex<c.queries.length;
 // One Google page at a time: the next search waits until every website from the current page is finished.
 const searchNow=moreSearch&&!c.pending.length&&!running.length&&!c.jobs.length;
 if(!running.length&&!searchNow){
  if(c.jobs.length){c.status='verification';c.verificationKind='research';log(c,c.jobs.map(j=>j.domain).join(', ')+' needs a verification check. Open the tab, complete it, then Resume, or Skip.');await save(s);return;}
  if(!moreSearch&&!c.pending.length){finish(s,c,c.manual?'All supplied websites checked.':'All queries completed.');await save(s);return;}
  await save(s);wake(Math.max(300,3500-(Date.now()-(c.lastSearchAt||0))));return;
 }
 c.phase=running.length?'research':'search';
 await save(s);
 const outcomes=await Promise.all([...running.map(j=>jobStep(s,c,j).catch(e=>({done:'Research error: '+e.message}))),searchNow?searchStep(s,c).then(()=>null):null]);
 running.forEach((j,i)=>{const o=outcomes[i]||{};if(c.status==='complete'&&!c.jobs.includes(j))return;
  if(o.done)completeLead(s,c,j,o.done);else if(o.blocked&&c.status!=='complete'){blockConnection(c,'mail_blocked',o.error||new Error(o.blocked));}
  else if(o.parked)log(c,j.domain+' needs a verification check. Other websites continue.');});
 await save(s);if(c.status==='running')wake(running.length?400:c.phase==='search'?3500:1000);
 }catch(e){c.status='paused';log(c,'Saved your progress. '+e.message);await save(s);}}

/* ---------- Metrics recheck: open websites in batches and read the SEO toolbar ---------- */
let metricTimer;
const wakeMetrics=(ms=300)=>{clearTimeout(metricTimer);metricTimer=setTimeout(()=>serial(metricTick,'metricTick').catch(console.error),ms);};
async function readSiteMetrics(target,url){const tabId=await navigate(target,'tabId',url);let found=null,diag=null,stable=0;
 // Keep reading until the toolbar stops adding values, so DR/Spam/Age that load a moment later are not missed.
 for(let i=0;i<13&&stable<2;i++){await sleep(1200);try{const r=await collect(tabId,'siteMetrics');if(r.blocked)break;const m=r.metrics;
  if(m&&METRIC_KEYS.some(k=>Number.isFinite(m[k]))){const merged={...found,...m},more=!found||METRIC_KEYS.some(k=>Number.isFinite(m[k])&&m[k]!==found[k]);if(more){found=merged;stable=0;}else stable++;}else diag=r.diag||diag;}catch{}}
 target.diag=diag;return found;}
// Second source: Google "site:domain" with the SEO extension's result badges.
async function serpMetrics(run,domain){const gap=4000-(Date.now()-(run.lastSearchAt||0));if(gap>0)await sleep(gap);run.lastSearchAt=Date.now();
 const holder={tabId:run.searchTabId||null};await navigate(holder,'tabId','https://www.google.com/search?q='+encodeURIComponent('site:'+domain));run.searchTabId=holder.tabId;
 let best=null,stable=0;for(let i=0;i<8&&stable<2;i++){await sleep(1300);let data;try{data=await collect(holder.tabId,'search');}catch{continue;}if(data.blocked){run.serpBlocked=true;return null;}
  const hit=(data.results||[]).find(r=>C.domain(r.url)===domain&&(r.da!=null||r.dr!=null));if(hit){const m=Object.fromEntries(METRIC_KEYS.filter(k=>Number.isFinite(hit[k])).map(k=>[k,hit[k]]));if(!best||METRIC_KEYS.some(k=>Number.isFinite(m[k])&&m[k]!==best[k])){best={...best,...m};stable=0;}else stable++;}else if(best)stable++;}
 return best;}
async function metricTick(){const s=await read(),run=s.metricRun;if(!run||!['running','scheduled'].includes(run.status))return;if(active(s)?.status==='running'){wakeMetrics(10000);return;}run.status='running';
 const batch=run.queue.slice(0,Math.min(run.parallel,2));run.inFlight=batch;run.batchCounts={done:run.done,updated:run.updated,missing:run.missing};
 if(!batch.length){run.status='complete';run.finishedAt=now();await closeTabs([...run.tabs,run.searchTabId].filter(Boolean));run.tabs=[];run.searchTabId=null;await save(s);if(s.output.pendingIds.length)syncOutput(true).catch(()=>{});return;}
 await save(s);
 const slots=batch.map((leadId,i)=>({leadId,tabId:run.tabs[i]||null}));
 const results=await Promise.all(slots.map(async slot=>{const lead=s.leads.find(r=>r.id===slot.leadId);if(!lead)return null;try{return await readSiteMetrics(slot,'https://'+lead.domain+'/');}catch{return null;}}));
 run.tabs=C.uniq([...run.tabs,...slots.map(x=>x.tabId)]).slice(0,MAX_PARALLEL);
 slots.forEach((slot,i)=>{const lead=s.leads.find(r=>r.id===slot.leadId);if(!lead)return;const m=results[i];lead.metricsCheckedAt=now();
  if(m){for(const k of METRIC_KEYS)if(Number.isFinite(m[k]))lead[k]=m[k];lead.metricSource='Website toolbar (SEO extension)';lead.metricsStatus='found';run.updated++;queueOutput(s,lead.id);}else{lead.metricsStatus='missing';run.missing++;const d=slot.diag;if(d){run.diag ||= {frames:0,sealed:0,none:0};if(d.frames)run.diag.frames++;else if(d.sealed&&!d.marker)run.diag.sealed++;else if(!d.marker)run.diag.none++;}}run.done++;});
 if(run.diag&&!run.updated&&!run.note&&run.done>=Math.min(run.total,5)){const d=run.diag;run.note=(d.frames?'The SEO toolbar is drawn inside its own extension frame on these sites. Chrome does not let one extension read another extension\'s frame, so the toolbar values cannot be read here; Google-result badges still work.':d.sealed?'The SEO toolbar seems to use a sealed container on these sites, which other extensions cannot read.':'No SEO toolbar was found on these sites. Make sure the SEO extension shows its bar when a website opens.')+' Google search was tried as a fallback.';}
 // Anything the toolbar did not give is tried once on Google, one search at a time.
 for(const slot of slots){const lead=s.leads.find(r=>r.id===slot.leadId);if(!lead||['da','dr','spam','age','traffic'].every(k=>Number.isFinite(lead[k]))||run.serpBlocked||run.status!=='running')continue;let m=null;try{m=await serpMetrics(run,lead.domain);}catch{}
  if(m&&Object.keys(m).length){for(const k of METRIC_KEYS)if(Number.isFinite(m[k]))lead[k]=m[k];lead.metricSource='Website / Google result (SEO extension)';if(lead.metricsStatus!=='found'){run.updated++;run.missing=Math.max(0,run.missing-1);}lead.metricsStatus='found';queueOutput(s,lead.id);}}
 if(run.serpBlocked&&!run.note)run.note='Google asked for verification during the fallback search. Open a Google tab, complete it, and recheck the remaining sites.';
 for(const slot of slots){const lead=s.leads.find(r=>r.id===slot.leadId);if(lead)lead.metricsMissing=['da','dr','spam','age','traffic'].filter(k=>!Number.isFinite(lead[k]));}run.queue=run.queue.filter(id=>!batch.includes(id));run.inFlight=[];delete run.batchCounts;
 await save(s);wakeMetrics(200);}
function editable(s){const c=active(s);if(c&&['running','verification','database_blocked','da_blocked','mail_blocked','paused'].includes(c.status))throw Error('Finish or stop the active campaign before changing databases.');}
async function command(m){const s=await read(),c=m.campaignId?s.campaigns.find(x=>x.id===m.campaignId):active(s);switch(m.type){
 case 'PUB_GET':return {...publicState(s),engine:ENGINE,hasKey:!!(await chrome.storage.local.get('publisherGeminiKey')).publisherGeminiKey,mailAccounts:(await accounts()).map(({endpoint,secret,...a})=>({...a,endpointHint:'…'+endpoint.slice(-10),hasSecret:!!secret}))};
 case 'PUB_ADD_DB':{editable(s);const links=C.uniq(String(m.links||'').split(/\s+/).filter(Boolean));if(!links.length||links.length>15)throw Error('Add between 1 and 15 Sheets links at a time.');const parsed=links.map(C.sheetLink);for(const p of parsed)if(!s.databases.some(d=>d.sheetId===p.sheetId))s.databases.push({id:id(),kind:'sheet',...p,name:'Google Sheet '+p.sheetId.slice(0,8),status:'new',domains:[],tabs:[]});await save(s);refreshSources().catch(console.error);return true;}
 case 'PUB_SYNC_DB':{const db=s.databases.find(d=>d.id===m.id);if(!db||db.kind!=='sheet')throw Error('Sheet not found.');try{await syncOne(db);}finally{await save(s);}return true;}
 case 'PUB_RENAME_DB':{editable(s);const db=s.databases.find(d=>d.id===m.id);if(db){db.name=C.clean(m.name).slice(0,100)||db.name;db.customName=true;}await save(s);return true;}
 case 'PUB_DELETE_DB':editable(s);s.databases=s.databases.filter(d=>d.id!==m.id);await save(s);return true;
 case 'PUB_IMPORT_DB':{editable(s);if(!Array.isArray(m.domains)||m.domains.length>500000)throw Error('Invalid database size.');const domains=C.uniq(m.domains.map(C.domain));s.databases.push({id:id(),kind:'file',name:C.clean(m.name).slice(0,120),status:'ready',domains,emails:C.uniq((m.emails||[]).flatMap(v=>C.emails(v))),contactedDomains:C.uniq((m.contactedDomains||[]).map(C.domain)),contactedEmails:C.uniq((m.contactedEmails||[]).flatMap(v=>C.emails(v))),tabs:m.tabs||[],lastSyncedAt:now()});await save(s);return domains.length;}
 case 'PUB_OUTPUT_SETTINGS':{const old=(await chrome.storage.local.get('publisherOutputConfig')).publisherOutputConfig||{},endpoint=PublisherMail.endpoint(m.endpoint),config=PublisherOutput.validateConfig({endpoint,secret:typeof m.secret==='string'&&m.secret.trim()?m.secret:(old.endpoint===endpoint?old.secret:'')});if(old.endpoint&&old.endpoint!==config.endpoint&&s.output.pendingIds.length)throw Error('Deliver or explicitly discard pending exports before changing destination.');
  if(old.endpoint!==config.endpoint){for(const r of s.leads)delete r.sheetSentAt;s.output.revision=(s.output.revision||0)+1;s.databases=s.databases.filter(d=>d.kind!=='output');s.output.useAsHistory=false;}
  await chrome.storage.local.set({publisherOutputConfig:config});s.output.endpoint=config.endpoint;s.output.status='Checking';s.output.error='';await save(s);
  let info=null;try{info=await reachable(config,'Output Sheet');if(!info.sheet)throw Error('This script is not inside a Sheet. Open your output Sheet, choose Extensions > Apps Script, paste the code there and deploy it.');PublisherConnections.healthy(s.output);s.output.status='Connected';s.output.account=info.account;}catch(e){PublisherConnections.failed(s.output,e);s.output.status=s.output.health==='retrying'?'Retrying':'Needs attention';}
  await save(s);return {status:s.output.status+(s.output.error?': '+s.output.error:'')};}
 case 'PUB_OUTPUT_SYNC':{const result=await syncOutput(true);return {status:result.status+(result.error?': '+result.error:'')+', '+result.pending+' waiting'};}
 case 'PUB_TOPICS':return PublisherTopics.suggest(m.niche);
 case 'PUB_AI_TEST':{const config=await aiConfig(s);if(m.key)config.key=String(m.key).trim();if(m.model)config.model=C.clean(m.model);if(!config.key)throw Error('Save a Gemini API key first.');return PublisherAI.test(config);}
 case 'PUB_OUTPUT_HISTORY':{if(m.enabled&&!s.output.endpoint)throw Error('Connect an export destination first.');s.output.useAsHistory=!!m.enabled;if(m.enabled){let db=s.databases.find(d=>d.kind==='output');if(!db){db={id:'output-sheet',kind:'output',name:'Destination contact history',status:'new',domains:[],emails:[],tabs:[]};s.databases.push(db);}try{await syncOne(db);}finally{await save(s);}}else await save(s);return true;}
 case 'PUB_OUTPUT_DISCARD':s.output.pendingIds=[];s.output.revision=(s.output.revision||0)+1;await save(s);return true;
 case 'PUB_OUTPUT_DISCONNECT':if(s.output.pendingIds.length)throw Error('Deliver or discard pending exports before disconnecting.');await chrome.storage.local.remove('publisherOutputConfig');s.databases=s.databases.filter(d=>d.kind!=='output');s.output={endpoint:'',status:'Not connected',pendingIds:[],revision:(s.output.revision||0)+1};for(const r of s.leads)delete r.sheetSentAt;await save(s);return true;
 case 'PUB_DA_CONTINUE':if(!c||c.status!=='da_blocked')throw Error('This campaign is not waiting for a Moz choice.');c.requireDA=false;c.daBypass=true;c.daBypassedAt=now();c.status='running';s.activeId=c.id;log(c,'Continuing without metric filters. The requested criteria stay in the campaign report.');await save(s);wake(100);return true;
 case 'PUB_DA_TEST':{const query=C.clean(m.query).slice(0,280);if(!query)throw Error('Enter a niche or query to test MozBar.');const tab=await chrome.tabs.create({url:'https://www.google.com/search?q='+encodeURIComponent(query),active:true});let result={ok:false,reason:'SEO metrics were not visible on this Google page.'};try{for(let attempt=0;attempt<3;attempt++){await sleep(2200);try{const data=await collect(tab.id,'search');if(data.blocked){result={ok:false,reason:'Google needs attention: '+data.blocked};break;}result=PublisherDA.preflight(data.results||[],Array.isArray(m.metrics)&&m.metrics.length?m.metrics:['da']);if(result.ok)break;}catch(e){result={ok:false,reason:e.message};}}}finally{if(result.ok)try{await chrome.tabs.remove(tab.id);}catch{}}return result;}

 case 'PUB_QUERIES':{const chosen=String(m.subtopics||'').split(/[\n,]/).map(x=>x.trim()).filter(Boolean),base=PublisherTopics.queries(m.niche,!!m.relatedTopics,chosen);if(!m.ai||!m.relatedTopics)return {queries:base,source:'Curated templates'};try{const config=await aiConfig(s);if(!config.key)throw Error('No Gemini key saved');const result=await PublisherAI.topics(config,m.niche);const terms=C.uniq([...chosen,...result.topics]).slice(0,7);return {queries:PublisherTopics.queries(m.niche,true,terms),topics:terms,source:'Gemini topic suggestions'};}catch(e){return {queries:base,source:'Curated templates — '+e.message};}}
 case 'PUB_START':{const num=v=>v===undefined||v===null||String(v).trim()===''?null:Number(v);if(['running','verification','da_blocked','mail_blocked'].includes(active(s)?.status))throw Error('Pause or stop the active campaign first.');const qs=C.uniq(String(m.queries||'').split('\n').map(C.clean).filter(q=>q.length&&q.length<300)).slice(0,60);const urls=C.uniq(String(m.urls||'').split(/\s+/).map(x=>C.url(x)).filter(u=>C.domain(u))).slice(0,1000);if(!C.clean(m.niche)||(!qs.length&&!urls.length))throw Error('Enter a niche and search queries or website URLs.');const sender=s.senderProfiles.find(p=>p.id===m.senderId),n={id:id(),name:C.clean(m.campaignName).slice(0,100)||C.clean(m.niche).slice(0,80)+' Outreach',senderId:sender?.id||'',sender:sender?structuredClone(sender):structuredClone(s.settings.sender||{}),researchLanguage:PublisherLanguage.supported.includes(m.researchLanguage)?m.researchLanguage:'any',checkDatabase:m.checkDatabase!==false,checkContacted:m.checkContacted!==false,useGemini:!!m.useGemini,requestedDA:!!m.requireDA,aiCalls:0,recheckId:m.recheckId||null,subtopics:C.clean(m.subtopics).slice(0,500),relatedTopics:!!m.relatedTopics,tlds:(Array.isArray(m.tlds)?m.tlds:[]).map(x=>String(x).toLowerCase().replace(/^\.+/,'')).filter(x=>/^[a-z]{2,20}(?:\.[a-z]{2,20})?$/.test(x)).slice(0,20),requireDA:false,daMin:num(m.daMin),daMax:num(m.daMax),drMin:num(m.drMin),drMax:num(m.drMax),spamMin:num(m.spamMin),spamMax:num(m.spamMax),ageMinMonths:num(m.ageMinYears)==null?null:Math.round(num(m.ageMinYears)*12),ageMaxMonths:num(m.ageMaxYears)==null?null:Math.round(num(m.ageMaxYears)*12),trafficMin:num(m.trafficMin),trafficMax:num(m.trafficMax),missingMetric:m.missingMetric==='skip'?'skip':'keep',onVerification:m.onVerification==='pause'?'pause':'skip',parallel:Math.min(MAX_PARALLEL,Math.max(1,Number(m.parallel)||s.settings.parallel||DEFAULT_PARALLEL)),mailAccountIds:[],checkMail:false,jobs:[],tabPool:[],opened:[],mailAccountLabels:[],contactGoal:['email','form','any'].includes(m.contactGoal)?m.contactGoal:'email',researchedIds:[],attempts:{},niche:C.clean(m.niche).slice(0,90),queries:urls.length?['Manual URLs']:qs,manual:!!urls.length,target:Math.min(5000,Math.max(1,Number(m.target)||50)),includeForms:!!m.includeForms,maxPages:Math.min(20,Math.max(1,Number(m.maxPages)||20)),budget:Math.min(180,Math.max(30,Number(m.budget)||75)),pageLimit:Math.min(10,Math.max(2,Number(m.pageLimit)||6)),status:'running',phase:'sync',syncIndex:0,queryIndex:0,pageNumber:1,searchURL:'',searchLoaded:false,visitedSearch:[],seen:[],pending:[],queryStats:{},skips:[],events:[],createdAt:now(),stats:M.stats()};
 const anyMetric=METRIC_BOUNDS.some(k=>n[k]!=null);n.requireDA=(!!m.requireDA||anyMetric)&&!urls.length;n.requestedDA=n.requireDA;
 for(const k of METRIC_BOUNDS)if(n[k]!=null&&(!Number.isFinite(n[k])||n[k]<0))throw Error('Metric bounds must be finite, non-negative numbers.');for(const [min,max,label] of [['daMin','daMax','DA'],['drMin','drMax','DR'],['spamMin','spamMax','Spam'],['ageMinMonths','ageMaxMonths','Age'],['trafficMin','trafficMax','Traffic']])if(n[min]!=null&&n[max]!=null&&n[min]>n[max])throw Error('Minimum '+label+' must be lower than maximum '+label+'.');for(const k of ['daMin','daMax','drMin','drMax','spamMin','spamMax'])if(n[k]!=null&&(n[k]<0||n[k]>100))throw Error('DA, DR and Spam Score must be between 0 and 100.');if(n.daMin!=null&&n.daMax!=null&&n.daMin>n.daMax)throw Error('Minimum DA must be lower than maximum DA.');if((m.requireDA||anyMetric)&&urls.length)throw Error('Metric filters work on Google results. Remove the website list or clear the metric filters.');
 if(s.settings.mailHistory){const all=await accounts(),chosen=Array.isArray(m.mailAccountIds)?m.mailAccountIds.filter(x=>all.some(a=>a.id===x)):all.map(a=>a.id);n.mailAccountIds=chosen;n.mailAccountLabels=chosen.map(id=>all.find(a=>a.id===id)).map(a=>a.email||a.label);n.checkMail=chosen.length>0;}
 n.manualURLs=urls;s.campaigns.unshift(n);s.activeId=n.id;log(n,'Checking every database before discovery.');await save(s);await chrome.alarms.create(ALARM,{periodInMinutes:0.5});wake(100);return n.id;}
 case 'PUB_PAUSE':if(c&&c.status==='running'){c.status='paused';log(c,'Paused by you.');await save(s);}return true;
 case 'PUB_RESUME':if(c&&c.status!=='complete'){const previous=active(s);if(previous&&previous.id!==c.id&&previous.status==='running'){previous.status='paused';log(previous,'Paused while another campaign runs.');}s.activeId=c.id;for(const j of c.jobs||[])if(j.parked){j.parked=false;j.resumeInPlace=true;}if(c.status==='database_blocked'){c.phase='sync';c.syncIndex=0;}c.status='running';log(c,'Continuing from saved progress.');await save(s);await chrome.alarms.create(ALARM,{periodInMinutes:0.5});wake(100);}return true;
 case 'PUB_STOP':if(c){for(const j of c.jobs||[])flushJob(s,c,j);closeTabs(c.tabPool);c.tabPool=[];c.status='stopped';c.stoppedAt=now();log(c,'Stopped. Resume this campaign to continue from the saved page and queue.');await save(s);}return true;
 case 'PUB_SKIP':if(c){const chosen=m.domain?c.jobs.filter(j=>j.domain===m.domain):c.jobs.some(j=>j.parked)?c.jobs.filter(j=>j.parked):c.jobs.slice(0,1);if(chosen.length){for(const j of chosen)completeLead(s,c,j,'Skipped by you.');}else if(c.phase==='sync')throw Error('Database checks cannot be skipped. Stop the campaign to change its databases.');else {delete c.serpSnapshot;c.queryIndex++;c.pageNumber=1;c.searchURL='';c.searchLoaded=false;}if(c.status!=='complete')c.status='running';await save(s);wake(100);}return true;
 case 'PUB_OPEN_TAB':{const job=c?.jobs?.find(j=>j.domain===m.domain)||c?.jobs?.find(j=>j.parked)||c?.jobs?.[0],tabId=m.kind==='search'?c?.searchTabId:job?.tabId;if(tabId){await chrome.tabs.update(tabId,{active:true});return true;}throw Error('No research tab is open yet.');}
 case 'PUB_SETTINGS':{if(m.autoMetrics!==undefined)s.settings.autoMetrics=!!m.autoMetrics;const blocklist=C.uniq(String(m.blocklist||'').split(/[\s,]+/).map(C.domain));s.settings.blocklist=blocklist;s.settings.excludePlatforms=m.excludePlatforms!==false;s.settings.researchUnclear=!!m.researchUnclear;s.settings.aiQueries=!!m.aiQueries;if(m.parallel!==undefined)s.settings.parallel=Math.min(MAX_PARALLEL,Math.max(1,Number(m.parallel)||DEFAULT_PARALLEL));if(m.mailHistory!==undefined)s.settings.mailHistory=!!m.mailHistory;s.settings.geminiModel=/^gemini-[a-z0-9.-]+$/.test(m.geminiModel||'')?m.geminiModel:s.settings.geminiModel||'gemini-3.1-flash-lite';s.settings.sender=Object.fromEntries(['name','email','company','website','subject','message'].map(k=>[k,String(m.sender?.[k]||'').slice(0,k==='message'?6000:300)]));await save(s);if(typeof m.apiKey==='string'&&m.apiKey.trim())await chrome.storage.local.set({publisherGeminiKey:m.apiKey.trim()});if(m.clearKey)await chrome.storage.local.remove('publisherGeminiKey');return true;}
 case 'PUB_SENDER_SAVE':{const email=C.emails(m.sender?.email||'')[0];if(!email)throw Error('Enter a valid sender email.');const sender={id:m.id||id(),label:C.clean(m.sender?.label).slice(0,100)||email,...Object.fromEntries(['name','company','website','subject','message'].map(k=>[k,String(m.sender?.[k]||'').slice(0,k==='message'?6000:300)])),email};const i=s.senderProfiles.findIndex(x=>x.id===sender.id);if(i<0)s.senderProfiles.push(sender);else s.senderProfiles[i]=sender;await save(s);return true;}
 case 'PUB_SENDER_DELETE':s.senderProfiles=s.senderProfiles.filter(p=>p.id!==m.id);await save(s);return true;
 case 'PUB_UPDATE_LEAD':{const r=s.leads.find(r=>r.id===m.id);if(!r)throw Error('Prospect not found.');if(typeof m.notes==='string')r.notes=m.notes.slice(0,5000);r.dealStatus=['New','Contacted','Follow-up','Responded','Negotiating','Agreed','Not a fit'].includes(m.dealStatus)?m.dealStatus:r.dealStatus;if(['auto','approve','reject'].includes(m.reviewDecision))r.reviewDecision=m.reviewDecision;if(typeof m.doNotContact==='boolean')r.doNotContact=m.doNotContact;if(typeof m.selectedEmail==='string')r.selectedEmail=m.selectedEmail;M.recompute(r);queueOutput(s,r.id);const owner=s.campaigns.find(x=>x.id===r.campaignId);if(owner)M.tally(s,owner);await save(s);return true;}
 case 'PUB_PREFILL':{const r=s.leads.find(r=>r.id===m.id);if(r?.doNotContact)throw Error('This publisher is marked do not contact.');if(!r?.forms?.length)throw Error('No supported contact form recorded.');const sender=s.campaigns.find(c=>c.id===r.campaignId)?.sender||s.settings.sender;if(!sender.email||!sender.message)throw Error('Save a sender email and message, then select that profile in the campaign.');const temp={};const tabId=await navigate(temp,'tab',r.forms[0]);await chrome.tabs.update(tabId,{active:true});const result=await collect(tabId,'prefill',sender);r.formPreparedAt=now();await save(s);return result;}
 case 'PUB_RESTORE':{editable(s);const b=m.backup;if(![1,2,3].includes(b?.version)||!Array.isArray(b.leads)||!Array.isArray(b.databases))throw Error('Choose an Outreach Desk JSON backup.');if(b.leads.length>50000||b.databases.length>100)throw Error('Backup exceeds the import limit.');let added=0;const existing=new Set(s.leads.map(r=>r.campaignId+'|'+r.domain));for(const raw of b.leads){const r=M.restoreLead(raw,b.version,id());if(!r||existing.has(r.campaignId+'|'+r.domain))continue;s.leads.push(r);existing.add(r.campaignId+'|'+r.domain);queueOutput(s,r.id);added++;}for(const cid of [...new Set(s.leads.map(r=>r.campaignId))]){if(s.campaigns.some(c=>c.id===cid))continue;const raw=(b.campaigns||[]).find(c=>c.id===cid)||{},rows=s.leads.filter(r=>r.campaignId===cid),report={id:cid,name:C.clean(raw.name||raw.niche||'Imported research').slice(0,100),niche:C.clean(raw.niche||rows[0]?.niche||'Mixed').slice(0,90),status:'complete',message:'Restored campaign report. Start a new campaign for new research.',queries:Array.isArray(raw.queries)?raw.queries.filter(v=>typeof v==='string').slice(0,60):[],queryStats:{},stats:M.stats(),researchedIds:rows.map(r=>r.id),events:[],skips:[],createdAt:raw.createdAt||now(),requireDA:!!raw.requireDA,requestedDA:!!(raw.requestedDA??raw.requireDA),daBypass:!!raw.daBypass,daMin:Number(raw.daMin)||0,daMax:Number(raw.daMax)||100,tlds:Array.isArray(raw.tlds)?raw.tlds.slice(0,20):[],researchLanguage:PublisherLanguage.supported.includes(raw.researchLanguage)?raw.researchLanguage:'any',checkDatabase:raw.checkDatabase!==false,checkContacted:raw.checkContacted!==false,subtopics:C.clean(raw.subtopics).slice(0,500),relatedTopics:!!raw.relatedTopics};M.tally(s,report);s.campaigns.push(report);}let dbAdded=0;for(const raw of b.databases){if(raw.kind==='sheet'){let p;try{p=C.sheetLink(raw.url);}catch{continue;}if(s.databases.some(d=>d.sheetId===p.sheetId))continue;s.databases.push({id:id(),kind:'sheet',...p,name:C.clean(raw.name).slice(0,100)||'Restored Sheet',status:'new',domains:[],emails:[],contactedDomains:[],contactedEmails:[],tabs:[]});dbAdded++;}else if(raw.kind==='file'&&Array.isArray(raw.domains)&&raw.domains.length<=500000){s.databases.push({id:id(),kind:'file',name:C.clean(raw.name).slice(0,100)||'Restored file',status:'ready',domains:C.uniq(raw.domains.map(C.domain)),emails:C.uniq((raw.emails||[]).flatMap(C.emails)),contactedDomains:C.uniq((raw.contactedDomains||[]).map(C.domain)),contactedEmails:C.uniq((raw.contactedEmails||[]).flatMap(C.emails)),tabs:[],lastSyncedAt:now()});dbAdded++;}}await save(s);return {added,databases:dbAdded};}
 case 'PUB_EMAIL_OVERRIDE':{const r=s.leads.find(x=>x.id===m.id),e=r?.emails.find(x=>x.email===m.email);if(!e)throw Error('Contact not found.');if(!['auto','include','exclude'].includes(m.value))throw Error('Invalid contact choice.');e.override=m.value;M.recompute(r);queueOutput(s,r.id);const owner=s.campaigns.find(x=>x.id===r.campaignId);if(owner)M.tally(s,owner);await save(s);return true;}
 case 'PUB_RECHECK':{editable(s);const r=s.leads.find(x=>x.id===m.id);if(!r)throw Error('Publisher not found.');if(r.doNotContact)throw Error('Remove the do-not-contact flag before rechecking.');const parent=s.campaigns.find(c=>c.id===r.campaignId)||{},offer=r.opportunities.find(o=>o.decision==='qualified'),u=C.url(m.url||offer?.url||r.discoveredURL||r.website);if(C.domain(u)!==r.domain)throw Error('Choose a page on this publisher’s domain.');return command({type:'PUB_START',campaignName:(parent.name||r.niche)+' · Recheck',niche:r.niche||'publishing',subtopics:parent.subtopics||'',relatedTopics:parent.relatedTopics,researchLanguage:parent.researchLanguage,senderId:parent.senderId,checkDatabase:parent.checkDatabase,checkContacted:parent.checkContacted,useGemini:parent.useGemini,mailAccountIds:parent.mailAccountIds,mailAccountLabels:parent.mailAccountLabels,urls:u,target:1,budget:90,pageLimit:8});}
 case 'PUB_RESEARCH_QUEUE':{const c2=s.campaigns.find(x=>x.id===m.campaignId)||c;if(!c2)throw Error('Campaign not found.');const left=(c2.pending||[]).length;if(!left)throw Error('No websites are waiting in this campaign.');
  // Research only what already passed the filters: no more Google pages, and room for every waiting website.
  c2.queryIndex=c2.queries.length;c2.searchURL='';c2.pageNumber=1;c2.target=M.tally(s,c2)+left;c2.status='running';c2.completedAt='';s.activeId=c2.id;log(c2,'Researching the '+left+' website'+(left>1?'s':'')+' still waiting from this campaign. No new Google pages are opened.');await save(s);wake(50);return {queued:left};}
 case 'PUB_BACKUP':{const {output,metricRun,...backup}=structuredClone(s);backup.databases=backup.databases.filter(d=>d.kind!=='output');backup.leads.forEach(r=>delete r.sheetSentAt);return {...backup,exportedAt:now()};}
 case 'PUB_MAIL_ADD':{const endpoint=PublisherMail.endpoint(m.endpoint),secret=PublisherMail.secret(m.secret),list=await accounts();if(list.some(a=>a.endpoint===endpoint))throw Error('This account is already connected.');if(list.length>=10)throw Error('Connect up to 10 email accounts.');const info=await reachable({endpoint,secret},'Email account');if(!info.gmail)throw Error('This script cannot read Gmail. Paste the latest Code.gs and appsscript.json, then redeploy.');const account={id:id(),label:C.clean(m.label).slice(0,80)||info.account||'Gmail account',email:info.account,endpoint,secret,status:'Connected',checkedAt:now()};PublisherConnections.healthy(account);list.push(account);await chrome.storage.local.set({[ACCOUNTS]:list});if(!s.settings.mailHistory){s.settings.mailHistory=true;await save(s);}return {label:account.label,email:account.email};}
 case 'PUB_SEND_SHEET':{const config=await outputConfig();if(!config?.endpoint)throw Error('Connect your output Sheet in Export destinations.');const ids=new Set(Array.isArray(m.ids)?m.ids:[]),rows=s.leads.filter(r=>ids.has(r.id)&&r.bucket!=='unchecked');if(!rows.length)throw Error('Select at least one researched result.');if(rows.length>2000)throw Error('Send up to 2,000 results at a time.');s.output.pendingIds=C.uniq([...s.output.pendingIds,...rows.map(r=>r.id)]);s.output.status='Pending';s.output.retryAt='';await save(s);wakeSheet(100,true);return {queued:rows.length};}
 case 'PUB_DELETE':{const ids=new Set(Array.isArray(m.ids)?m.ids:[]);if(!ids.size)throw Error('Select at least one result.');const running=s.campaigns.find(c=>c.status==='running'&&c.jobs?.some(j=>ids.has(j.record.id)));if(running)throw Error('Some selected websites are being researched right now. Pause the campaign first.');const before=s.leads.length;s.leads=s.leads.filter(r=>!ids.has(r.id));for(const c of s.campaigns){if(c.researchedIds)c.researchedIds=c.researchedIds.filter(x=>!ids.has(x));if(c.researchedIds)M.tally(s,c);}s.output.pendingIds=s.output.pendingIds.filter(x=>!ids.has(x));await save(s);return {deleted:before-s.leads.length};}
 case 'PUB_RECHECK_METRICS':{if(s.metricRun?.status==='running')throw Error('A metrics recheck is already running.');const ids=C.uniq((Array.isArray(m.ids)?m.ids:[]).filter(x=>s.leads.some(r=>r.id===x)));if(!ids.length)throw Error('Select at least one result.');s.metricRun={status:'running',queue:ids,total:ids.length,done:0,updated:0,missing:0,parallel:Math.min(2,Math.max(1,Number(m.parallel)||2)),tabs:[],startedAt:now()};await save(s);wakeMetrics(50);return {queued:ids.length};}
 case 'PUB_METRICS_STOP':{if(s.metricRun){s.metricRun.status='stopped';await closeTabs(s.metricRun.tabs);s.metricRun.tabs=[];await save(s);}return true;}
 case 'PUB_SHEET_MODE':{s.settings.sheetMode=m.mode==='auto'?'auto':'manual';await save(s);return {mode:s.settings.sheetMode};}
 case 'PUB_MAIL_TOGGLE':s.settings.mailHistory=!!m.enabled;await save(s);return true;
 case 'PUB_MAIL_REMOVE':{const list=await accounts();await chrome.storage.local.set({[ACCOUNTS]:list.filter(a=>a.id!==m.id)});return true;}
 case 'PUB_MAIL_TEST':{const list=await accounts(),a=list.find(x=>x.id===m.id);if(!a)throw Error('Account not found.');try{const info=await reachable(a,a.email||a.label);PublisherConnections.healthy(a);a.status='Connected';a.email=info.account||a.email;}catch(e){PublisherConnections.failed(a,e);a.status=a.health==='retrying'?'Retrying':'Needs attention';}a.checkedAt=now();await chrome.storage.local.set({[ACCOUNTS]:list});if(a.error)throw Error(a.error);return {status:a.status,email:a.email};}
 case 'PUB_BULK':{const ids=new Set(Array.isArray(m.ids)?m.ids:[]);if(!ids.size)throw Error('Select at least one result.');let changed=0;for(const r of s.leads){if(!ids.has(r.id))continue;if(['New','Contacted','Follow-up','Responded','Negotiating','Agreed','Not a fit'].includes(m.dealStatus))r.dealStatus=m.dealStatus;if(typeof m.doNotContact==='boolean')r.doNotContact=m.doNotContact;M.recompute(r);queueOutput(s,r.id);changed++;}for(const c2 of s.campaigns)if(c2.researchedIds)M.tally(s,c2);await save(s);return {changed};}
 default:throw Error('Unknown publisher action.');}}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{if(!m?.type?.startsWith('PUB_'))return false;if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL('')))return false;const p=['PUB_GET','PUB_OUTPUT_SYNC'].includes(m.type)?command(m):serial(()=>command(m),m.type);p.then(value=>respond({ok:true,value}),e=>respond({ok:false,error:e.message}));return true;});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM){syncOutput().catch(console.error);refreshSources().catch(console.error);probeConnections().catch(console.error);serial(async()=>{const before=await read(),c=active(before);if(c&&['database_blocked','mail_blocked'].includes(c.status)&&c.retryAt&&Date.now()>=Date.parse(c.retryAt)){c.status='running';c.retryAt='';}await tick();const s=await read();if(['running','scheduled'].includes(s.metricRun?.status))wakeMetrics(100);},'alarm');}});
chrome.runtime.onInstalled.addListener(()=>serial(async()=>{await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});await chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});await chrome.alarms.create(ALARM,{periodInMinutes:0.5});const s=await read(),c=active(s);if(c?.status==='running'){c.status='paused';log(c,'Extension updated. Resume your saved campaign.');}await save(s);}));
chrome.runtime.onStartup.addListener(()=>serial(async()=>{await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});await chrome.alarms.create(ALARM,{periodInMinutes:0.5});const s=await read(),c=active(s);if(c&&!['complete','stopped'].includes(c.status)){c.status='paused';c.searchTabId=null;c.groupId=null;c.tabPool=[];for(const j of c.jobs||[]){j.tabId=null;j.parked=false;}c.searchLoaded=false;log(c,'Browser restarted. Resume your campaign.');}if(['running','scheduled'].includes(s.metricRun?.status)){s.metricRun.tabs=[];wakeMetrics(2000);}await save(s);}));
})();
