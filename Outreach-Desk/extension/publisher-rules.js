/* Evidence rules: search screening, publisher offers and mailbox purpose. No generated facts. */
(function (g) {
  'use strict';
  const C = PublisherCore;
  const text = v => C.clean(v).replace(/[’‘]/g, "'");
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const platformHosts = ['github.com','github.io','githubusercontent.com','wordpress.com','wordpress.org','stackoverflow.com','stackexchange.com','reddit.com','quora.com','pinterest.com','fiverr.com','facebook.com','instagram.com','linkedin.com','youtube.com','medium.com','x.com'];
  const norm = s => text(s).toLowerCase();
  function platform(url) {
    try { const h=new URL(url).hostname;return platformHosts.find(p=>h===p||h.endsWith('.'+p))||''; } catch { return ''; }
  }
  function pageKey(url) { try {const u=new URL(url);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid|ref)$/i.test(k))u.searchParams.delete(k);u.pathname=u.pathname.replace(/\/+$/,'')||'/';return u.href;}catch{return '';}}
  function listTitle(title) {
    const s=norm(title);
    return /\b(?:top\s*\d*|best\s*\d*|list of|ultimate list|\d{2,}\+?)\b.{0,80}\b(?:websites?|sites|blogs|publications)\b.{0,90}\b(?:guest|write|contribut|accept|post)/i.test(s)
      || /\b(?:guest post(?:ing)?|guest blog(?:ging)?|write for us).{0,50}\b(?:sites|websites|blogs)\b.{0,35}\b(?:list|directory|roundup|round-up|\d{2,})\b/.test(s)
      || /\b(?:write for us|guest posts?|submit a guest post)\b.{0,70}\barchives?\b|\barchives?\b.{0,70}\b(?:guest posts?|write for us)\b/.test(s);
  }
  function articleTitle(title) {return /^(?:how (?:to|can|does)|what (?:is|are)|why|tips (?:for|to)|benefits of|(?:the |a )?guide to|pitching your writing).{0,110}(?:guest post|guest blog|write for us|outreach|publications|backlinks)/i.test(text(title));}
  function role(value) {
    const s=norm(value).replace(/[-_/]+/g,' ');
    if(/sponsored (?:content|post|article)|native advertis|brand(?:ed)? content|paid (?:post|article)|advertorial/.test(s))return 'Sponsored content';
    if(/write for us|guest post|submit.{0,15}(?:article|post)|pitch (?:us|a story)/.test(s))return 'Guest post';
    if(/contribut|author guidelines|submission guidelines|become a writer|write with us/.test(s))return 'Contributor';
    if(/advertis|media kit|partner with us|sponsor/.test(s))return 'Advertising';
    if(/editorial|publishing policy/.test(s))return 'Editorial';
    if(/contact|let.s talk|get in touch/.test(s))return 'Contact';
    if(/about|our team/.test(s))return 'About';return '';
  }
  const subjects={education:['education','educational','school','tutoring','mathematics','physics','science','learning','courses'],health:['health','medical','medicine','wellness','nutrition','fitness'],crypto:['crypto','cryptocurrency','bitcoin','blockchain','web3'],technology:['technology','software','computing','gadgets','cybersecurity'],finance:['finance','financial','banking','investing','insurance'],travel:['travel','tourism','destinations','hospitality']};
  function differentSubject(title,niche,selected='') {
    const s=norm(title),target=norm(niche),selectedTerms=norm(selected).split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
    const own=[...(subjects[target]||[]),target,...selectedTerms];
    const has=term=>new RegExp('(?:^|[^a-z0-9])'+escape(term)+'(?:s)?(?:$|[^a-z0-9])','i').test(s);
    if(own.some(has))return '';
    return Object.entries(subjects).find(([key,terms])=>key!==target&&terms.some(has))?.[0]||'';
  }
  function suffix(domain) {return PublisherDeps.parse(domain,{allowPrivateDomains:true}).publicSuffix||'';}
  function metricCheck(result,settings){
 const num=v=>v==null||v===''?null:Number(v),years=m=>Math.floor(m/12)+'y '+(m%12)+'m';
 const plain=v=>String(v),pct=v=>v+'%';
 /* One rule per metric, both bounds, same shape for all of them, so no filter is ever
    half-built. See docs/PRODUCT-STRUCTURE.md section 6. */
 const RANGES=[
  ['da','DA','daMin','daMax',plain,'da_range'],
  ['dr','DR','drMin','drMax',plain,'metric_range'],
  ['spam','Spam Score','spamMin','spamMax',pct,'metric_range'],
  ['age','Domain age','ageMinMonths','ageMaxMonths',years,'metric_range'],
  ['traffic','Traffic','trafficMin','trafficMax',plain,'metric_range']
 ];
 const bound=k=>{const v=num(settings[k]);return Number.isFinite(v)?v:null;};
 const named=RANGES.filter(([,,lo,hi])=>bound(lo)!=null||bound(hi)!=null);
 const checks=[];
 for(const [key,label,lo,hi,fmt,code] of RANGES){
  let min=bound(lo),max=bound(hi);
  // DA stays the default metric when the campaign named no other one.
  if(min==null&&max==null){if(key!=='da'||named.length)continue;min=0;max=100;}
  const why=v=>min!=null&&max!=null?label+' '+fmt(v)+' is outside '+fmt(min)+'-'+fmt(max)
   :min!=null?label+' '+fmt(v)+' is below '+fmt(min)
   :label+' '+fmt(v)+' is above '+fmt(max);
  checks.push([key,label,v=>min!=null&&v<min||max!=null&&v>max,why,code]);
 }
 for(const [key,label,fails,why,code] of checks){const v=num(result[key]);
  // Missing values follow the campaign choice: keep (default) or skip. A reliable value outside the range always rejects.
  if(v==null||!Number.isFinite(v)||key==='da'&&(!Number.isInteger(v)||v<0||v>100)){if(settings.missingMetric==='skip')return {decision:'reject',code:'metric_missing',reason:label+' not available (campaign skips websites with missing metrics)'};continue;}
  if(fails(v))return {decision:'reject',code,reason:why(v)};}
 return null;
}
function screen(result,settings={}) {
    const u=C.url(result.url),d=C.domain(u);if(!d)return {decision:'reject',code:'invalid',reason:'Not a public website URL'};
    const p=settings.excludePlatforms!==false&&platform(u);if(p)return {decision:'reject',code:'platform',reason:'Platform or community site: '+p};
    const blocked=C.excluded(d,settings.blocklist||[]);if(blocked)return {decision:'reject',code:'domain',reason:blocked};
    const allowed=(settings.tlds||[]).map(x=>norm(x).replace(/^\.+/,'')).filter(Boolean);
    if(allowed.length&&!allowed.includes(suffix(d)))return {decision:'reject',code:'tld',reason:'Domain extension .'+suffix(d)+' is outside this campaign’s selection'};
    if(listTitle(result.title))return {decision:'reject',code:'listicle',reason:'A list of guest-post websites, not this publisher’s offer'};
    if(/guest post(?:ing)? services|buy.{0,30}(?:backlinks|guest posts)|outreach (?:agency|services)/i.test(result.title))return {decision:'reject',code:'seller',reason:'Outreach service or link-selling page, not a publisher invitation'};
    if(articleTitle(result.title))return {decision:'reject',code:'article',reason:'Informational article about outreach, not a submission page'};
    if(!result.manual&&settings.niche){const other=differentSubject(result.title,settings.niche,settings.relatedTopics?settings.subtopics:'');if(other)return {decision:'reject',code:'wrong_niche',reason:'Result title identifies a '+other+' website, outside the '+settings.niche+' niche'};}
    if(settings.requireDA){const m=metricCheck(result,settings);if(m)return m;}
    const intent=role(result.title+' '+new URL(u).pathname),snippet=text(result.snippet);
    if(/Guest post|Contributor|Sponsored content|Advertising/.test(intent))return {decision:'inspect',code:'promising',reason:'Relevant title or URL; verify the publisher’s offer',intent};
    if(/we (?:accept|welcome)|submit your|write for us|advertise with us|contributor guidelines/i.test(snippet))return {decision:'inspect',code:'snippet',reason:'Possible offer in the result snippet; needs on-page verification',intent};
    if(result.manual)return {decision:'inspect',code:'manual',reason:'Manually supplied website; check its relevant pages',intent};
    return {decision:'inspect',code:'unclear_search',reason:'Relevant result without a clear offer in the title; checking the website',intent};
  }
  const aliases={health:['wellness','medicine','medical','healthcare','nutrition','fitness','mental health','healthy'],crypto:['cryptocurrency','blockchain','bitcoin','web3','defi'],technology:['software','tech','cybersecurity','artificial intelligence','gadgets','computing'],finance:['financial','investing','investment','insurance','banking'],travel:['tourism','destinations','hospitality'],business:['entrepreneurship','marketing','management','small business'],home:['home improvement','renovation','interior','construction']};
  function topicTerms(niche,extra='',related=true) {const base=norm(niche),parts=base.split(/[,/&]/).map(text);return C.uniq([base,...parts,...(related?String(extra).split(/[,\n]/).map(norm):[])]).filter(t=>t.length>2).slice(0,40);}
  function topicMatch(page,niche,extra='',related=true) {const headline=norm([page.title,page.heading,page.description].join(' ')),body=norm(page.mainText);const terms=topicTerms(niche,extra,related);const has=(hay,t)=>new RegExp('(?:^|[^a-z0-9])'+escape(t)+'(?:s)?(?:$|[^a-z0-9])','i').test(hay);const strong=terms.filter(t=>has(headline,t)),weak=terms.filter(t=>has(body,t)),matched=C.uniq([...strong,...weak]);return {status:matched.length?'matched':'unclear',strength:strong.length?'strong':weak.length?'weak':'none',terms:matched.slice(0,8),reason:strong.length?'Title or description mentions '+strong.slice(0,3).join(', '):weak.length?'Main content mentions '+weak.slice(0,3).join(', ')+'; publisher topic is not yet confirmed':'No clear match to the selected niche/topic words'};}
  const negative=/(?:\b(?:we\s+)?(?:do not|don't|cannot|can't|no longer|not currently|not|never)\s+(?:currently\s+|now\s+)?(?:accept(?:ing)?|allow|publish|offer|take|consider)\s+(?:unsolicited\s+|any\s+)?(?:guest(?:\s*\/\s*sponsored)?\s*(?:posts?|articles?|content)|sponsored\s*(?:posts?|articles?|content)|contributions?|submissions?)|\b(?:guest\s+post\s+|article\s+)?submissions\s+(?:are\s+)?(?:currently\s+)?closed)/i;
  const guestOffer=/\bwe\s+(?:currently\s+)?(?:accept|welcome|invite|seek|are (?:always )?looking for)\s+(?:original\s+|quality\s+|new\s+|well.written\s+)?(?:guest\s+)?(?:articles?|posts?|contributions?|contributors?|writers?|pitches|stories)\b|\b(?:submit|send|pitch|email)\s+(?:(?:your|us|an?|the)\s+){0,2}(?:guest\s+)?(?:article|post|pitch|draft|story|contribution|outline|idea)\b|\binterested in writing for us\b/i;
  const sponsoredOffer=/\b(?:we\s+(?:offer|accept|publish|create)|book|submit|discuss|contact us (?:for|about)|enquire about|inquire about)\s+(?:a\s+|your\s+|custom\s+)?(?:sponsored\s+(?:content|posts?|articles?)|branded content|advertorials?|native advertising)|\bsponsored articles?\s+(?:are|go through|must|will)\b/i;
  const adOffer=/\badvertise with us\b|\b(?:we\s+offer|contact (?:us|our)|view our|download (?:our|the))\s+(?:advertising|media kit|sponsorship)|\badvertising (?:enquir|inquir|opportunit)|\bmedia kit\b/i;
  function excerpt(hay,re){const m=re.exec(hay);return m?hay.slice(Math.max(0,m.index-60),Math.min(hay.length,m.index+m[0].length+180)):'';}
  function assess(page,niche,extra='',related=true) {
    const body=text(page.mainText).slice(0,22000),title=text(page.title),heading=text(page.heading),r=role(heading+' '+title+' '+(C.url(page.url)?new URL(page.url).pathname:''));
    const topic=topicMatch(page,niche,extra,related),out={url:page.url,title:heading||title,htmlTitle:title,role:r,topic,decision:'review',types:[],evidence:'',reason:'No direct publisher invitation found in the main content',code:'no_offer'};
    if(listTitle(heading)||listTitle(title)){return {...out,decision:'reject',code:'listicle',reason:'This page lists other websites; it is not a publisher offer'};}
    if(articleTitle(heading)||articleTitle(title)){return {...out,decision:'reject',code:'article',reason:'Informational article, not a direct contribution offer'};}
    const closed=negative.test(body),guest=guestOffer.test(body),sponsor=sponsoredOffer.test(body),ad=adOffer.test(body);
    out.closedTypes=[];
    if(closed){
      for(const match of body.matchAll(new RegExp(negative.source,'gi'))){
        const clause=body.slice(match.index).split(/(?:[.;\n]|\bbut\b|\bhowever\b|\bexcept\b)/i)[0];
        if(/guest|contribut|submission/i.test(clause))out.closedTypes.push('Guest post','Contributor');
        if(/sponsor/i.test(clause))out.closedTypes.push('Sponsored content');
      }
      if(!out.closedTypes.length)out.closedTypes.push('Guest post','Contributor');
      out.closedTypes=C.uniq(out.closedTypes);out.refusalEvidence=excerpt(body,negative);
    }
    // A heading, navigation link, or meta description alone never verifies acceptance.
    if(guest&&(r==='Guest post'||r==='Contributor'||r==='Editorial'||r==='Contact'||/\b(?:our|we|us)\b/i.test(body)))out.types.push(r==='Contributor'?'Contributor':'Guest post');
    if(sponsor)out.types.push('Sponsored content');
    if(ad)out.types.push('Advertising');
    out.types=out.types.filter(t=>!out.closedTypes.includes(t));
    if(closed&&!out.types.length)return {...out,decision:'reject',code:'closed',evidence:out.refusalEvidence,reason:'Publisher explicitly refuses or has closed '+out.closedTypes.join(' / ').toLowerCase()};
    if(!out.types.length)return out;
    out.evidence=excerpt(body,sponsor?sponsoredOffer:guest?guestOffer:adOffer);
    const content=out.types.some(t=>t!=='Advertising');
    if(!content)return {...out,code:'advertising_only',reason:'Advertising is offered; guest or sponsored articles are not confirmed'};
    if(topic.status!=='matched')return {...out,code:'topic_unclear',reason:'A contribution offer exists; niche relevance needs review'};
    if(topic.strength!=='strong')return {...out,code:'site_topic_unconfirmed',reason:'The offer mentions this topic, but the publisher’s subject needs confirmation'};
    return {...out,decision:'qualified',code:'verified_offer',reason:'Direct publisher offer and topic match found'};
  }
  function classifyEmail(contact) {
    const address=norm(contact.email),local=address.split('@')[0],context=text(contact.context||''),pageRole=contact.pageRole||'';
    const base={...contact,email:address,kind:'Unclassified',suitability:'review',reason:'No clear mailbox purpose found'};
    const prohibited=[['Customer support',/^(?:support|help(?:desk)?|customer(?:care|service|support)?|care|feedback|complaints?|returns?|orders?|billing|refunds?)(?:[._+-]|$)/i],['Privacy / legal',/^(?:privacy|dpo|gdpr|legal|abuse|security|dmca|copyright)(?:[._+-]|$)/i],['Careers',/^(?:jobs?|careers?|recruitment|hr)(?:[._+-]|$)/i],['Automated',/^(?:no.?reply|do.?not.?reply|notifications?|mailer|bounce)(?:[._+-]|$)/i]];
    for(const [kind,re] of prohibited)if(re.test(local)){const own=kind==='Customer support'&&C.domain(contact.source)&&C.domain('https://'+address.split('@')[1])===C.domain(contact.source)&&contact.attribution!=='third_party'&&!/feedback|complaint|return|order|billing|refund/.test(local);return {...base,kind,suitability:kind==='Automated'?'excluded':'fallback',reason:kind==='Automated'?'Automated no-reply address':own?'First-party customer-care inbox; low score':'Mailbox name indicates '+kind.toLowerCase()+'; kept with a low score'};}
    if(contact.attribution==='third_party')return {...base,kind:'Third-party / author',suitability:'excluded',reason:'Found in an author, comment, example or developer-credit context'};
    const editorial=/editor|submission|contribut|guest|publish|content|pitch/i,sponsored=/advertis|sponsor|partnership|media.sales|brand.partner/i;
    if(editorial.test(local))return {...base,kind:/submission|contribut|guest|pitch/.test(local)?'Submissions':'Editorial',suitability:'recommended',reason:'Mailbox name indicates editorial or submission enquiries'};
    if(sponsored.test(local))return {...base,kind:/partner/.test(local)?'Partnerships':'Advertising',suitability:'recommended',reason:'Mailbox name indicates advertising or partnerships'};
    if(/customer (?:care|service|support)|technical support|feedback (?:only|enquir|inquir)|order (?:status|support)|billing quer/i.test(context))return {...base,kind:'Customer support',suitability:'excluded',reason:'Nearby text identifies customer service or feedback'};
    if(/for (?:advertising|sponsor)|advertising (?:enquir|inquir)|sponsored (?:posts?|articles?|content)|media sales/i.test(context))return {...base,kind:'Advertising',suitability:'recommended',reason:'Nearby text links this address to advertising or sponsored content'};
    if(/editor(?:ial)? (?:enquir|inquir|team|contact)|(?:submit|send|email).{0,50}(?:pitch|article|draft|guest post)|(?:pitch|article|draft).{0,30}(?:to|email)|contribut(?:ions|or).{0,30}(?:email|contact)/i.test(context))return {...base,kind:'Editorial',suitability:'recommended',reason:'Nearby text links this address to editorial submissions'};
    if(/^(?:hello|contact|info|enquiries|inquiries|office|admin)(?:[._+-]|$)/i.test(local))return {...base,kind:'General contact',suitability:'fallback',reason:'General inbox; useful fallback when no editorial contact is published'};
    if(/^sales(?:[._+-]|$)/i.test(local))return {...base,kind:'Sales',suitability:pageRole==='Advertising'||pageRole==='Sponsored content'?'fallback':'review',reason:pageRole==='Advertising'||pageRole==='Sponsored content'?'Sales address found on an advertising page':'Sales purpose is not clearly related to publishing'};
    if(/press|pr|mediarelations/i.test(local))return {...base,kind:'Press / PR',reason:'Media relations is not necessarily an article-submission route'};
    return base;
  }
  function usableContacts(record) {return (record.emails||[]).filter(e=>!e.recheckPending&&!e.suppressed&&!e.contacted&&!e.databaseDuplicate&&e.override!=='exclude'&&(e.override==='include'||['recommended','fallback','review'].includes(e.suitability)));}
  function rank(contact,types=[]) {const weight={'Submissions':0,'Editorial':1,'Advertising':2,'Partnerships':3,'General contact':5,'Sales':7,'Customer support':12};return contact.suitability==='excluded'?50:(weight[contact.kind]??20)+(contact.suitability==='review'?15:0);}
  function quality(record){const contacts=usableContacts(record),e=[...contacts].sort((a,b)=>rank(a)-rank(b))[0],offers=(record.opportunities||[]).filter(o=>!o.recheckPending),direct=offers.some(o=>o.types?.length&&o.decision!=='reject'),strong=offers.some(o=>o.topic?.strength==='strong'||o.topic?.source),weak=offers.some(o=>o.topic?.status==='matched');let value=0;const reasons=[];const add=(n,t)=>{value+=n;reasons.push({points:n,label:t});};if(e)add(({Editorial:35,Submissions:35,Advertising:30,Partnerships:28,'General contact':20,Sales:12,'Customer support':5})[e.kind]||10,e.kind+' contact');if(direct)add(25,'Publisher invitation');if(strong)add(20,'Strong niche evidence');else if(weak)add(8,'Topic mentioned');if(record.language&&record.language!=='unknown')add(5,'Language identified');if(record.aiAssessment?.relevant&&record.aiAssessment.confidence>=80&&record.aiAssessment.evidence)add(10,'AI evidence corroboration');if(record.forms?.length)add(5,'Contact form available');if(record.reviewDecision==='approve')add(5,'Approved by you');if(record.hardReject||record.doNotContact||record.reviewDecision==='reject')value=0;return {value:Math.max(0,Math.min(100,value)),reasons};}
  function decision(record) {
    if(record.doNotContact)return {bucket:'rejected',reason:'Do not contact — saved by you'};
    if(record.hardReject)return {bucket:'rejected',reason:record.hardReject.reason||'Excluded by campaign requirements'};
    if(record.reviewDecision==='reject')return {bucket:'rejected',reason:'Rejected by you'};
    const offers=(record.opportunities||[]).filter(o=>!o.recheckPending),valid=offers.filter(o=>o.decision==='qualified'),closed=offers.filter(o=>o.code==='closed');
    // Informational articles on a real website are weak evidence; only lists, sellers and closed offers reject the site.
    const strongRejects=offers.filter(o=>o.decision==='reject'&&o.code!=='article');
    if(offers.length&&offers.every(o=>o.decision==='reject')&&strongRejects.length)return {bucket:'rejected',reason:strongRejects[0].reason};
    if(closed.length&&!offers.some(o=>o.types?.some(t=>['Sponsored content','Advertising'].includes(t))&&o.decision!=='reject'))return {bucket:'rejected',reason:'Publisher explicitly closes or refuses submissions'};
    // No email can only be decided after the website was actually opened and read.
    const contacts=usableContacts(record),checked=record.visitedURLs?.length>0||record.reviewDecision==='approve';
    // Opened but unreadable is a rejection with its reason; never opened is simply still in the queue.
    if(!checked&&record.attempted)return {bucket:'rejected',reason:record.incompleteReason||record.stopReason||'Website could not be opened'};
    if(!checked)return {bucket:'unchecked',reason:'Waiting in the research queue'};
    if(contacts.length)return {bucket:'ready',reason:valid.length?'Relevant publishing offer and email found':record.aiAssessment?.relevant?'AI-supported opportunity with an email':'Email found; publishing acceptance is unconfirmed. Check the quality score.'};
    if(record.forms?.length)return {bucket:'form',reason:'Contact form available; no email found'};
    const pages=record.visitedURLs.length,only=(record.emails||[]).some(e=>!e.recheckPending);
    return {bucket:'no_email',reason:only?'Only automated or third-party emails found on '+pages+' checked page'+(pages>1?'s':''):'No email found on '+pages+' checked page'+(pages>1?'s':'')+(record.incompleteReason?' ('+record.incompleteReason+')':'')};
  }
  function exportRows(records,all=false) {
    const header=['Website','Niche','DA','PA','Found with keywords','Opportunity page','Page title','Opportunity types','Email','Email type','Email suitability','Email source','Decision','Decision reason','Topic evidence','First found','Last checked','Relationship','Notes'];
    const rows=[];for(const r of records){const contacts=all?r.emails||[]:r.doNotContact||r.bucket==='rejected'?[]:usableContacts(r);const offers=(r.opportunities||[]).filter(o=>!o.recheckPending),op=offers.find(o=>o.decision==='qualified')||offers[0];for(const e of contacts.length?contacts:[{}])rows.push([r.website,r.niche,r.da??'',r.pa??'',(r.discoveries||[]).map(d=>d.query).filter((q,i,a)=>a.indexOf(q)===i).join(' | '),op?.url||r.discoveredURL,op?.title||r.title,C.uniq(offers.flatMap(o=>o.types||[])).join('; '),e.email,e.kind,e.suitability,e.source,r.bucket,r.decisionReason,op?.topic?.terms?.join('; '),r.createdAt,r.collectedAt,r.dealStatus,r.notes]);}
    const safe=v=>'"'+(/^[\s]*[=+@-]/.test(String(v??''))?"'":'')+String(v??'').replace(/"/g,'""')+'"';return '\uFEFF'+[header,...rows].map(row=>row.map(safe).join(',')).join('\r\n');
  }
  g.PublisherRules={platform,pageKey,listTitle,articleTitle,role,screen,topicTerms,topicMatch,assess,classifyEmail,usableContacts,rank,quality,decision,exportRows};
})(globalThis);
