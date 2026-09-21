(() => {
  'use strict';

  const STORAGE_KEY = 'miBolsaHoras.v2';
  const LEGACY_KEY = 'miBolsaHoras.v1';
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const MONTHS_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const DAY_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const DAY_TYPES = {work:'Trabajo', vacation:'Vacaciones', holiday:'Festivo', sick:'Baja', leave:'Permiso', other:'No computa'};
  const $ = id => document.getElementById(id);

  const defaultState = {
    version: 2,
    settings: {
      schedule: {0:0,1:480,2:480,3:480,4:480,5:420,6:0},
      openingBalance: 0,
      trackingStartDate: '2026-09-17',
      timemotoUrl: 'https://cloud.timemoto.com'
    },
    records: {
      '2026-09-17': {
        date:'2026-09-17', workedGross:589, breakMinutes:72, absenceMinutes:0, targetMode:'auto', customTarget:0, dayType:'work',
        note:'', extraReason:'', source:'timemoto', sourceFile:'TimeMoto · importación inicial', importedAt:null, employeeName:'', exportBalance:null, remarks:'', comments:'',
        clockings:[
          {in:'08:17',out:'12:58',durationMinutes:281,inOrigin:'Fingerprint',outOrigin:'App',location:'',project:''},
          {in:'14:10',out:'18:06',durationMinutes:235,inOrigin:'Fingerprint',outOrigin:'Fingerprint',location:'',project:''}
        ]
      },
      '2026-09-18': {
        date:'2026-09-18', workedGross:437, breakMinutes:0, absenceMinutes:0, targetMode:'auto', customTarget:0, dayType:'work',
        note:'', extraReason:'', source:'timemoto', sourceFile:'TimeMoto · importación inicial', importedAt:null, employeeName:'', exportBalance:null, remarks:'', comments:'',
        clockings:[{in:'08:45',out:'16:02',durationMinutes:437,inOrigin:'Fingerprint',outOrigin:'Fingerprint',location:'',project:''}]
      }
    },
    lastImportAt: null
  };

  let state = loadState();
  let viewMonth = startOfMonth(new Date());
  let historyFilter = 'all';
  let pendingImport = null;
  let editingDate = null;
  let deferredInstallPrompt = null;
  let timemotoOpened = false;
  let confirmAction = null;

  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function migrateLegacy(saved){
    const out = clone(defaultState);
    out.settings = {...out.settings,...(saved.settings||{}),schedule:{...out.settings.schedule,...((saved.settings||{}).schedule||{})}};
    out.lastImportAt = saved.lastImportAt || null;
    const legacyRecords = Object.entries(saved.records||{});
    if(!legacyRecords.length && Number(saved.settings?.openingBalance)===54 && saved.settings?.trackingStartDate==='2026-09-19'){
      out.settings.openingBalance=0;
      out.settings.trackingStartDate='2026-09-17';
      out.records=clone(defaultState.records);
    }
    for(const [date,r] of legacyRecords){
      out.records[date] = normalizeRecord({
        ...r,
        date,
        dayType:'work',
        note:r.note||'',
        extraReason:r.extraReason||'',
        clockings:r.clockings||[],
        importedAt:r.importedAt||null
      });
    }
    return out;
  }
  function loadState(){
    try{
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if(current){
        return {
          ...clone(defaultState),
          ...current,
          settings:{...clone(defaultState.settings),...(current.settings||{}),schedule:{...clone(defaultState.settings.schedule),...((current.settings||{}).schedule||{})}},
          records:Object.fromEntries(Object.entries(current.records||{}).map(([d,r])=>[d,normalizeRecord({...r,date:d})]))
        };
      }
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if(legacy){ const migrated=migrateLegacy(legacy); localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated)); return migrated; }
    }catch(e){ console.warn('No se pudieron cargar los datos',e); }
    return clone(defaultState);
  }
  function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function normalizeRecord(r){
    return {
      date:r.date,
      workedGross:Number(r.workedGross)||0,
      breakMinutes:Number(r.breakMinutes)||0,
      absenceMinutes:Number(r.absenceMinutes)||0,
      targetMode:r.targetMode||'auto',
      customTarget:Number(r.customTarget)||0,
      dayType:r.dayType||'work',
      note:r.note||'',
      extraReason:r.extraReason||'',
      source:r.source||'manual',
      sourceFile:r.sourceFile||'',
      importedAt:r.importedAt||null,
      employeeName:r.employeeName||'',
      exportBalance:r.exportBalance==null?null:Number(r.exportBalance),
      remarks:r.remarks||'',
      comments:r.comments||'',
      clockings:Array.isArray(r.clockings)?r.clockings:[]
    };
  }

  function parseDuration(v, allowSign=false){
    if(v===null||v===undefined||v==='') return 0;
    if(typeof v==='number') return Math.round(v*24*60);
    let s=String(v).trim().replace(',', '.');
    let sign=1;
    if(s.startsWith('-')){sign=-1;s=s.slice(1)} else if(s.startsWith('+')) s=s.slice(1);
    if(/^\d{1,4}:\d{1,2}(:\d{1,2})?$/.test(s)){
      const p=s.split(':').map(Number); return (allowSign?sign:Math.max(0,sign))*(p[0]*60+p[1]+(p[2]>=30?1:0));
    }
    if(/^\d+(\.\d+)?$/.test(s)) return (allowSign?sign:Math.max(0,sign))*Math.round(parseFloat(s)*60);
    return 0;
  }
  function fmt(mins, signed=false){
    mins=Math.round(Number(mins)||0); const neg=mins<0; const a=Math.abs(mins); const s=neg?'-':(signed?'+':''); return `${s}${Math.floor(a/60)}:${String(a%60).padStart(2,'0')}`;
  }
  function compactDelta(mins){
    mins=Math.round(Number(mins)||0); const s=mins<0?'-':'+'; const a=Math.abs(mins); if(a<60)return `${s}${a}m`; const h=Math.floor(a/60),m=a%60; return `${s}${h}h${m?String(m).padStart(2,'0'):''}`;
  }
  function iso(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function localDate(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d,12); }
  function startOfMonth(d){ return new Date(d.getFullYear(),d.getMonth(),1,12); }
  function dateFromAny(v){
    if(v instanceof Date && !isNaN(v)) return iso(v);
    if(typeof v==='number'){ const base=new Date(Date.UTC(1899,11,30)); base.setUTCDate(base.getUTCDate()+Math.floor(v)); return base.toISOString().slice(0,10); }
    const s=String(v||'').trim(); let m;
    if((m=s.match(/^(\d{4})[-\/.]([01]?\d)[-\/.]([0-3]?\d)$/))) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    if((m=s.match(/^([0-3]?\d)[-\/.]([01]?\d)[-\/.](\d{4})$/))) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    const d=new Date(s); return isNaN(d)?null:iso(d);
  }
  function niceDate(s, long=false){
    const d=localDate(s); return new Intl.DateTimeFormat('es-ES',long?{weekday:'long',day:'numeric',month:'long',year:'numeric'}:{weekday:'short',day:'2-digit',month:'short'}).format(d);
  }
  function mondayOf(d){ const x=new Date(d.getFullYear(),d.getMonth(),d.getDate(),12); const wd=x.getDay(); x.setDate(x.getDate()-(wd===0?6:wd-1)); return x; }
  function targetFor(rec){
    if(rec.targetMode==='zero') return 0;
    if(rec.targetMode==='custom') return Math.max(0,Number(rec.customTarget)||0);
    if(rec.dayType && rec.dayType!=='work') return 0;
    return Number(state.settings.schedule[localDate(rec.date).getDay()]||0);
  }
  function calc(rec){
    const real=Math.max(0,(Number(rec.workedGross)||0)-(Number(rec.breakMinutes)||0));
    const effective=real+Math.max(0,Number(rec.absenceMinutes)||0);
    const target=targetFor(rec);
    return {real,effective,target,delta:effective-target};
  }
  function totalBalance(){ return Number(state.settings.openingBalance||0)+Object.values(state.records).reduce((sum,r)=>sum+calc(r).delta,0); }
  function rangeStats(from,to){
    const out={worked:0,target:0,extra:0,deficit:0,net:0,days:0,breaks:0};
    Object.values(state.records).forEach(r=>{ if(r.date<from||r.date>to)return; const c=calc(r); out.worked+=c.real;out.target+=c.target;out.net+=c.delta;out.days++;out.breaks+=r.breakMinutes||0;if(c.delta>0)out.extra+=c.delta;else out.deficit+=c.delta; });
    return out;
  }
  function monthStats(y,m){ return rangeStats(`${y}-${String(m+1).padStart(2,'0')}-01`,`${y}-${String(m+1).padStart(2,'0')}-31`); }
  function currentWeekStats(){ const mon=mondayOf(new Date()); const sun=new Date(mon);sun.setDate(sun.getDate()+6);return rangeStats(iso(mon),iso(sun)); }
  function recordHasNote(r){ return !!(r.note||r.extraReason||r.remarks||r.comments); }
  function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast._timer); toast._timer=setTimeout(()=>t.classList.remove('show'),2800); }

  function setTab(tab){
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${tab}`));
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    window.scrollTo({top:0,behavior:'smooth'});
    if(tab==='history') renderHistory(); if(tab==='stats') renderStats(); if(tab==='settings') renderSettings();
  }

  function render(){ renderHero();renderCalendar();renderRecent();renderPending();renderHistory();renderStats();renderSettings(); }
  function renderHero(){
    const total=totalBalance(),wk=currentWeekStats(),ms=monthStats(viewMonth.getFullYear(),viewMonth.getMonth());
    $('totalBalance').textContent=fmt(total,true);$('totalBalance').className=`hero-balance ${total>=0?'pos':'neg'}`;
    $('weekBalance').textContent=fmt(wk.net,true);$('weekBalance').className=wk.net>=0?'positive-text':'negative-text';
    $('monthBalance').textContent=fmt(ms.net,true);$('monthBalance').className=ms.net>=0?'positive-text':'negative-text';
    const n=Object.keys(state.records).length;
    $('heroSub').textContent=n?`${n} días registrados · inicio ${niceDate(state.settings.trackingStartDate)}`:`Saldo inicial · desde ${niceDate(state.settings.trackingStartDate)}`;
  }
  function renderPending(){
    const pending=Object.values(state.records).filter(r=>calc(r).delta>0&&!r.extraReason&&r.dayType==='work').sort((a,b)=>a.date.localeCompare(b.date));
    $('pendingReasonsBtn').classList.toggle('hidden',!pending.length); $('pendingReasonsText').textContent=`${pending.length} ${pending.length===1?'extra sin motivo':'extras sin motivo'}`;
    $('pendingReasonsBtn').dataset.first=pending[0]?.date||'';
  }
  function renderCalendar(){
    const y=viewMonth.getFullYear(),m=viewMonth.getMonth(); const today=iso(new Date());
    $('calendarTitle').textContent=`${MONTHS[m]} ${y}`;
    const ms=monthStats(y,m); $('monthWorked').textContent=fmt(ms.worked);$('monthTarget').textContent=fmt(ms.target);$('monthNet').textContent=fmt(ms.net,true);$('monthNet').className=ms.net>=0?'positive-text':'negative-text';$('monthDays').textContent=ms.days;
    const first=new Date(y,m,1,12); const start=new Date(first); const offset=(first.getDay()+6)%7; start.setDate(start.getDate()-offset);
    let html='';
    for(let i=0;i<42;i++){
      const d=new Date(start);d.setDate(start.getDate()+i);const ds=iso(d);const rec=state.records[ds];const outside=d.getMonth()!==m;const weekend=d.getDay()===0||d.getDay()===6;let cls='calendar-day';if(outside)cls+=' outside';if(ds===today)cls+=' today';if(weekend)cls+=' weekend';
      let body='';
      if(rec){ const c=calc(rec);cls+=' has-record '+(c.delta>0?'has-positive':c.delta<0?'has-negative':'has-neutral'); body=`<div class="day-top"><span class="day-num">${d.getDate()}</span><span class="day-status">${escapeHtml(DAY_TYPES[rec.dayType]||'')}</span></div><div class="day-delta ${c.delta>0?'pos':c.delta<0?'neg':''}">${compactDelta(c.delta)}</div><div class="day-hours">${fmt(c.real)} / ${fmt(c.target)}</div>${rec.dayType!=='work'?`<div class="day-type">${escapeHtml(DAY_TYPES[rec.dayType])}</div>`:''}${recordHasNote(rec)?'<i class="note-pin"></i>':''}`;
      }else{
        const scheduled=Number(state.settings.schedule[d.getDay()]||0); const past=ds<today&&ds>=state.settings.trackingStartDate; body=`<div class="day-top"><span class="day-num">${d.getDate()}</span></div>${past&&scheduled>0?'<div class="no-data">Sin datos</div>':''}`;
      }
      html+=`<button class="${cls}" data-date="${ds}" aria-label="${escapeHtml(niceDate(ds,true))}">${body}</button>`;
    }
    $('calendarGrid').innerHTML=html; document.querySelectorAll('.calendar-day').forEach(b=>b.addEventListener('click',()=>openDay(b.dataset.date)));
  }
  function dayRow(r){ const c=calc(r);return `<button class="day-row" data-date="${r.date}"><div class="row-date"><b>${escapeHtml(niceDate(r.date))}</b><small>${escapeHtml(DAY_TYPES[r.dayType]||'Trabajo')} · ${r.source==='timemoto'?'TimeMoto':'Manual'}</small>${r.extraReason?`<span class="row-note">${escapeHtml(r.extraReason)}</span>`:r.note?`<span class="row-note">${escapeHtml(r.note)}</span>`:''}</div><div class="row-metric"><span>Real</span><b>${fmt(c.real)}</b></div><div class="row-metric target"><span>Objetivo</span><b>${fmt(c.target)}</b></div><div class="row-delta ${c.delta>0?'pos':c.delta<0?'neg':''}">${fmt(c.delta,true)}</div></button>`; }
  function bindDayRows(root=document){ root.querySelectorAll('.day-row[data-date]').forEach(b=>b.addEventListener('click',()=>openDay(b.dataset.date))); }
  function renderRecent(){
    const list=Object.values(state.records).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5); $('recentList').innerHTML=list.length?list.map(dayRow).join(''):`<div class="empty-state"><b>Aún no hay días</b>Importa tu próximo Excel de TimeMoto.</div>`;bindDayRows($('recentList'));
  }
  function renderHistory(){
    const q=($('historySearch')?.value||'').trim().toLowerCase(); let list=Object.values(state.records).sort((a,b)=>b.date.localeCompare(a.date));
    list=list.filter(r=>{const c=calc(r);if(historyFilter==='extra'&&c.delta<=0)return false;if(historyFilter==='deficit'&&c.delta>=0)return false;if(historyFilter==='notes'&&!recordHasNote(r))return false;if(q&&!`${r.note} ${r.extraReason} ${r.remarks} ${r.comments} ${DAY_TYPES[r.dayType]||''}`.toLowerCase().includes(q))return false;return true;});
    if(!list.length){$('historyList').innerHTML=`<div class="empty-state"><b>Sin resultados</b>No hay días que coincidan con este filtro.</div>`;return;}
    let html='',last='';for(const r of list){const key=r.date.slice(0,7);if(key!==last){const [y,m]=key.split('-').map(Number);html+=`<div class="history-group">${MONTHS[m-1]} ${y}</div>`;last=key}html+=dayRow(r)}$('historyList').innerHTML=html;bindDayRows($('historyList'));
  }
  function renderStats(){
    const years=[...new Set(Object.keys(state.records).map(d=>Number(d.slice(0,4))))].sort((a,b)=>b-a);if(!years.includes(new Date().getFullYear()))years.unshift(new Date().getFullYear());const sel=$('statsYear');const current=Number(sel.value)||years[0];sel.innerHTML=years.map(y=>`<option ${y===current?'selected':''}>${y}</option>`).join('');const y=Number(sel.value);
    const ys=rangeStats(`${y}-01-01`,`${y}-12-31`);$('statsWorked').textContent=fmt(ys.worked);$('statsExtra').textContent=fmt(ys.extra,true);$('statsDeficit').textContent=ys.deficit===0?'0:00':fmt(ys.deficit,true);$('statsNet').textContent=fmt(ys.net,true);$('statsNet').className=ys.net>=0?'positive-text':'negative-text';
    const months=Array.from({length:12},(_,m)=>monthStats(y,m));const max=Math.max(1,...months.map(x=>Math.abs(x.net)));
    $('monthlyChart').innerHTML=months.map((s,m)=>{const pct=Math.min(50,Math.abs(s.net)/max*50);return `<div class="bar-row"><span>${MONTHS_SHORT[m]}</span><div class="bar-track">${s.net?`<i class="bar-fill ${s.net>=0?'pos':'neg'}" style="width:${pct}%"></i>`:''}</div><b class="bar-value ${s.net>0?'positive-text':s.net<0?'negative-text':''}">${fmt(s.net,true)}</b></div>`}).join('');
    $('monthlyTable').innerHTML=months.map((s,m)=>`<div class="month-row"><b>${MONTHS[m]}</b><span>${fmt(s.worked)}</span><span>${s.days} d</span><span class="${s.net>0?'positive-text':s.net<0?'negative-text':''}">${fmt(s.net,true)}</span></div>`).join('');
  }
  function renderSettings(){
    const labels=[['L',1],['M',2],['X',3],['J',4],['V',5],['S',6],['D',0]]; $('scheduleGrid').innerHTML=labels.map(([l,d])=>`<label class="schedule-item"><span>${l}</span><input data-day="${d}" value="${fmt(state.settings.schedule[d])}" inputmode="numeric"></label>`).join('');
    $('settingOpening').value=fmt(state.settings.openingBalance,true);$('settingStart').value=state.settings.trackingStartDate;$('settingTimemotoUrl').value=state.settings.timemotoUrl;$('openTimemotoLink').href=state.settings.timemotoUrl;
  }

  function openDay(date){
    editingDate=date;const existing=state.records[date];const rec=existing?clone(existing):normalizeRecord({date,dayType:'work',targetMode:'auto'});const c=calc(rec);
    $('dayEyebrow').textContent=existing?'Detalle diario':'Nuevo día';$('dayTitle').textContent=niceDate(date,true);$('dDate').value=date;$('dType').value=rec.dayType;$('dWorked').value=fmt(rec.workedGross);$('dBreak').value=fmt(rec.breakMinutes);$('dAbsence').value=fmt(rec.absenceMinutes);$('dTargetMode').value=rec.targetMode;$('dCustomTarget').value=fmt(rec.customTarget);$('dExtraReason').value=rec.extraReason||'';$('dNote').value=rec.note||'';$('customTargetField').classList.toggle('hidden',rec.targetMode!=='custom');$('deleteDayBtn').classList.toggle('hidden',!existing);
    $('daySummary').innerHTML=`<div><span>Trabajo real</span><b>${fmt(c.real)}</b></div><div><span>Objetivo</span><b>${fmt(c.target)}</b></div><div><span>Saldo</span><b class="${c.delta>0?'positive-text':c.delta<0?'negative-text':''}">${fmt(c.delta,true)}</b></div><div><span>Break</span><b>${fmt(rec.breakMinutes)}</b></div>`;
    if(rec.clockings?.length){$('clockingsBox').classList.remove('hidden');$('clockingsList').innerHTML=rec.clockings.map(x=>`<div class="clocking-row"><div><b>${escapeHtml(x.in||'—')} → ${escapeHtml(x.out||'—')}</b><span>${x.inOrigin||x.outOrigin?` · ${escapeHtml([x.inOrigin,x.outOrigin].filter(Boolean).join(' / '))}`:''}${x.location?` · ${escapeHtml(x.location)}`:''}</span></div><b>${fmt(x.durationMinutes||0)}</b></div>`).join('')}else $('clockingsBox').classList.add('hidden');
    $('daySource').textContent=existing?(rec.source==='timemoto'?`Importado de ${rec.sourceFile||'TimeMoto'}${rec.importedAt?` · ${new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(rec.importedAt))}`:''}`:'Creado manualmente'):'El día se guardará como registro manual.';
    $('dayDialog').showModal();
  }
  function previewDaySummaryFromInputs(){
    const date=$('dDate').value||editingDate||iso(new Date());const temp=normalizeRecord({date,workedGross:parseDuration($('dWorked').value),breakMinutes:parseDuration($('dBreak').value),absenceMinutes:parseDuration($('dAbsence').value),targetMode:$('dTargetMode').value,customTarget:parseDuration($('dCustomTarget').value),dayType:$('dType').value});const c=calc(temp);$('daySummary').innerHTML=`<div><span>Trabajo real</span><b>${fmt(c.real)}</b></div><div><span>Objetivo</span><b>${fmt(c.target)}</b></div><div><span>Saldo</span><b class="${c.delta>0?'positive-text':c.delta<0?'negative-text':''}">${fmt(c.delta,true)}</b></div><div><span>Break</span><b>${fmt(temp.breakMinutes)}</b></div>`;
  }

  function normalizeHeader(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
  function headerIndex(headers, aliases){ const normalized=headers.map(normalizeHeader); for(const a of aliases){const i=normalized.indexOf(normalizeHeader(a));if(i>=0)return i}return -1; }
  function cell(row,i){ return i>=0?row[i]:''; }
  function parseTimeMotoWorkbook(wb,fileName){
    const sheetName=wb.SheetNames.find(n=>normalizeHeader(n)==='timesheet')||wb.SheetNames[0];const matrix=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:false});if(matrix.length<2)throw new Error('El Excel no contiene filas de fichajes.');const h=matrix[0];
    const ix={first:headerIndex(h,['First Name','Nombre']),last:headerIndex(h,['Last Name','Apellidos','Apellido']),date:headerIndex(h,['Date','Fecha']),in:headerIndex(h,['In','Entrada']),inOrigin:headerIndex(h,['In Origin','Origen entrada']),out:headerIndex(h,['Out','Salida']),outOrigin:headerIndex(h,['Out Origin','Origen salida']),duration:headerIndex(h,['Duration','Duración','Duracion']),worked:headerIndex(h,['Worked Hours','Horas trabajadas']),brk:headerIndex(h,['Break','Descanso']),absence:headerIndex(h,['Absence','Ausencia']),balance:headerIndex(h,['Balance','Saldo']),remarks:headerIndex(h,['Remarks','Observaciones']),comments:headerIndex(h,['Comments','Comentarios']),location:headerIndex(h,['Clocking Location','Ubicación de fichaje','Ubicacion de fichaje']),project:headerIndex(h,['Project','Proyecto'])};
    if(ix.date<0||ix.worked<0)throw new Error('No reconozco las columnas Date / Worked Hours de este export.');
    const days=[];let current=null;
    for(let n=1;n<matrix.length;n++){
      const row=matrix[n];const date=dateFromAny(cell(row,ix.date));
      if(date){
        const name=[cell(row,ix.first),cell(row,ix.last)].filter(Boolean).join(' ').trim();
        current=normalizeRecord({date,workedGross:parseDuration(cell(row,ix.worked)),breakMinutes:parseDuration(cell(row,ix.brk)),absenceMinutes:parseDuration(cell(row,ix.absence)),exportBalance:ix.balance>=0?parseDuration(cell(row,ix.balance),true):null,remarks:cell(row,ix.remarks)||'',comments:cell(row,ix.comments)||'',employeeName:name,source:'timemoto',sourceFile:fileName,importedAt:new Date().toISOString(),clockings:[]});days.push(current);
      }
      if(!current)continue; const dur=parseDuration(cell(row,ix.duration)); const inv=cell(row,ix.in),outv=cell(row,ix.out);
      if((inv||outv||dur) && dur>0){current.clockings.push({in:String(inv||''),out:String(outv||''),durationMinutes:dur,inOrigin:String(cell(row,ix.inOrigin)||''),outOrigin:String(cell(row,ix.outOrigin)||''),location:String(cell(row,ix.location)||''),project:String(cell(row,ix.project)||'')});}
    }
    return days.filter(d=>d.date);
  }
  async function handleExcel(file){
    if(!file)return;if(!window.XLSX){toast('No se ha podido cargar el lector de Excel. Revisa la conexión.');return;}
    try{const buffer=await file.arrayBuffer();const wb=XLSX.read(buffer,{type:'array',cellDates:false});let days=parseTimeMotoWorkbook(wb,file.name);if(!days.length)throw new Error('No he encontrado días para importar.');
      const preserved=days.map(d=>{const old=state.records[d.date];return old?normalizeRecord({...d,dayType:old.dayType||'work',targetMode:old.targetMode||'auto',customTarget:old.customTarget||0,note:old.note||'',extraReason:old.extraReason||''}):d});days=preserved;
      const before=days.filter(d=>d.date<state.settings.trackingStartDate).length;const eligible=days.filter(d=>d.date>=state.settings.trackingStartDate);if(!eligible.length)throw new Error(`Todos los días son anteriores al inicio (${state.settings.trackingStartDate}).`);pendingImport={file,days:eligible,before};showImportPreview();}
    catch(e){console.error(e);toast(e.message||'No he podido leer este Excel.');}
  }
  function showImportPreview(){
    const days=pendingImport.days;let net=0,worked=0,newN=0,upd=0;days.forEach(d=>{const c=calc(d);net+=c.delta;worked+=c.real;if(state.records[d.date])upd++;else newN++;});const dates=days.map(d=>d.date).sort();const employee=days.find(d=>d.employeeName)?.employeeName||'TimeMoto';$('previewTitle').textContent=pendingImport.file.name;$('previewSummary').innerHTML=`<div><span>Empleado</span><b>${escapeHtml(employee)}</b></div><div><span>Período</span><b>${escapeHtml(niceDate(dates[0]))}<br>${escapeHtml(niceDate(dates.at(-1)))}</b></div><div><span>Días</span><b>${days.length}</b></div><div><span>Saldo del lote</span><b class="${net>=0?'positive-text':'negative-text'}">${fmt(net,true)}</b></div>`;
    $('previewDays').innerHTML=days.sort((a,b)=>a.date.localeCompare(b.date)).map(d=>{const c=calc(d);return `<div class="preview-day"><div><b>${escapeHtml(niceDate(d.date))}</b><small>${fmt(c.real)} trabajadas · ${fmt(d.breakMinutes)} break</small></div><span class="tag">${state.records[d.date]?'Actualizar':'Nuevo'}</span><span class="delta ${c.delta>=0?'positive-text':'negative-text'}">${fmt(c.delta,true)}</span></div>`}).join('')+(pendingImport.before?`<div class="microcopy">${pendingImport.before} días anteriores al inicio se ignorarán.</div>`:'');$('importPreviewDialog').showModal();
  }
  function commitImport(){
    if(!pendingImport)return;let n=0;for(const r of pendingImport.days){state.records[r.date]=normalizeRecord(r);n++;}state.lastImportAt=new Date().toISOString();saveState();$('importPreviewDialog').close();$('timemotoDialog').close();const dates=pendingImport.days.map(d=>d.date).sort();viewMonth=startOfMonth(localDate(dates.at(-1)));pendingImport=null;render();toast(`${n} ${n===1?'día importado':'días importados'} correctamente`);
  }

  function saveDay(e){
    e.preventDefault();const newDate=$('dDate').value;if(!newDate)return;const old=editingDate?state.records[editingDate]:null;const rec=normalizeRecord({...old,date:newDate,workedGross:parseDuration($('dWorked').value),breakMinutes:parseDuration($('dBreak').value),absenceMinutes:parseDuration($('dAbsence').value),targetMode:$('dTargetMode').value,customTarget:parseDuration($('dCustomTarget').value),dayType:$('dType').value,extraReason:$('dExtraReason').value.trim(),note:$('dNote').value.trim(),source:old?.source||'manual',sourceFile:old?.sourceFile||'',clockings:old?.clockings||[]});if(editingDate&&editingDate!==newDate)delete state.records[editingDate];state.records[newDate]=rec;saveState();$('dayDialog').close();viewMonth=startOfMonth(localDate(newDate));render();toast('Día guardado');
  }
  function requestConfirm(title,text,action){$('confirmTitle').textContent=title;$('confirmText').textContent=text;confirmAction=action;$('confirmDialog').showModal();}

  function saveSettings(){
    document.querySelectorAll('#scheduleGrid input[data-day]').forEach(inp=>state.settings.schedule[inp.dataset.day]=parseDuration(inp.value));state.settings.openingBalance=parseDuration($('settingOpening').value,true);state.settings.trackingStartDate=$('settingStart').value||state.settings.trackingStartDate;state.settings.timemotoUrl=$('settingTimemotoUrl').value.trim()||'https://cloud.timemoto.com';saveState();render();toast('Ajustes guardados');
  }
  function downloadBlob(name,content,type){const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function exportBackup(){downloadBlob(`mi-bolsa-backup-${iso(new Date())}.json`,JSON.stringify(state,null,2),'application/json');}
  async function importBackup(file){try{const data=JSON.parse(await file.text());if(!data||!data.settings||!data.records)throw new Error('Formato no válido');state={...clone(defaultState),...data,settings:{...clone(defaultState.settings),...data.settings,schedule:{...clone(defaultState.settings.schedule),...(data.settings.schedule||{})}},records:Object.fromEntries(Object.entries(data.records||{}).map(([d,r])=>[d,normalizeRecord({...r,date:d})]))};saveState();render();toast('Copia restaurada');}catch(e){toast('No he podido restaurar esa copia');}}
  function exportCsv(){
    const rows=[['Fecha','Tipo','Trabajo real','Objetivo','Saldo','Break','Ausencia','Motivo extra','Nota','Origen']];Object.values(state.records).sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>{const c=calc(r);rows.push([r.date,DAY_TYPES[r.dayType]||r.dayType,fmt(c.real),fmt(c.target),fmt(c.delta,true),fmt(r.breakMinutes),fmt(r.absenceMinutes),r.extraReason,r.note,r.source==='timemoto'?r.sourceFile:'Manual'])});const csv='\ufeff'+rows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');downloadBlob(`mi-bolsa-historico-${iso(new Date())}.csv`,csv,'text/csv;charset=utf-8');
  }

  function openTimemotoWizard(){ $('openTimemotoLink').href=state.settings.timemotoUrl;$('timemotoStatus').textContent='Listo para abrir TimeMoto.';$('timemotoDialog').showModal(); }
  function chooseExcel(){ $('excelInput').value='';$('excelInput').click(); }
  function setupInstall(){
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('installHelp').textContent='Instala Mi Bolsa para abrirla desde tu pantalla de inicio.';});
    $('installBtn').addEventListener('click',async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;return;}const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);toast(ios?'En Safari: Compartir → Añadir a pantalla de inicio':'Usa el menú del navegador → Instalar aplicación / Añadir a pantalla de inicio');});
  }
  function setupLaunchQueue(){
    if('launchQueue' in window){window.launchQueue.setConsumer(async params=>{const handles=params.files||[];if(handles[0]){try{const f=await handles[0].getFile();await handleExcel(f)}catch(e){console.warn(e)}}});}
  }

  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
  $('prevMonth').addEventListener('click',()=>{viewMonth=new Date(viewMonth.getFullYear(),viewMonth.getMonth()-1,1,12);renderHero();renderCalendar()});
  $('nextMonth').addEventListener('click',()=>{viewMonth=new Date(viewMonth.getFullYear(),viewMonth.getMonth()+1,1,12);renderHero();renderCalendar()});
  $('todayBtn').addEventListener('click',()=>{viewMonth=startOfMonth(new Date());renderHero();renderCalendar()});
  ['timemotoBtn','heroImportBtn','historyImportBtn','settingsTimemotoBtn'].forEach(id=>$(id).addEventListener('click',openTimemotoWizard));
  $('quickAddBtn').addEventListener('click',()=>openDay(iso(new Date())));
  $('chooseAfterTimemotoBtn').addEventListener('click',chooseExcel);
  $('excelInput').addEventListener('change',e=>handleExcel(e.target.files[0]));
  $('openTimemotoLink').addEventListener('click',()=>{timemotoOpened=true;$('timemotoStatus').textContent='TimeMoto abierto. Exporta el Excel y vuelve a esta ventana.';});
  window.addEventListener('focus',()=>{if(timemotoOpened&&$('timemotoDialog').open){$('timemotoStatus').textContent='Has vuelto de TimeMoto. Si ya exportaste, pulsa “Elegir Excel descargado”.';timemotoOpened=false;}});
  $('dropZone').addEventListener('dragover',e=>{e.preventDefault();$('dropZone').classList.add('drag')});$('dropZone').addEventListener('dragleave',()=> $('dropZone').classList.remove('drag'));$('dropZone').addEventListener('drop',e=>{e.preventDefault();$('dropZone').classList.remove('drag');handleExcel(e.dataTransfer.files[0])});
  document.addEventListener('dragover',e=>{if([...e.dataTransfer?.types||[]].includes('Files'))e.preventDefault()});document.addEventListener('drop',e=>{if(!$('timemotoDialog').open&&e.dataTransfer?.files?.length){e.preventDefault();handleExcel(e.dataTransfer.files[0])}});
  $('confirmImportBtn').addEventListener('click',commitImport);
  $('dayForm').addEventListener('submit',saveDay);['dWorked','dBreak','dAbsence','dCustomTarget','dType','dTargetMode'].forEach(id=>$(id).addEventListener('input',previewDaySummaryFromInputs));$('dTargetMode').addEventListener('change',()=>{$('customTargetField').classList.toggle('hidden',$('dTargetMode').value!=='custom');previewDaySummaryFromInputs()});
  $('deleteDayBtn').addEventListener('click',()=>requestConfirm('Eliminar día',`¿Quieres eliminar ${niceDate(editingDate,true)} del histórico?`,()=>{delete state.records[editingDate];saveState();$('dayDialog').close();render();toast('Día eliminado')}));
  $('confirmDangerBtn').addEventListener('click',()=>{const fn=confirmAction;confirmAction=null;$('confirmDialog').close();if(fn)fn()});
  $('pendingReasonsBtn').addEventListener('click',()=>{const d=$('pendingReasonsBtn').dataset.first;if(d)openDay(d)});
  $('historySearch').addEventListener('input',renderHistory);$('historyFilters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;historyFilter=b.dataset.filter;document.querySelectorAll('#historyFilters .chip').forEach(x=>x.classList.toggle('active',x===b));renderHistory()});
  $('statsYear').addEventListener('change',renderStats);$('saveSettingsBtn').addEventListener('click',saveSettings);$('exportBackupBtn').addEventListener('click',exportBackup);$('importBackupBtn').addEventListener('click',()=>{$('backupInput').value='';$('backupInput').click()});$('backupInput').addEventListener('change',e=>importBackup(e.target.files[0]));$('exportCsvBtn').addEventListener('click',exportCsv);$('resetBtn').addEventListener('click',()=>requestConfirm('Restablecer la app','Se eliminarán los cambios, días y notas añadidos y volverás al estado inicial: 17/09 +37 min, 18/09 +17 min y bolsa +0:54.',()=>{localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(LEGACY_KEY);state=clone(defaultState);saveState();viewMonth=startOfMonth(new Date());render();toast('Datos borrados')}));

  setupInstall();setupLaunchQueue();if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});render();
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
})();
