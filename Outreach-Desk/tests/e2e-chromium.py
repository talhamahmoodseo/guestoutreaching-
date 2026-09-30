"""End-to-end check in real Chromium: simulated Google page with late RankSEO-style badges and sitelinks,
simulated websites (contact-form Turnstile, real challenge page, guest-post list, toolbar for metrics recheck)
and a fake Apps Script. Drives the real dashboard buttons."""
import asyncio, json, re, os
os.environ['PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS']='1'
from playwright.async_api import async_playwright
import pathlib
HERE=pathlib.Path(__file__).resolve().parent
import pathlib
EXT=str(pathlib.Path(__file__).resolve().parent.parent/'extension')
# Needs: pip install playwright && playwright install chromium; openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/e2e/key.pem -out /tmp/e2e/cert.pem -days 2 -subj /CN=localhost
SITES=[('stylehaus.com',70,72,1,'18y 7m'),('runwaynotes.com',9,2,4,'5y 7m'),('fabricjournal.com',55,61,3,'12y 1m'),('trendwire.com',39,73,30,'29y 7m'),
 ('lookbookdaily.com',44,48,2,'8y 2m'),('formcaptcha.com',35,40,1,'6y'),('cfwall.com',50,52,2,'10y'),('top50fashionblogs.com',60,65,5,'9y'),('chicpost.com',None,None,None,None),('modaedit.com',28,33,6,'4y 3m')]
PAGE2=[('stylehaus.com',70,72,1,'18y 7m'),('serponly.com',None,None,None,None),('nothingmetric.com',None,None,None,None)]
def site_serp(domain):
    if domain!='serponly.com': return '<html><head><title>site - Google</title></head><body><div id="rso"></div></body></html>'
    return '<html><head><title>site:serponly.com - Google Search</title></head><body><div id="rso"><div class="MjjYud"><div class="yuRUbf"><a href="https://serponly.com/"><h3>Serponly Fashion</h3><div class="cite"><span>serponly.com</span></div></a></div><div class="rk-row"></div></div></div><script>setTimeout(()=>{const r=document.querySelector(".rk-row");["DA 33","DR 41","SPAM 2%","AGE 7y 1m"].forEach(t=>{const s=document.createElement("span");s.textContent=t;r.appendChild(s);});},1500);</script></body></html>'
def serp(page=1):
    blocks=[]
    for i,(d,da,dr,sp,age) in enumerate(SITES if page==1 else PAGE2):
        title='Top 50 Fashion Blogs Accepting Guest Posts' if d.startswith('top50') else f'Write for us - {d.split(".")[0].title()} Fashion Magazine'
        href=f'https://{d}/guest-posts' if page==2 and d=='stylehaus.com' else f'https://{d}/write-for-us'
        side=f'<div class="sitelinks"><a href="https://{d}/about"><h3>About {d}</h3></a><a href="https://{d}/contact"><h3>Contact</h3></a></div>' if i in (0,3) else ''
        blocks.append(f'<div class="MjjYud" data-i="{i}" data-da="{da}" data-dr="{dr}" data-sp="{sp}" data-age="{age or ""}"><div class="g"><div class="yuRUbf"><a href="{href}"><h3>{title}</h3><div class="cite"><span>{d}</span></div></a></div><div class="VwiC3b">We accept fashion guest posts from contributors.</div>{side}</div></div>')
        if i==2 and page==1: blocks.append('<div class="related-question-pair"><h3>How do I find fashion blogs?</h3></div>')
    script="""<script>setTimeout(()=>{document.querySelectorAll('.MjjYud').forEach(b=>{if(b.dataset.da==='None')return;const a=b.querySelector('.cite');const mk=t=>{const s=document.createElement('span');s.className='rk';s.textContent=t;return s;};
 [ 'DR: '+b.dataset.dr,'DA: '+b.dataset.da,'Spam: '+b.dataset.sp+'%','Age: '+b.dataset.age].forEach(t=>a.appendChild(mk(t)));
 const row=document.createElement('div');['DA '+b.dataset.da,'PA '+b.dataset.da,'DR '+b.dataset.dr,'SPAM '+b.dataset.sp+'%','BL 1.2K','AGE '+b.dataset.age,'TR 3.9K'].forEach(t=>row.appendChild(mk(t)));b.querySelector('.yuRUbf').after(row);});},2500);</script>"""
    nav='<a id="pnnext" href="/search?q=fashion+write+for+us&start=10">Next</a>' if page==1 else ''
    return '<html><head><title>fashion write for us - Google Search</title></head><body><div id="search"><div id="rso">'+''.join(blocks)+'</div></div>'+nav+script+'</body></html>'
TOOLBAR='<div style="position:fixed;top:0;left:0;right:0" id="rankbar"><span>RANKSEO</span><span>SEO 78</span><span>DA 71</span><span>DR 76</span><span>SPAM 1%</span><span>AGE 18y 5m</span><span>TR 39K</span></div>'
def site(host,path):
    if host=='cfwall.com': return '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Checking if the site connection is secure</div></body></html>'
    words='<p>'+('Fashion trends, style guides and runway coverage for our fashion readers. '*20)+'</p>'
    if host=='top50fashionblogs.com': return '<html><head><title>Top 50 Fashion Blogs Accepting Guest Posts</title></head><body><h1>Top 50 fashion blogs that accept guest posts</h1><ol>'+''.join(f'<li><a href="https://blog{i}.com">Blog {i}</a> - write for us</li>' for i in range(50))+'</ol></body></html>'
    bar=TOOLBAR if host=='chicpost.com' else ''
    if host=='formcaptcha.com':
        return f'<html><head><title>Contact - Formcaptcha Fashion</title></head><body><h1>Write for us</h1><p>We welcome fashion guest posts. Email editor@formcaptcha.com</p><form class="wpcf7-form"><input name="email"><div class="cf-turnstile"><iframe src="https://challenges.cloudflare.com/turnstile/x"></iframe></div><p>Verify you are human</p><button>Send</button></form></body></html>'
    return f'<html><head><title>Write for us - {host} Fashion Magazine</title></head><body>{bar}<h1>Write for us</h1><p>We accept fashion guest posts and contributor articles. Send your pitch to editor@{host}.</p>{words}<a href="/contact">Contact</a></body></html>'
sheet_posts=[]
log=[]
flaky=[0]

import threading, ssl
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,body,ctype='text/html'):
        b=body.encode(); self.send_response(200); self.send_header('Content-Type',ctype); self.send_header('Content-Length',str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        host=(self.headers.get('Host') or '').split(':')[0].removeprefix('www.'); path=self.path
        log.append((host,path))
        if host=='google.com' and path.startswith('/search'):
            from urllib.parse import urlparse, parse_qs
            q=parse_qs(urlparse(path).query).get('q',[''])[0]
            if q.startswith('site:'): return self.send(site_serp(q[5:]))
            return self.send(serp(2 if 'start=10' in path else 1))
        if host=='dns.google': return self.send(json.dumps({'Status':0,'Answer':[{'type':15}]}),'application/json')
        return self.send(site(host,path))
    fail_left=[0]
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}'); sheet_posts.append(body); a=body.get('action')
        if flaky[0]>0: flaky[0]-=1; self.send_response(500); self.send_header('Content-Length','0'); self.end_headers(); return
        res={'ok':True,'message':'pong','accepted':0,'sheet':True,'account':'me@gmail.com','gmail':True} if a=='ping' else {'ok':True,'tabs':[]} if a=='history' else {'ok':True,'accepted':len(body.get('records',[]))}
        self.send(json.dumps(res),'application/json')
srv=ThreadingHTTPServer(('127.0.0.1',8443),H); c=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); c.load_cert_chain('/tmp/e2e/cert.pem','/tmp/e2e/key.pem'); srv.socket=c.wrap_socket(srv.socket,server_side=True)
threading.Thread(target=srv.serve_forever,daemon=True).start()
async def main():
    async with async_playwright() as p:
        ctx=await p.chromium.launch_persistent_context('/tmp/e2e/prof',headless=True,channel='chromium',args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}','--host-resolver-rules=MAP * 127.0.0.1:8443, EXCLUDE localhost','--ignore-certificate-errors'])
        await asyncio.sleep(2); sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker'); eid=sw.url.split('/')[2]
        pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append('ERR:'+str(e)))
        pg.on('console',lambda m:errs.append('CONSOLE:'+m.type+':'+m.text) if m.type in ('error','warning') else None); pg.on('dialog',lambda d:asyncio.ensure_future(d.accept()))
        await pg.goto(f'chrome-extension://{eid}/publisher.html'); await pg.wait_for_timeout(1500)
        msg=lambda t,extra='{}': pg.evaluate(f"chrome.runtime.sendMessage(Object.assign({{type:'{t}'}},{extra}))")
        print('banner hidden?',await pg.locator('#error-banner').is_hidden(), await pg.locator('#engine-version').text_content())
        print('connect',await msg('PUB_OUTPUT_SETTINGS',"{endpoint:'https://script.google.com/macros/s/TESTDEPLOY/exec',useForMail:false}"))
        print('auto mode',await msg('PUB_SHEET_MODE',"{mode:'auto'}"))
        flaky[0]=2; print("simulating 2 Apps Script failures before the campaign")
        r=await msg('PUB_START',"{niche:'fashion',queries:'fashion write for us',drMin:20,missingMetric:'keep',parallel:5,target:4,maxPages:2,checkDatabase:false,checkContacted:false}"); print('start',r)
        for i in range(60):
            await pg.wait_for_timeout(2000); st=await msg('PUB_GET'); c=st['value']['campaigns'][0]
            if c['status'] not in ('running',): break
        print('status',c['status'],'|',c['message'])
        leads=st['value']['leads']
        for l in sorted(leads,key=lambda x:x['domain']): print(f"  {l['domain']:24} {l['bucket']:9} DA={l.get('da')} DR={l.get('dr')} spam={l.get('spam')} age={l.get('age')} | {(l.get('hardReject') or {}).get('reason') or l.get('decisionReason','')}"[:170])
        await pg.wait_for_timeout(9000)
        auto=[b for b in sheet_posts if b.get('action')=='upsert']; print('AUTO export rows:',sorted(r['domain'] for b in auto for r in b['records']))
        print('DEDUP stylehaus research requests:',[p for h,p in log if h=='stylehaus.com'],'| /guest-posts opened?',('stylehaus.com','/guest-posts') in log)
        st=await msg('PUB_GET'); c=st['value']['campaigns'][0]; leads=st['value']['leads']
        print('buckets:',{b:sum(1 for l in leads if l['bucket']==b) for b in set(l['bucket'] for l in leads)})
        print('QUEUE:',c.get('queued'),'| campaign status',c['status'],'|',c['message'])
        print('tabs in UI:',await pg.eval_on_selector_all('.tab','e=>e.map(x=>x.textContent.trim())'))
        await pg.locator('[data-research-queue]').first.click()
        await pg.wait_for_timeout(2000)
        print('toast after click:',(await pg.text_content('#toast')).strip());print('errs:',errs[-3:])
        for i in range(40):
            await pg.wait_for_timeout(1500); c=(await msg('PUB_GET'))['value']['campaigns'][0]
            if c['status']!='running': break
        print('after Research waiting: queued',c.get('queued'),'status',c['status'])
        print('DBG late:',[x for x in errs if 'DBGSEND' in x])
        probe=await pg.evaluate("Promise.race([chrome.runtime.sendMessage({type:'PUB_TOPICS',niche:'x'}).then(r=>'resolved'),new Promise(r=>setTimeout(()=>r('HUNG'),8000))])")
        print('another serial command:',probe)
        print('output state:',await pg.evaluate("chrome.runtime.sendMessage({type:'PUB_GET'}).then(r=>({st:r.value.output.status,pend:r.value.output.pendingIds.length,err:r.value.output.error}))"))
        leads=(await msg('PUB_GET'))['value']['leads']
        print('buckets now:',{b:sum(1 for l in leads if l['bucket']==b) for b in set(l['bucket'] for l in leads)})
        leads=(await msg('PUB_GET'))['value']['leads']
        await msg('PUB_SHEET_MODE',"{mode:'manual'}")
        await pg.reload(); await pg.wait_for_timeout(1500)
        await pg.click('[data-bucket=ready]'); await pg.wait_for_timeout(300)
        await pg.check('#select-page'); await pg.wait_for_timeout(300)
        print('selected:',await pg.text_content('#selection'))
        await pg.click('#send-sheet'); await pg.wait_for_timeout(2500)
        print('toast:',await pg.text_content('#toast'))
        ups=[b for b in sheet_posts if b.get('action')=='upsert']; print('upserts',len(ups),'rows',sum(len(b['records']) for b in ups),'keys',sorted(ups[0]['records'][0].keys()) if ups else None)
        # recheck missing metrics
        await pg.click('[data-bucket=all]'); await pg.click('#metric-pop summary'); await pg.check('#missing-only-filter'); await pg.click('h1, .topbar',position={'x':5,'y':5}) if False else None
        await pg.wait_for_timeout(300); await pg.check('#select-page'); print('missing selected:',await pg.text_content('#selection'))
        await pg.click('#recheck-metrics'); await pg.wait_for_timeout(1000)
        for i in range(30):
            await pg.wait_for_timeout(1500); mr=(await msg('PUB_GET'))['value']['metricRun']
            if mr and mr['status']!='running': break
        print('metricRun',{k:mr.get(k) for k in ('status','total','updated','missing','note')})
        for l in (await msg('PUB_GET'))['value']['leads']:
            if l['domain'] in ('chicpost.com','serponly.com','nothingmetric.com'): print('  recheck',l['domain'],'DA',l.get('da'),'DR',l.get('dr'),'spam',l.get('spam'),'age',l.get('age'),'status',l.get('metricsStatus'),'source',l.get('metricSource'))
        # rejected filter
        await pg.click('#metric-pop summary'); await pg.uncheck('#missing-only-filter'); await pg.click('#metric-pop summary'); await pg.click('[data-bucket=rejected]'); await pg.wait_for_timeout(300)
        print('reasons:',[o for o in await pg.eval_on_selector_all('#reason-filter option','els=>els.map(e=>e.textContent)')])
        await pg.screenshot(path='/tmp/e2e/rejected.png')
        # delete one via UI
        before=len((await msg('PUB_GET'))['value']['leads'])
        await pg.check('tbody tr:nth-child(1) input'); await pg.click('#delete-selected'); await pg.wait_for_timeout(1200)
        print('delete',before,'->',len((await msg('PUB_GET'))['value']['leads']))
        await pg.click('[data-bucket=all]'); await pg.wait_for_timeout(300); await pg.screenshot(path='/tmp/e2e/all.png')
        print('ERR',errs); await ctx.close()
asyncio.run(main())
