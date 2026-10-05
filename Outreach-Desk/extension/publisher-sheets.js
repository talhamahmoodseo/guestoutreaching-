(function(g){
'use strict';
const C=PublisherCore, D=PublisherDeps, list=x=>x==null?[]:Array.isArray(x)?x:[x];
const LIMIT=70*1024*1024;
const STATUS_HEADERS=new Set(['outreachstatus','relationship','dealstatus','status']);
function emails(value){
 const found=String(value||'').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,63}/gi)||[];
 return C.uniq(found.map(e=>e.toLowerCase().replace(/^[.]+|[.,;:!?]+$/g,'')).filter(e=>{const parts=e.split('@');return parts[0].length>0&&parts[0].length<=64&&C.domain(parts[1]);}));
}
function isContacted(value){
 const status=String(value||'').normalize('NFKC').toLowerCase().replace(/[_–—-]+/g,' ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 if(!status||/\b(?:not contacted|not yet contacted|never contacted|not started)\b/.test(status))return false;
 return /^(?:contacted|follow\s*up|responded|negotiating|agreed|declined|do\s+not\s+contact)(?:\b|$)/.test(status);
}
function columnIndex(ref){const letters=(String(ref||'').match(/^[A-Z]+/i)||[''])[0].toUpperCase();let n=0;for(const c of letters)n=n*26+c.charCodeAt(0)-64;return n?n-1:-1;}
function headerInfo(rows){
 const ids=Object.keys(rows).map(Number).filter(Number.isFinite).sort((a,b)=>a-b).slice(0,10);
 for(const id of ids){const cells=rows[id],status=Object.entries(cells).find(([,v])=>STATUS_HEADERS.has(String(v||'').normalize('NFKC').toLowerCase().replace(/[^a-z]/g,'')));
  if(status)return {row:id,statusColumn:Number(status[0])};
 }
 return null;
}
function summarizeRows(rows){
 const domains=new Set(),allEmails=new Set(),contactedDomains=new Set(),contactedEmails=new Set();
 const header=headerInfo(rows);
 for(const [rowId,cells] of Object.entries(rows)){
  const values=Object.values(cells),rowEmails=values.flatMap(emails),rowDomains=C.uniq([...values.flatMap(v=>C.cellDomains(v)),...rowEmails.map(C.companyDomain)]);
  rowDomains.forEach(d=>domains.add(d));rowEmails.forEach(e=>allEmails.add(e));
  if(header&&Number(rowId)!==header.row&&isContacted(cells[header.statusColumn])){
   rowDomains.forEach(d=>contactedDomains.add(d));rowEmails.forEach(e=>contactedEmails.add(e));
  }
 }
 return {domains:[...domains],emails:[...allEmails],contactedDomains:[...contactedDomains],contactedEmails:[...contactedEmails]};
}
function xlsx(bytes){
 if(bytes.length>20*1024*1024)throw Error('Workbook exceeds the 20 MB download limit. Split it or upload a smaller file.');
 let total=0;const files=D.unzipSync(bytes,{filter:f=>{if(!/\.(xml|rels)$/.test(f.name))return false;total+=f.originalSize;if(total>LIMIT||!Number.isFinite(total))throw Error('Workbook expands beyond the safe 70 MB limit.');return true;}});
 const parser=new D.XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:false});
 const read=p=>{if(!files[p])throw Error('Incomplete workbook: missing '+p);const s=D.strFromU8(files[p]);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('Unsupported XML declarations.');if(D.XMLValidator.validate(s)!==true)throw Error('Invalid workbook XML: '+p);return parser.parse(s);};
 const resolve=(base,target)=>{const path=target.startsWith('/')?target.slice(1):base+target;const stack=[];for(const part of path.split('/')){if(part==='..'){if(!stack.length)throw Error('Invalid workbook path.');stack.pop();}else if(part&&part!=='.')stack.push(part);}return stack.join('/');};
 const rels=p=>files[p]?list(read(p).Relationships?.Relationship):[];
 const text=v=>typeof v==='string'?v:typeof v==='number'?String(v):v?.['#text']??'';
 const rich=v=>v?.t!=null?text(v.t):list(v?.r).map(r=>text(r.t)).join('');
 const cellValue=cell=>{const t=cell['@_t'];if(t==='s'){const index=Number(text(cell.v));if(!Number.isInteger(index)||shared[index]===undefined)throw Error('Invalid shared string reference.');return shared[index];}if(t==='inlineStr')return rich(cell.is);return text(cell.v);};
 const shared=files['xl/sharedStrings.xml']?list(read('xl/sharedStrings.xml').sst?.si).map(rich):[];
 const wb=read('xl/workbook.xml').workbook, links=rels('xl/_rels/workbook.xml.rels');
 const tabs=[],allDomains=new Set(),allEmails=new Set(),allContactedDomains=new Set(),allContactedEmails=new Set();
 for(const sh of list(wb?.sheets?.sheet)){
  const rel=links.find(r=>r['@_Id']===sh['@_r:id']);if(!rel||rel['@_TargetMode']==='External')throw Error('Cannot locate every workbook tab.');
  if(/chartsheet$/.test(rel['@_Type']||''))continue;
  const path=resolve('xl/',rel['@_Target']),ws=read(path).worksheet;if(!ws)throw Error('Unsupported worksheet '+sh['@_name']);
  const rows=list(ws.sheetData?.row),valuesByRow={};
  for(const row of rows){const rowNo=Number(row['@_r'])||Object.keys(valuesByRow).length+1,values={},cells=list(row.c);let fallback=0;
   for(const cell of cells){const ref=String(cell['@_r']||'');let col=columnIndex(ref);if(col<0)col=fallback;fallback=Math.max(fallback,col+1);
    const value=cellValue(cell);values[col]=value;
    C.cellDomains(value).forEach(d=>allDomains.add(d));emails(value).forEach(e=>allEmails.add(e));
    const f=text(cell.f),match=f.match(/^\s*HYPERLINK\s*\(\s*"((?:[^"]|"")*)"/i);if(match){const target=match[1].replace(/""/g,'"');C.cellDomains(target).forEach(d=>allDomains.add(d));emails(target).forEach(e=>allEmails.add(e));values[col]=String(values[col]||'')+' '+target;}
   }
   valuesByRow[rowNo]=values;
  }
  const split=path.lastIndexOf('/'),relationships=rels(path.slice(0,split+1)+'_rels/'+path.slice(split+1)+'.rels');
  for(const h of list(ws.hyperlinks?.hyperlink)){
   const r=relationships.find(x=>x['@_Id']===h['@_r:id']);if(!r?.['@_Target'])continue;
   const target=r['@_Target'],ref=String(h['@_ref']||'').split(':')[0],m=ref.match(/^([A-Z]+)(\d+)$/i);
   C.cellDomains(target).forEach(d=>allDomains.add(d));emails(target).forEach(e=>allEmails.add(e));
   if(m){const rowNo=Number(m[2]),col=columnIndex(m[1]);valuesByRow[rowNo]=valuesByRow[rowNo]||{};valuesByRow[rowNo][col]=String(valuesByRow[rowNo][col]||'')+' '+target;}
  }
  const summary=summarizeRows(valuesByRow);summary.domains.forEach(d=>allDomains.add(d));summary.emails.forEach(e=>allEmails.add(e));summary.contactedDomains.forEach(d=>allContactedDomains.add(d));summary.contactedEmails.forEach(e=>allContactedEmails.add(e));
  tabs.push({name:sh['@_name']||'Sheet',rows:rows.length,domains:summary.domains.length,hidden:sh['@_state']==='hidden'});
 }
 if(!tabs.length)throw Error('No readable worksheet tabs found.');
 return {tabs,domains:[...allDomains],emails:[...allEmails],contactedDomains:[...allContactedDomains],contactedEmails:[...allContactedEmails]};
}
function csv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=ch;}
 if(quoted)throw Error('CSV has an unclosed quote.');if(cell||row.length){row.push(cell);rows.push(row);}
 const valuesByRow={};rows.forEach((values,index)=>{valuesByRow[index+1]=Object.fromEntries(values.map((value,col)=>[col,value]));});
 const summary=summarizeRows(valuesByRow);return {...summary,tabs:[{name:'CSV',rows:rows.length,domains:summary.domains.length}]};
}
// Google names the export after the workbook, so the source can label itself instead of
// showing a raw sheet id until someone renames it by hand.
function exportTitle(res){
 const header=String(res.headers?.get?.('content-disposition')||'');
 const raw=(/filename\*=UTF-8''([^;]+)/i.exec(header)||/filename="([^"]+)"/i.exec(header)||[])[1]||'';
 if(!raw)return '';
 let name=raw;try{name=decodeURIComponent(raw);}catch{}
 return C.clean(name.replace(/\.(xlsx|csv)$/i,'')).slice(0,100);
}
async function fetchSheet(link,fetcher=fetch){const meta=C.sheetLink(link),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);try{const res=await fetcher(meta.exportURL,{credentials:'omit',signal:controller.signal,cache:'no-store'});if(!res.ok)throw Error(`Google returned ${res.status}. Check Anyone with the link → Viewer and that downloads are allowed.`);const title=exportTitle(res);if(Number(res.headers.get('content-length'))>20*1024*1024)throw Error('Workbook exceeds 20 MB.');const reader=res.body?.getReader();let bytes;if(reader){const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20*1024*1024){await reader.cancel();throw Error('Workbook exceeds 20 MB.');}chunks.push(value);}bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}}else bytes=new Uint8Array(await res.arrayBuffer());if(bytes[0]!==80||bytes[1]!==75)throw Error('Google did not return a workbook. Make the sheet viewable to anyone with its link and allow downloads, or upload an XLSX/CSV copy.');return {...meta,title,...xlsx(bytes)};}catch(e){if(e.name==='AbortError')throw Error('Sheet download timed out. Refresh to retry.');throw e;}finally{clearTimeout(timer);}}
// Output-Sheet history returned by the Apps Script: status-driven tabs plus plain history tabs.
function scriptTabs(input){
 const tabs=Array.isArray(input)?input.slice(0,50):[];const all={domains:new Set(),emails:new Set(),contactedDomains:new Set(),contactedEmails:new Set()},meta=[];
 for(const tab of tabs){const grid=Array.isArray(tab?.rows)?tab.rows.slice(0,60000):[],rows={};grid.forEach((r,i)=>{if(Array.isArray(r)){const cells={};r.slice(0,60).forEach((v,c)=>cells[c]=String(v??''));rows[i+1]=cells;}});
  const summary=summarizeRows(rows),history=!!tab.history;
  summary.domains.forEach(d=>{all.domains.add(d);if(history)all.contactedDomains.add(d);});summary.emails.forEach(e=>{all.emails.add(e);if(history)all.contactedEmails.add(e);});
  summary.contactedDomains.forEach(d=>all.contactedDomains.add(d));summary.contactedEmails.forEach(e=>all.contactedEmails.add(e));
  meta.push({name:C.clean(tab.name).slice(0,100)||'Sheet',rows:grid.length,domains:summary.domains.length,history});}
 return {tabs:meta,domains:[...all.domains],emails:[...all.emails],contactedDomains:[...all.contactedDomains],contactedEmails:[...all.contactedEmails]};
}
g.PublisherSheets={xlsx,csv,fetchSheet,scriptTabs,isContacted,exportTitle};
})(globalThis);
