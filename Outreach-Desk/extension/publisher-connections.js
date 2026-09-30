/* Shared health policy: configuration survives outages; failures never mean disconnected. */
(function(g){
'use strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function failure(message,status){const e=new Error(message);e.httpStatus=status;return e;}
function transient(e){if(e?.httpStatus)return [404,408,425,429].includes(e.httpStatus)||e.httpStatus>=500;
 return !/no longer connected|no selected|not connected|secret|sign-in|permission|not the Outreach Desk|unreadable|not accept|not returned|not inside|cannot read Gmail|different number|invalid|exceeds|workbook|share link/i.test(e?.message||'');}
async function retry(fn){let error;for(let i=0;i<3;i++){try{return await fn();}catch(e){error=e;if(!transient(e))break;if(i<2)await sleep(700*(2**i));}}throw error;}
function healthy(record){Object.assign(record,{health:'healthy',checkedAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),error:'',failures:0,retryAt:''});}
function failed(record,e){const retryable=transient(e),failures=(record.failures||0)+1;Object.assign(record,{health:retryable?'retrying':'attention',checkedAt:new Date().toISOString(),error:e.message,failures,retryAt:retryable?new Date(Date.now()+Math.min(30*60000,30000*2**Math.min(failures-1,6))).toISOString():''});}
function due(record,ttl=15*60000){return record.retryAt?Date.now()>=Date.parse(record.retryAt):record.health==='attention'?false:!record.lastSuccessAt||Date.now()-Date.parse(record.lastSuccessAt)>=ttl;}
g.PublisherConnections={failure,transient,retry,healthy,failed,due};
})(globalThis);
