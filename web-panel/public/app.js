
// ============================================================
// WireGuard Web Panel — frontend (live only, no demo data)
// English version
// ============================================================
let players = [], feedCache = [], histCache = [], pollTimer = null;
let dbOn = false, currentView = 'overview', myRole = 'viewer', myUser = 'Web-Panel', settingsCache = null;

const RANK = { owner:4, admin:3, moderator:2, viewer:1 };
const roleAtLeast = (min) => (RANK[myRole]||0) >= (RANK[min]||99);

function applyRole(){
    document.querySelectorAll('.need-admin').forEach(el=>el.classList.toggle('hidden',!roleAtLeast('admin')));
}

const VIEW_TITLES={
    overview:'Overview',
    players:'Players',
    feed:'Detections',
    history:'History',
    bans:'Bans',
    admins:'Admins',
    whitelist:'Whitelist',
    analytics:'Analytics',
    logs:'Logs',
    settings:'Settings',
    users:'Users'
};

const SEV_DE={
    critical:'Critical',
    high:'High',
    medium:'Medium',
    low:'Low'
};

const ACT_DE={
    ban:'Ban',
    kick:'Kick',
    warn:'Warn',
    none:'None',
    message:'Message',
    heal:'Heal',
    freeze:'Freeze',
    unfreeze:'Unfreeze',
    kill:'Kill'
};

const sevDE=s=>SEV_DE[s]||s||'—';
const actDE=a=>a?(ACT_DE[a]||a):'—';

function setIdentity(user,role){
    myUser=user||myUser;
    const n=$('ucName'),rl=$('ucRole'),av=$('ucAv');
    if(n)n.textContent=user||'—';
    if(rl)rl.textContent=role||'—';
    if(av)av.textContent=(user||'WG').slice(0,2).toUpperCase();
}

const $ = (id) => document.getElementById(id);

const esc = (s) => String(s==null?'':s).replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
}[c]));

async function api(path, opts = {}) {
    try {
        const res = await fetch('api/' + path, {
            headers: { 'Content-Type':'application/json' },
            ...opts
        });
        return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch {
        return { status: 0, body: {} };
    }
}

function toast(msg, type='') {
    const t=$('toast');
    t.textContent=msg;
    t.className='toast '+type;
    clearTimeout(t._h);
    t._h=setTimeout(()=>t.classList.add('hidden'),3200);
}

function showModal(content, focusSelector){
    $('modalInner').innerHTML=content;
    $('modal').classList.remove('hidden');
    requestAnimationFrame(()=>$(focusSelector)?.focus());
}

function setFormError(message, inputId){
    const error=$('modalError');
    if(error){
        error.textContent=message;
        error.classList.remove('hidden');
    }
    if(inputId){
        const input=$(inputId);
        if(input){
            input.classList.add('invalid');
            input.setAttribute('aria-invalid','true');
            input.focus();
        }
    }
}

function clearFormError(){
    const error=$('modalError');
    if(error){
        error.textContent='';
        error.classList.add('hidden');
    }
    document.querySelectorAll('#modalInner .invalid').forEach(input=>{
        input.classList.remove('invalid');
        input.removeAttribute('aria-invalid');
    });
}

function openConfirmDialog(title,message,actionLabel,onConfirm){
    showModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="modal-x" type="button" aria-label="Close" onclick="closeModal()">✕</button></div>
        <div class="form"><p class="dialog-copy">${esc(message)}</p><p id="modalError" class="form-error hidden" role="alert"></p>
        <div class="modal-actions"><button class="actbtn" type="button" onclick="closeModal()">Cancel</button><button id="modalConfirm" class="btn-danger" type="button">${esc(actionLabel)}</button></div></div>`, 'modalConfirm');

    $('modalConfirm').addEventListener('click',async()=>{
        const button=$('modalConfirm');
        button.disabled=true;
        try{
            const result=await onConfirm();
            if(result?.ok)closeModal();
            else setFormError(result?.error||'Action failed.');
        }catch(error){
            setFormError(error instanceof Error?error.message:'Action failed.');
        }finally{
            if($('modalConfirm'))$('modalConfirm').disabled=false;
        }
    });
}

function setConn(ok){
    const d=$('connDot'),t=$('connText');
    d.className='dot '+(ok?'on':'off');
    t.textContent=ok?'Server connected':'Server offline';
}

function setDb(ok){
    const d=$('dbDot'),t=$('dbText');
    d.className='dot '+(ok?'on':'off');
    t.textContent='DB: '+(ok?'connected':'off');
}

// ── Authentication ──

$('loginForm').addEventListener('submit', async (e)=>{
    e.preventDefault();

    const r=await api('login',{
        method:'POST',
        body:JSON.stringify({
            username:$('user').value,
            password:$('pass').value
        })
    });

    if(r.status===200){
        $('loginErr').classList.add('hidden');
        myRole=r.body.role||'viewer';
        applyRole();
        setIdentity($('user').value,myRole);
        showDash();
    } else {
        $('loginErr').textContent=r.status===0
            ?'Server unreachable.'
            :'Incorrect username or password.';
        $('loginErr').classList.remove('hidden');
    }
});

$('user').addEventListener('input',()=>$('loginErr').classList.add('hidden'));
$('pass').addEventListener('input',()=>$('loginErr').classList.add('hidden'));

$('logout').addEventListener('click', async ()=>{
    await api('logout',{method:'POST'});
    stopPolling();
    $('dash').classList.add('hidden');
    $('login').classList.remove('hidden');
});

async function checkAuth(){
    const r=await api('me');
    dbOn=!!(r.body&&r.body.db);
    setDb(dbOn);
    myRole=(r.body&&r.body.role)||'viewer';
    applyRole();

    if(r.body&&r.body.user){
        setIdentity(r.body.user,myRole);
        showDash();
    }
}

function showDash(){
    $('login').classList.add('hidden');
    $('dash').classList.remove('hidden');
    refreshAll();
    startPolling();
}

// ── Navigation ──

document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>{
    document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));
    n.classList.add('active');

    currentView=n.dataset.view;

    const tb=$('tbTitle');
    if(tb)tb.textContent=VIEW_TITLES[currentView]||'';

    document.querySelectorAll('.view').forEach(s=>s.classList.add('hidden'));

    const v=$('view-'+currentView);
    v.classList.remove('hidden');
    v.style.animation='none';
    void v.offsetWidth;
    v.style.animation='';

    if(currentView==='history') loadHistory();
    if(currentView==='bans') loadBans();
    if(currentView==='admins') loadAdmins();
    if(currentView==='analytics') loadAnalytics();
    if(currentView==='logs') loadLogs();
    if(currentView==='settings') loadSettings();
    if(currentView==='users') loadUsers();
    if(currentView==='whitelist') loadWhitelist();
}));

// ── Count-up animation ──

function countTo(el,target){
    const from=parseInt((el.textContent||'').replace(/\D/g,''))||0;
    if(from===target){
        el.textContent=target;
        return;
    }

    const dur=600,start=performance.now();

    (function step(now){
        const p=Math.min((now-start)/dur,1);
        el.textContent=Math.round(from+(target-from)*(1-Math.pow(1-p,3)));
        if(p<1)requestAnimationFrame(step);
    })(performance.now());
}

// ── Refresh ──

async function refreshAll(){
    await Promise.all([loadStats(),loadPlayers(),loadFeed()]);
    drawSpark();

    if(currentView==='history')loadHistory();
    if(currentView==='analytics')loadAnalytics();
}

async function loadStats(){
    const r=await api('stats');

    if(r.status===200){
        setConn(true);
        setDb(dbOn||!!r.body.database);

        $('st-name').textContent=r.body.serverName||'—';
        countTo($('st-online'),r.body.online??0);
        countTo($('st-det'),r.body.detections??0);
        countTo($('st-bans'),r.body.bans??0);
    } else {
        setConn(false);
        $('st-name').textContent='—';
        countTo($('st-online'),0);
        countTo($('st-det'),0);
        countTo($('st-bans'),0);
    }
}

async function loadPlayers(){
    const r=await api('players');
    players=(r.status===200)?(r.body.players||[]):[];
    renderPlayers();
}

async function loadFeed(){
    const r=await api('feed');
    feedCache=(r.status===200)?(r.body.feed||[]):[];
    renderFeed(feedCache,'feedFull');
    renderFeed(feedCache.slice(0,7),'ov-feed');
}

async function loadHistory(){
    const r=await api('history');
    histCache=(r.status===200&&r.body.history)?r.body.history:[];
    renderHistory();
}

async function loadBans(){
    const r=await api('bans');
    const bans=(r.status===200&&r.body.bans)?r.body.bans:[];

    $('bBody').innerHTML=bans.map((b,i)=>`
        <tr style="animation-delay:${i*.03}s">
            <td>${esc(b.ban_id||b.id)}</td>
            <td>${esc(b.name)}</td>
            <td>${esc(b.reason)}</td>
            <td>${esc(b.bannedBy||b.banned_by)}</td>
            <td>${fmtDate(b.time||b.created_at)}</td>
            <td class="cell-sub">${esc((b.identifiers&&b.identifiers.license)||b.license||'—')}</td>
            <td><button class="actbtn unban" data-id="${esc(b.ban_id||b.id)}">Unban</button></td>
        </tr>
    `).join('')||'<tr><td colspan="7" class="empty">No bans.</td></tr>';

    $('bBody').querySelectorAll('.unban').forEach(btn=>btn.addEventListener('click',()=>{
        const banId=btn.dataset.id;

        openConfirmDialog(
            'Remove ban',
            `Are you sure you want to remove ban ${banId}?`,
            'Unban',
            async()=>{
                const result=await api('unban',{
                    method:'POST',
                    body:JSON.stringify({banId})
                });

                if(result.status===200){
                    toast('Ban removed','ok');
                    loadBans();
                    loadStats();
                    return {ok:true};
                }

                return {
                    ok:false,
                    error:result.body.error||'Could not remove ban.'
                };
            }
        );
    }));
}

async function loadAdmins(){
    const r=await api('admins');
    const admins=(r.status===200&&r.body.admins)?r.body.admins:[];

    $('aBody').innerHTML=admins.map((a,i)=>`
        <tr style="animation-delay:${i*.03}s">
            <td class="cell-sub">${esc(a.license)}</td>
            <td>${esc(a.name)}</td>
            <td><span class="chip">${esc(a.rank)}</span></td>
            <td>${esc(a.added_by)}</td>
            <td>${fmtDate(a.created_at)}</td>
            <td><button class="actbtn ban" data-lic="${esc(a.license)}">Remove</button></td>
        </tr>
    `).join('')||'<tr><td colspan="6" class="empty">No admins.</td></tr>';

    $('aBody').querySelectorAll('.ban').forEach(btn=>btn.addEventListener('click',()=>{
        const license=btn.dataset.lic;

        openConfirmDialog(
            'Remove admin',
            `Are you sure you want to remove admin permissions for ${license}?`,
            'Remove',
            async()=>{
                const result=await api('removeadmin',{
                    method:'POST',
                    body:JSON.stringify({license})
                });

                if(result.status===200){
                    toast('Admin removed','ok');
                    loadAdmins();
                    return {ok:true};
                }

                return {
                    ok:false,
                    error:result.body.error||'Could not remove admin.'
                };
            }
        );
    }));
}

async function loadLogs(){
    const r=await api('logs');
    const logs=(r.status===200&&r.body.logs)?r.body.logs:[];

    $('lBody').innerHTML=logs.map((l,i)=>`
        <tr style="animation-delay:${i*.03}s">
            <td>${fmtDate(l.created_at||l.time)}</td>
            <td>${esc(l.admin)}</td>
            <td><span class="chip">${esc(l.action)}</span></td>
            <td>${esc(l.target)}</td>
            <td class="cell-sub">${esc(l.detail)}</td>
        </tr>
    `).join('')||'<tr><td colspan="5" class="empty">No logs.</td></tr>';
}

let anaCache=null;

async function loadAnalytics(){
    const r=await api('analytics');
    const a=(r.status===200&&r.body.analytics)?r.body.analytics:{};
    anaCache=a;

    const perDay=(a.perDay||[]).map(x=>({d:x.d,c:+x.c||0}));
    const avg=perDay.length
        ?Math.round(perDay.reduce((s,x)=>s+x.c,0)/perDay.length)
        :0;

    countTo($('an-total'),a.total||0);
    countTo($('an-24h'),a.last24h||0);
    countTo($('an-bans'),a.totalBans||0);
    countTo($('an-avg'),avg);

    renderBars('an-types',(a.topTypes||[]).map(t=>({
        label:t.detection,
        count:t.c
    })));

    renderBars('an-players',(a.topPlayers||[]).map(t=>({
        label:t.name||'Unknown',
        count:t.c
    })));

    drawAnaChart(perDay);
}

function drawAnaChart(perDay){
    const cv=$('anChart');
    if(!cv)return;

    const ctx=cv.getContext('2d');
    const w=cv.clientWidth||600,h=cv.height;
    cv.width=w;
    ctx.clearRect(0,0,w,h);

    const data=perDay||[];

    if(!data.length){
        ctx.fillStyle='#8a8f98';
        ctx.font='13px Inter,sans-serif';
        ctx.textAlign='center';
        ctx.fillText('No data for this period.',w/2,h/2);
        return;
    }

    const padT=20,padB=28,padL=10,padR=10;
    const gap=Math.min(10,Math.max(4,w/data.length*0.25));
    const max=Math.max(1,...data.map(d=>d.c));
    const bw=(w-padL-padR)/data.length;

    ctx.strokeStyle='rgba(255,255,255,.06)';
    ctx.lineWidth=1;

    for(let i=0;i<=3;i++){
        const y=padT+(h-padT-padB)*i/3;
        ctx.beginPath();
        ctx.moveTo(padL,y);
        ctx.lineTo(w-padR,y);
        ctx.stroke();
    }

    data.forEach((d,i)=>{
        const bh=(d.c/max)*(h-padT-padB);
        const x=padL+i*bw;
        const y=h-padB-(bh||0);

        const g=ctx.createLinearGradient(0,y,0,h-padB);
        g.addColorStop(0,'#f6b43b');
        g.addColorStop(1,'rgba(246,169,59,.12)');

        ctx.fillStyle=g;
        rr(ctx,x+gap/2,y,Math.max(1,bw-gap),Math.max(1,bh),5);
        ctx.fill();

        if(d.c>0){
            ctx.fillStyle='#f0cf8a';
            ctx.font='600 11px Inter,sans-serif';
            ctx.textAlign='center';
            ctx.fillText(d.c,x+bw/2,y-6);
        }

        const dt=new Date(d.d);
        const lbl=isNaN(dt)?String(d.d).slice(5):(dt.getDate()+'/'+(dt.getMonth()+1));

        ctx.fillStyle='#8a8f98';
        ctx.font='10px Inter,sans-serif';
        ctx.textAlign='center';
        ctx.fillText(lbl,x+bw/2,h-10);
    });
}

// ── Render helpers ──

function trustInfo(value){
    if(value===null||value===undefined||value===''){
        return {score:null,className:'crit',label:'Unknown'};
    }

    const raw=Number(value);

    if(!Number.isFinite(raw)){
        return {score:null,className:'crit',label:'Unknown'};
    }

    const score=Math.max(0,Math.min(100,raw));

    if(score>=80)return {score,className:'ok',label:'Stable'};
    if(score>=50)return {score,className:'warn',label:'Monitor'};
    if(score>=20)return {score,className:'bad',label:'Critical'};

    return {score,className:'crit',label:'Very critical'};
}

function fmtDate(v){
    if(!v)return '—';
    const d=(typeof v==='number')?new Date(v*1000):new Date(v);
    return isNaN(d)?esc(v):d.toLocaleString('en-AU');
}

function fmtTime(v){
    const d=(typeof v==='number')?new Date(v*1000):new Date(v);
    return isNaN(d)?'':d.toLocaleTimeString('en-AU');
}

function renderPlayers(){
    const q=$('pSearch').value.toLowerCase();

    const list=players.filter(p=>
        !q||p.name.toLowerCase().includes(q)||String(p.src).includes(q)
    );

    $('pBody').innerHTML=list.map((p,i)=>{
        const flags=Object.entries(p.flags||{})
            .map(([k,v])=>`<span class="chip">${esc(k)}·${v}</span>`)
            .join('')||'<span class="chip">Clean</span>';

        const trust=trustInfo(p.trust);
        const trustDisplay=trust.score===null?'—':trust.score;
        const trustBar=trust.score===null?'':`<span style="width:${trust.score}%"></span>`;

        return `<tr style="animation-delay:${i*.03}s">
            <td>${p.src}</td>
            <td>${esc(p.name)}${p.isAdmin?' 👑':''}</td>
            <td>
                <div class="trust-cell ${trust.className}" title="Trust Score: ${trustDisplay} out of 100. Decreases when enabled detections apply their configured penalty.">
                    <div class="trust-line">
                        <span class="trust ${trust.className}">${trustDisplay}</span>
                        <small>${trust.label}</small>
                    </div>
                    <div class="trust-meter" aria-label="Trust Score ${trustDisplay} out of 100">${trustBar}</div>
                </div>
            </td>
            <td>${flags}</td>
            <td>${p.ping}ms</td>
            <td class="row-acts">
                <button class="actbtn heal" data-a="heal" data-id="${p.src}">Heal</button>
                <button class="actbtn freeze" data-a="freeze" data-id="${p.src}">Freeze</button>
                <button class="actbtn msg" data-a="message" data-id="${p.src}">Message</button>
                <button class="actbtn kick" data-a="kick" data-id="${p.src}">Kick</button>
                <button class="actbtn ban" data-a="ban" data-id="${p.src}">Ban</button>
            </td>
        </tr>`;
    }).join('')||'<tr><td colspan="6" class="empty">No players online.</td></tr>';

    $('pBody').querySelectorAll('.actbtn').forEach(btn=>
        btn.addEventListener('click',()=>playerAction(btn.dataset.a,parseInt(btn.dataset.id,10)))
    );
}

async function playerAction(type,id){
    if(['ban','kick','warn','message'].includes(type)){
        const title=type==='message'
            ?'Send message'
            :`${actDE(type)} · Player ${id}`;

        const description=type==='ban'
            ?'This player will be permanently banned.'
            :type==='kick'
                ?'This player will be disconnected from the server.'
                :type==='warn'
                    ?'This player will receive a warning.'
                    :'Write a message to the player.';

        const actionLabel=type==='ban'
            ?'Ban'
            :type==='kick'
                ?'Kick'
                :type==='warn'
                    ?'Warn'
                    :'Send';

        showModal(`<div class="modal-head">
            <h3>${esc(title)}</h3>
            <button class="modal-x" type="button" aria-label="Close" onclick="closeModal()">✕</button>
        </div>
        <div class="form">
            <p class="dialog-copy">${esc(description)}</p>
            <label class="fl" for="f_action_reason">
                ${type==='message'?'Message':type==='warn'?'Note (optional)':'Reason (optional)'}
                <textarea id="f_action_reason" maxlength="500" placeholder="${type==='message'?'Enter message…':'Add reason…'}"></textarea>
            </label>
            <p id="modalError" class="form-error hidden" role="alert"></p>
            <div class="modal-actions">
                <button class="actbtn" type="button" onclick="closeModal()">Cancel</button>
                <button class="${type==='ban'||type==='kick'?'btn-danger':'btn-primary sm'}" type="button" onclick="submitPlayerAction('${type}',${id})">${actionLabel}</button>
            </div>
        </div>`, 'f_action_reason');

        return;
    }

    await sendPlayerAction(type,id,'');
}

window.submitPlayerAction=async(type,id)=>{
    const reason=$('f_action_reason').value.trim();

    if(type==='message'&&!reason){
        return setFormError('Please enter a message.','f_action_reason');
    }

    const button=$('modalInner').querySelector('.modal-actions button:last-child');
    button.disabled=true;

    const result=await sendPlayerAction(type,id,reason,true);

    if(!result)button.disabled=false;
};

async function sendPlayerAction(type,id,reason,keepModal=false){
    let ep='action',payload={type,target:id,reason,by:myUser};

    if(type==='kick')ep='kick';
    if(type==='ban')ep='ban';

    const r=await api(ep,{
        method:'POST',
        body:JSON.stringify(payload)
    });

    if(r.status===200){
        closeModal();
        toast(`${actDE(type)} executed`,'ok');
        setTimeout(refreshAll,400);
        return true;
    }

    const message=`Error: ${r.body.error||(r.status===0?'Server unreachable.':'Action failed.')}`;

    if(keepModal)setFormError(message,'f_action_reason');
    else toast(message,'err');

    return false;
}

function renderFeed(feed,elId){
    $(elId).innerHTML=(feed||[]).map((f,i)=>`
        <div class="feed-item ${f.severity||'low'}" data-idx="${i}" style="animation-delay:${i*.04}s">
            <div class="fi-top">
                <span>${esc(f.detection)} — ${esc(f.name)} <span class="muted">(${f.src??''})</span></span>
                <span class="fi-time">${fmtTime(f.time)}</span>
            </div>
            <div class="fi-sub">${esc(f.detail||'')} ${f.action?'· '+esc(f.action):''}${f.screenshot?' · 📷':''}</div>
        </div>
    `).join('')||'<p class="empty">No detections yet.</p>';

    $(elId).querySelectorAll('.feed-item').forEach(el=>
        el.addEventListener('click',()=>{
            const arr=(elId==='ov-feed')?feedCache.slice(0,7):feedCache;
            openDetail(arr[+el.dataset.idx]);
        })
    );
}

function renderHistory(){
    const q=($('hSearch').value||'').toLowerCase();

    const rows=histCache.filter(h=>
        !q||(h.detection||'').toLowerCase().includes(q)||(h.name||'').toLowerCase().includes(q)
    );

    $('hBody').innerHTML=rows.map((h,i)=>`
        <tr style="animation-delay:${i*.02}s" data-idx="${i}">
            <td class="cell-sub">${fmtDate(h.created_at||h.time)}</td>
            <td><b>${esc(h.detection)}</b></td>
            <td>${esc(h.name)}</td>
            <td><span class="sev ${h.severity||'low'}">${esc(sevDE(h.severity||'low'))}</span></td>
            <td>${esc(actDE(h.action))}</td>
            <td><button class="actbtn view">Details</button></td>
        </tr>
    `).join('')||'<tr><td colspan="6" class="empty">No history (database empty or not connected).</td></tr>';

    $('hBody').querySelectorAll('tr[data-idx]').forEach(tr=>
        tr.addEventListener('click',()=>openDetail(rows[+tr.dataset.idx]))
    );
}

function renderBars(elId,items){
    const max=Math.max(1,...items.map(i=>i.count));

    $(elId).innerHTML=items.map(i=>`
        <div class="bar-row">
            <span class="bar-label">${esc(i.label)}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width:${(i.count/max*100)}%"></div>
            </div>
            <span class="bar-val">${i.count}</span>
        </div>
    `).join('')||'<p class="empty">No data.</p>';
}

// ── Detail modal (case information + screenshot) ──

function normCase(c){
    return {
        detection:c.detection,
        name:c.name,
        license:c.license,
        detail:c.detail,
        severity:c.severity||'low',
        action:c.action,
        trust:c.trust,
        src:c.src,
        time:c.time||c.created_at,
        coords:c.coords||(c.pos_x!=null?{x:c.pos_x,y:c.pos_y,z:c.pos_z}:null),
        screenshot:c.screenshot||null
    };
}

function openDetail(raw){
    if(!raw)return;

    const c=normCase(raw);

    const shot=c.screenshot
        ?`<img src="${esc(c.screenshot)}" class="shot" onerror="this.parentNode.innerHTML='<div class=&quot;shot-none&quot;>Screenshot could not be loaded</div>'"/>`
        :`<div class="shot-none">No screenshot available<br><span class="muted">(enable screenshot-basic in config.lua)</span></div>`;

    const pos=c.coords
        ?`${c.coords.x?.toFixed?.(1)??c.coords.x}, ${c.coords.y?.toFixed?.(1)??c.coords.y}, ${c.coords.z?.toFixed?.(1)??c.coords.z}`
        :'—';

    $('modalInner').innerHTML=`
        <div class="modal-head">
            <div>
                <span class="sev ${c.severity}">${esc(sevDE(c.severity))}</span>
                <h3>${esc(c.detection)}</h3>
            </div>
            <button class="modal-x" onclick="closeModal()">✕</button>
        </div>

        <div class="modal-grid">
            <div class="mg"><span>Player</span><b>${esc(c.name)} ${c.src!=null?`<span class="muted">(${c.src})</span>`:''}</b></div>
            <div class="mg"><span>License</span><b class="cell-sub">${esc(c.license||'—')}</b></div>
            <div class="mg"><span>Action</span><b>${esc(actDE(c.action))}</b></div>
            <div class="mg"><span>Trust Score</span><b>${c.trust??'—'}</b></div>
            <div class="mg"><span>Time</span><b>${fmtDate(c.time)}</b></div>
            <div class="mg"><span>Position</span><b>${esc(pos)}</b></div>
            <div class="mg full"><span>Details</span><b>${esc(c.detail||'—')}</b></div>
        </div>

        <div class="shot-wrap">
            <div class="shot-title">📷 Evidence Screenshot</div>
            ${shot}
        </div>

        <div class="modal-foot">
            ${c.src!=null?`
                <button class="btn-primary sm" onclick="modalAction('ban',${c.src})">Ban Player</button>
                <button class="actbtn kick" onclick="modalAction('kick',${c.src})">Kick</button>
            `:''}
            <button class="actbtn" onclick="closeModal()">Close</button>
        </div>
    `;

    $('modal').classList.remove('hidden');
}

window.closeModal=()=>$('modal').classList.add('hidden');

window.modalAction=(type,id)=>{
    closeModal();
    playerAction(type,id);
};

$('modal').addEventListener('click',e=>{
    if(e.target.id==='modal')closeModal();
});

document.addEventListener('keyup',e=>{
    if(e.key==='Escape')closeModal();
});

// ── Add ban / add admin modals ──

$('addBanBtn').addEventListener('click',()=>{
    $('modalInner').innerHTML=formHTML('Manual Ban',[
        ['name','Name'],
        ['license','License (license:...)'],
        ['discord','Discord ID (optional)'],
        ['reason','Reason']
    ],'submitBan');

    $('modal').classList.remove('hidden');
});

$('addAdminBtn').addEventListener('click',()=>{
    $('modalInner').innerHTML=formHTML('Add Admin',[
        ['license','License (license:...)'],
        ['name','Name'],
        ['rank','Rank (e.g. admin / mod)']
    ],'submitAdmin');

    $('modal').classList.remove('hidden');
});

function formHTML(title,fields,fn){
    return `<div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="modal-x" type="button" aria-label="Close" onclick="closeModal()">✕</button>
    </div>
    <div class="form">
        ${fields.map(f=>`
            <label class="fl" for="f_${f[0]}">
                ${esc(f[1])}
                <input id="f_${f[0]}" placeholder="${esc(f[1])}"/>
            </label>
        `).join('')}
        <p id="modalError" class="form-error hidden" role="alert"></p>
        <button class="btn-primary" type="button" onclick="${fn}()">Save</button>
    </div>`;
}

window.submitBan=async()=>{
    const b={
        name:$('f_name').value,
        license:$('f_license').value,
        discord:$('f_discord').value,
        reason:$('f_reason').value,
        by:myUser
    };

    if(!b.license&&!b.discord){
        return setFormError('Please enter a license or Discord ID.','f_license');
    }

    const r=await api('addban',{
        method:'POST',
        body:JSON.stringify(b)
    });

    if(r.status===200){
        toast('Ban created','ok');
        closeModal();
        loadBans();
    } else {
        setFormError(r.body.error||'Could not create ban.',b.license?'f_license':'f_discord');
    }
};

window.submitAdmin=async()=>{
    const a={
        license:$('f_license').value,
        name:$('f_name').value,
        rank:$('f_rank').value||'admin',
        by:myUser
    };

    if(!a.license){
        return setFormError('Please enter a license.','f_license');
    }

    const r=await api('addadmin',{
        method:'POST',
        body:JSON.stringify(a)
    });

    if(r.status===200){
        toast('Admin added','ok');
        closeModal();
        loadAdmins();
    } else {
        setFormError(r.body.error||'Could not add admin.','f_license');
    }
};

// ── Sparkline ──

function drawSpark(){
    const cv=$('spark');
    if(!cv)return;

    const ctx=cv.getContext('2d');
    const w=cv.clientWidth,h=cv.height;
    cv.width=w;
    ctx.clearRect(0,0,w,h);

    const col={
        critical:'#ff5d72',
        high:'#ff9d4d',
        medium:'#f5cb47',
        low:'#f6a93b'
    };

    const data=feedCache.slice(0,20).reverse();
    if(!data.length)return;

    const bw=w/data.length;

    data.forEach((f,i)=>{
        const s=f.severity||'low';
        const bh={critical:1,high:.75,medium:.5,low:.3}[s]*(h-20);
        const x=i*bw+3,y=h-bh-4;

        const g=ctx.createLinearGradient(0,y,0,h);
        g.addColorStop(0,col[s]);
        g.addColorStop(1,col[s]+'22');

        ctx.fillStyle=g;
        rr(ctx,x,y,bw-6,bh,4);
        ctx.fill();
    });
}

function rr(c,x,y,w,h,r){
    if(w<2*r)r=w/2;
    if(h<2*r)r=h/2;

    c.beginPath();
    c.moveTo(x+r,y);
    c.arcTo(x+w,y,x+w,y+h,r);
    c.arcTo(x+w,y+h,x,y+h,r);
    c.arcTo(x,y+h,x,y,r);
    c.arcTo(x,y,x+w,y,r);
    c.closePath();
}

window.addEventListener('resize',drawSpark);

window.addEventListener('resize',()=>{
    if(currentView==='analytics'&&anaCache){
        drawAnaChart((anaCache.perDay||[]).map(x=>({d:x.d,c:+x.c||0})));
    }
});

$('pSearch').addEventListener('input',renderPlayers);
$('hSearch').addEventListener('input',renderHistory);

function startPolling(){
    stopPolling();
    pollTimer=setInterval(refreshAll,5000);
}

function stopPolling(){
    if(pollTimer)clearInterval(pollTimer);
}

// ============================================================
// SETTINGS (everything configurable from the dashboard)
// ============================================================

const ACTIONS=['ban','kick','warn','none'];

const DET_INFO={
    Aimbot:'Automatically aims at opponents (Aimbot).',
    Triggerbot:'Automatically shoots when the crosshair is over a player.',
    ExplosiveAmmo:'Explosive ammunition detected.',
    RapidFire:'Weapon firing rate is impossibly fast.',
    GodMode:'Invulnerability, excessive health or armour.',
    Invisible:'Player has made themselves invisible.',
    SuperJump:'Unusually high jump height.',
    FastRun:'Movement speed is too fast.',
    FastSwim:'Swimming speed is too fast.',
    NoClip:'Movement through walls or flying (NoClip).',
    SpeedHack:'Artificially accelerated movement.',
    Teleport:'Instant movement over a large distance.',
    Ragdoll:'Ragdoll abuse detected.',
    SpawnVehicle:'Unauthorised vehicle spawning.',
    SpawnObject:'Unauthorised object spawning.',
    SpawnPed:'Unauthorised ped spawning.',
    SpawnLimit:'Too many entities created in a short period (flooding).',
    GiveWeapon:'Player has given themselves a weapon.',
    BlacklistWeapon:'Blacklisted weapon detected.',
    InfiniteAmmo:'Unlimited ammunition detected.',
    WeaponDamageMod:'Modified weapon damage detected.',
    IllegalExplosion:'Prohibited or impossible explosion type.',
    EntitySpam:'Entity spam used to cause lag.',
    Blips:'Unauthorised map blips.',
    ExtendedRadar:'Artificially extended radar range.',
    NightVision:'Night vision activated.',
    ThermalVision:'Thermal vision activated.',
    ResourceStop:'A protected resource has been stopped.',
    ResourceStart:'An unexpected resource has been started.',
    MenuInject:'Mod menu injection detected.',
    LuaExecutor:'Lua executor or script injection detected.',
    Spectate:'Player is secretly spectating other players.',
    BlacklistCommand:'Prohibited console command executed.',
    PlayerBlips:'ESP: displays all players on the map.',
    VehicleGodMode:'Indestructible or self-repairing vehicle.',
    VehicleSpeedHack:'Vehicle travelling faster than physically possible.',
    PlayerModel:'Prohibited or animal player model (model swap).',
    InvincibleFlag:'Native invincibility flag detected.',
    NoRagdoll:'Ragdoll permanently disabled.',
    WeaponClipMod:'Increased weapon magazine size (clip modification).'
};

function sw(path,val){
    return `<label class="switch">
        <input type="checkbox" data-k="${path}" data-t="bool" ${val?'checked':''}>
        <span class="slider"></span>
    </label>`;
}

function inp(path,val,type){
    return `<input class="sin" data-k="${path}" data-t="${type==='number'?'num':'str'}" type="${type||'text'}" value="${esc(val)}">`;
}

function sel(path,val){
    return `<select class="sin" data-k="${path}" data-t="str">
        ${ACTIONS.map(a=>`<option value="${a}" ${a===val?'selected':''}>${actDE(a)}</option>`).join('')}
    </select>`;
}

function frow(label,control){
    return `<div class="srow"><span class="slabel">${label}</span>${control}</div>`;
}

async function loadSettings(){
    const r=await api('settings');
    const s=(r.status===200&&r.body.settings)?r.body.settings:null;

    $('setSource').textContent=(r.body&&r.body.source==='fivem')
        ?'Live from server'
        :'Saved (server offline)';

    if(!s){
        $('setBody').innerHTML='<div class="panel"><p class="empty">Could not load settings.</p></div>';
        return;
    }

    settingsCache=s;

    const g=s.general||{},
        t=s.TrustScore||{},
        th=s.Thresholds||{},
        d=s.Discord||{},
        sc=s.Screenshots||{},
        wl=s.Whitelist||{};

    const det=s.Detections||{};

    $('setBody').innerHTML=`
    <div class="set-grid">

      <div class="panel">
        <div class="panel-head"><h3>General</h3></div>
        ${frow('Server Name',inp('general.ServerName',g.ServerName,'text'))}
        ${frow('Default Action',sel('general.DefaultAction',g.DefaultAction))}
        ${frow('Kick Message',inp('general.KickMessage',g.KickMessage,'text'))}
        ${frow('Ban Message',inp('general.BanMessage',g.BanMessage,'text'))}
        ${frow('Menu Key (Keycode)',inp('general.MenuKey',g.MenuKey,'number'))}
        ${frow('Join Grace Period (seconds)',inp('general.JoinGracePeriod',g.JoinGracePeriod,'number'))}
        ${frow('Debug Mode',sw('general.Debug',g.Debug))}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Trust Score</h3></div>
        <p class="setting-help">Every player starts with the configured starting value. Each detection subtracts its configured penalty. If the score reaches the ban threshold, the player is banned. A detection with its own action set to "Ban" can ban immediately regardless of the score. The score is not a probability or proof.</p>
        ${frow('Enabled',sw('TrustScore.Enabled',t.Enabled))}
        ${frow('Starting Value',inp('TrustScore.Start',t.Start,'number'))}
        ${frow('Ban Below',inp('TrustScore.BanBelow',t.BanBelow,'number'))}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Thresholds</h3></div>
        ${frow('Max Running Speed (m/s)',inp('Thresholds.MaxRunSpeed',th.MaxRunSpeed,'number'))}
        ${frow('Max Swimming Speed',inp('Thresholds.MaxSwimSpeed',th.MaxSwimSpeed,'number'))}
        ${frow('Max On-Foot Speed',inp('Thresholds.MaxOnFootSpeed',th.MaxOnFootSpeed,'number'))}
        ${frow('Teleport Distance (m)',inp('Thresholds.TeleportDistance',th.TeleportDistance,'number'))}
        ${frow('Max Entities/Second',inp('Thresholds.MaxEntitiesPerSec',th.MaxEntitiesPerSec,'number'))}
        ${frow('Max Health',inp('Thresholds.MaxHealth',th.MaxHealth,'number'))}
        ${frow('Max Armour',inp('Thresholds.MaxArmour',th.MaxArmour,'number'))}
        ${frow('Minimum Shot Interval (ms)',inp('Thresholds.MinShotIntervalMs',th.MinShotIntervalMs,'number'))}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Discord Logging</h3></div>
        ${frow('Enabled',sw('Discord.Enabled',d.Enabled))}
        ${frow('Webhook (Detections)',inp('Discord.Webhook',d.Webhook,'text'))}
        ${frow('Webhook (Bans)',inp('Discord.BanWebhook',d.BanWebhook,'text'))}
        ${frow('Bot Name',inp('Discord.BotName',d.BotName,'text'))}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Screenshots</h3></div>
        ${frow('Enabled',sw('Screenshots.Enabled',sc.Enabled))}
        ${frow('On Detection',sw('Screenshots.OnDetection',sc.OnDetection))}
        ${frow('Webhook',inp('Screenshots.Webhook',sc.Webhook,'text'))}
        ${frow('Quality (0–1)',inp('Screenshots.Quality',sc.Quality,'number'))}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Whitelist</h3></div>
        ${frow('Enabled',sw('Whitelist.Enabled',wl.Enabled))}
        ${frow('Check ACE Permissions',sw('Whitelist.CheckAce',wl.CheckAce))}
      </div>

    </div>

    <div class="panel no-pad" style="margin-top:16px">
      <div class="panel-head" style="padding:18px 20px 0">
        <h3>Detections</h3>
        <span class="hint">Enabled/Disabled · Action · Penalty</span>
      </div>

      <table class="tbl det-tbl">
        <thead>
            <tr>
                <th>Detection</th>
                <th>Enabled</th>
                <th>Action</th>
                <th>Penalty</th>
            </tr>
        </thead>
        <tbody>
        ${Object.keys(det).map(name=>{
            const c=det[name]||{};
            return `<tr>
                <td>
                    <b>${esc(name)}</b>
                    <div class="cell-sub">${esc(DET_INFO[name]||'')}</div>
                </td>
                <td>${sw('Detections.'+name+'.enabled',c.enabled)}</td>
                <td>${sel('Detections.'+name+'.action',c.action)}</td>
                <td style="width:120px">${inp('Detections.'+name+'.penalty',c.penalty,'number')}</td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;
}

function collectSettings(){
    const out={};

    $('setBody').querySelectorAll('[data-k]').forEach(el=>{
        const parts=el.dataset.k.split('.');
        const t=el.dataset.t;

        let val=t==='bool'
            ?el.checked
            :t==='num'
                ?Number(el.value)
                :el.value;

        if(t==='num'&&Number.isNaN(val))val=0;

        let o=out;

        for(let i=0;i<parts.length-1;i++){
            o[parts[i]]=o[parts[i]]||{};
            o=o[parts[i]];
        }

        o[parts[parts.length-1]]=val;
    });

    return out;
}

$('saveSettings').addEventListener('click',async()=>{
    if(!roleAtLeast('admin'))return toast('Permission denied','err');

    const patch=collectSettings();

    const r=await api('settings',{
        method:'POST',
        body:JSON.stringify(patch)
    });

    if(r.status===200){
        toast(
            'Saved · '+(r.body.fivem==='applied'
                ?'Applied live'
                :'Server offline, saved locally'),
            'ok'
        );
        loadSettings();
    } else {
        toast('Error: '+(r.body.error||'Permission denied'),'err');
    }
});

// ============================================================
// USERS
// ============================================================

async function loadUsers(){
    const r=await api('users');
    const list=(r.status===200&&r.body.users)?r.body.users:[];
    const roles=(r.body&&r.body.roles)||['owner','admin','moderator','viewer'];

    $('uBody').innerHTML=list.map((u,i)=>`
        <tr style="animation-delay:${i*.03}s">
            <td><b>${esc(u.username)}</b></td>
            <td><span class="chip role-${esc(u.role)}">${esc(u.role)}</span></td>
            <td class="cell-sub">${esc(u.createdBy||'—')}</td>
            <td class="cell-sub">${fmtDate(u.createdAt)}</td>
            <td class="row-acts">
                <button class="actbtn" data-pw="${esc(u.username)}">Password</button>
                <button class="actbtn ban" data-del="${esc(u.username)}">Delete</button>
            </td>
        </tr>
    `).join('')||'<tr><td colspan="5" class="empty">No users.</td></tr>';

    $('uBody').querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{
        const username=b.dataset.del;

        openConfirmDialog(
            'Delete user',
            `Are you sure you want to delete "${username}"? This action cannot be undone.`,
            'Delete User',
            async()=>{
                const result=await api('users/delete',{
                    method:'POST',
                    body:JSON.stringify({username})
                });

                if(result.status===200){
                    toast('User deleted','ok');
                    loadUsers();
                    return {ok:true};
                }

                return {
                    ok:false,
                    error:result.body.error||'Could not delete user.'
                };
            }
        );
    }));

    $('uBody').querySelectorAll('[data-pw]').forEach(b=>b.addEventListener('click',()=>{
        const username=b.dataset.pw;

        showModal(`<div class="modal-head">
            <h3>Change Password</h3>
            <button class="modal-x" type="button" aria-label="Close" onclick="closeModal()">✕</button>
        </div>
        <div class="form">
            <p class="dialog-copy">Enter a new password for <b>${esc(username)}</b>.</p>
            <label class="fl" for="f_new_password">
                New Password
                <input id="f_new_password" type="password" autocomplete="new-password" placeholder="New password">
            </label>
            <p id="modalError" class="form-error hidden" role="alert"></p>
            <div class="modal-actions">
                <button class="actbtn" type="button" onclick="closeModal()">Cancel</button>
                <button id="savePassword" class="btn-primary sm" type="button">Save Password</button>
            </div>
        </div>`, 'f_new_password');

        $('savePassword').addEventListener('click',async()=>{
            const password=$('f_new_password').value;

            if(!password.trim()){
                return setFormError('Please enter a new password.','f_new_password');
            }

            const button=$('savePassword');
            button.disabled=true;

            const result=await api('users/password',{
                method:'POST',
                body:JSON.stringify({username,password})
            });

            if(result.status===200){
                closeModal();
                toast('Password changed','ok');
            } else {
                setFormError(result.body.error||'Could not change password.','f_new_password');
                button.disabled=false;
            }
        });
    }));

    window._roles=roles;
}

$('addUserBtn').addEventListener('click',()=>{
    const roles=window._roles||['admin','moderator','viewer'];

    $('modalInner').innerHTML=`
    <div class="modal-head">
        <h3>Add User</h3>
        <button class="modal-x" type="button" aria-label="Close" onclick="closeModal()">✕</button>
    </div>
    <div class="form">
        <label class="fl" for="f_uname">
            Username
            <input id="f_uname" placeholder="e.g. max" autocomplete="username"/>
        </label>

        <label class="fl" for="f_upass">
            Password
            <input id="f_upass" type="password" placeholder="Password" autocomplete="new-password"/>
        </label>

        <label class="fl">
            Role
            <select id="f_urole" class="sin">
                ${roles.filter(r=>r!=='owner').map(r=>`<option value="${r}">${r}</option>`).join('')}
            </select>
        </label>

        <p id="modalError" class="form-error hidden" role="alert"></p>
        <button class="btn-primary" type="button" onclick="submitUser()">Create</button>
    </div>`;

    $('modal').classList.remove('hidden');
    requestAnimationFrame(()=>$('f_uname').focus());
});

window.submitUser=async()=>{
    const b={
        username:$('f_uname').value,
        password:$('f_upass').value,
        role:$('f_urole').value
    };

    if(!b.username.trim()){
        return setFormError('Please enter a username.','f_uname');
    }

    if(!b.password.trim()){
        return setFormError('Please enter a password.','f_upass');
    }

    const r=await api('users',{
        method:'POST',
        body:JSON.stringify(b)
    });

    if(r.status===200){
        toast('User created','ok');
        closeModal();
        loadUsers();
    } else {
        setFormError(r.body.error||'Could not create user.','f_uname');
    }
};

// ============================================================
// WHITELIST (permanent, database)
// ============================================================

async function loadWhitelist(){
    const r=await api('whitelist');
    const list=(r.status===200&&r.body.whitelist)?r.body.whitelist:[];

    $('wlBody').innerHTML=list.map((w,i)=>`
        <tr style="animation-delay:${i*.03}s">
            <td class="cell-sub">${esc(w.license)}</td>
            <td>${esc(w.name||'—')}</td>
            <td class="cell-sub">${esc(w.added_by||'—')}</td>
            <td class="cell-sub">${fmtDate(w.created_at)}</td>
            <td><button class="actbtn ban" data-wl="${esc(w.license)}">Remove</button></td>
        </tr>
    `).join('')||'<tr><td colspan="5" class="empty">No players on the whitelist.</td></tr>';

    $('wlBody').querySelectorAll('[data-wl]').forEach(b=>b.addEventListener('click',()=>{
        const license=b.dataset.wl;

        openConfirmDialog(
            'Remove Whitelist Entry',
            `Are you sure you want to remove player ${license} from the whitelist?`,
            'Remove',
            async()=>{
                const result=await api('removewl',{
                    method:'POST',
                    body:JSON.stringify({license})
                });

                if(result.status===200){
                    toast('Removed from whitelist','ok');
                    loadWhitelist();
                    return {ok:true};
                }

                return {
                    ok:false,
                    error:result.body.error||'Could not remove whitelist entry.'
                };
            }
        );
    }));
}

$('addWlBtn').addEventListener('click',()=>{
    $('modalInner').innerHTML=`
    <div class="modal-head">
        <h3>Whitelist Player</h3>
        <button class="modal-x" type="button" aria-label="Close" onclick="closeModal()">✕</button>
    </div>
    <div class="form">
        <label class="fl" for="f_wllic">
            License <small style="font-weight:400">(license:xxxx…)</small>
            <input id="f_wllic" placeholder="license:0000000000000000"/>
        </label>

        <label class="fl" for="f_wlname">
            Name (optional)
            <input id="f_wlname" placeholder="Player name"/>
        </label>

        <p id="modalError" class="form-error hidden" role="alert"></p>
        <button class="btn-primary" type="button" onclick="submitWl()">Add to Whitelist</button>
    </div>`;

    $('modal').classList.remove('hidden');
    requestAnimationFrame(()=>$('f_wllic').focus());
});

window.submitWl=async()=>{
    const b={
        license:$('f_wllic').value.trim(),
        name:$('f_wlname').value.trim(),
        by:myUser
    };

    if(!b.license){
        return setFormError('Please enter a license.','f_wllic');
    }

    const r=await api('addwl',{
        method:'POST',
        body:JSON.stringify(b)
    });

    if(r.status===200){
        toast('Player whitelisted','ok');
        closeModal();
        loadWhitelist();
    } else {
        setFormError(r.body.error||'Could not add player.','f_wllic');
    }
};

checkAuth();
