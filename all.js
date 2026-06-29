

/* Firebase config carregado por variável de ambiente Netlify */
let firebaseConfig = null;

async function carregarFirebaseConfigSeguro(){
  try{
    const r = await fetch("/.netlify/functions/firebase-config");
    if(!r.ok) throw new Error("Config Firebase não encontrada");
    firebaseConfig = await r.json();
    return firebaseConfig;
  }catch(e){
    console.warn("Firebase não configurado por ambiente:", e.message);
    return null;
  }
}

let cloudRef=null, cloudReady=false, applyingRemote=false, unsubscribeCloud=null;
let firebaseInitDone=false;
async function initFirebaseHealthOS(){
  const st=document.getElementById('saveStatus');
  if(st) st.innerText='Abrindo dados...';
  try{
    const cfg = await carregarFirebaseConfigSeguro();
    if(cfg && window.firebase){
      if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg);
      try{ await firebase.firestore().enablePersistence({synchronizeTabs:true}); }catch(_e){}
      cloudRef=firebase.firestore().collection('health_app').doc('main');
      firebaseInitDone=true;
      console.log('Firebase conectado em: health_app/main');
      if(st) st.innerText='Firebase conectado • carregando nuvem...';
      return true;
    }
  }catch(e){
    console.error('Erro ao iniciar Firebase:', e);
  }
  firebaseInitDone=true;
  cloudRef=null;
  if(st) st.innerText='Modo local pronto';
  return false;
}
const KEY='saude_daniel_v2';
const TZ='America/Sao_Paulo';
function nowSP(){return new Date();}
function today(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(nowSP());
}
function timeSP(){
  return new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(nowSP());
}
function dateTimeSP(){
  return new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,dateStyle:'short',timeStyle:'medium'}).format(nowSP());
}
const ym=()=>today().slice(0,7); const brDate=d=>d?d.split('-').reverse().join('/'):'';
function dateKeyOffsetSP(days){
  const base=parseLocalDateSP(today());
  base.setDate(base.getDate()+days);
  return `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}-${String(base.getDate()).padStart(2,'0')}`;
}
function yesterday(){return dateKeyOffsetSP(-1)}
const tabs=[['home','Início'],['exames','Exames'],['alimentacao','Alimentação'],['academia','Academia'],['peso','Peso'],['avatar','Avatar'],['cargas','Cargas'],['suplementos','Suplementos'],['cardio','Cardio'],['sol','Sol'],['sono','Sono'],['tarefas','Tarefas'],['roda','Roda da Vida'],['relatorios','Relatórios'],['backup','Backup']];
let charts={}, undoStack=[], saveTimer=null, autoSaveInterval=null, autoBackupInterval=null, autoBackupTimer=null;
let db=JSON.parse(localStorage.getItem(KEY)||'null')||{profile:{name:'Daniel',protein:160,carbs:320,fat:80,water:3,goalWeight:90,height:1.78},exams:[],meals:{},mealTimes:['09:00','12:00','15:00','18:00','21:00'],gym:{},weights:[],measures:[],loads:[],supplements:{},cardio:{},sun:{},sleep:{},tasks:[],wheel:[],monthlyReports:{},lastMonth:ym(),lastSaved:''};
function migrate(){db.profile={water:3,goalWeight:90,height:1.78,protein:160,carbs:320,fat:80,calories:0,name:'Daniel',bf:18,cardioMin:25,cardioMax:45,...db.profile}; if(!db.profile.calories) db.profile.calories=Math.round(db.profile.protein*4+db.profile.carbs*4+db.profile.fat*9); db.wheel ||= []; db.measures ||= []; db.tasks ||= []; db.lastSaved ||= ''; db.foodCustom ||= {}; db.dailyBackups ||= {}; db.dailyFoodReports ||= {}; db.lastAppDate ||= today(); db.exams ||= []; db.avatar ||= {style:'auto'}; db.bodyPhotos ||= [];} migrate();
function calcMacrosByWeight(){
  let target=Number(db.profile.goalWeight||idealWeight()||latestWeight()||80);
  db.profile.protein=Math.round(target*2);
  db.profile.carbs=Math.round(target*4);
  db.profile.fat=Math.round(target*0.9);
  db.profile.water=3;
  db.profile.calories=Math.round(db.profile.protein*4+db.profile.carbs*4+db.profile.fat*9);
}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)} function val(id){return document.getElementById(id)?.value||''} function num(id){return Number(val(id)||0)} function pct(a,b){return b?Math.min(100,Math.round(a/b*100)):0} function daysWeek(){return ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']} function parseLocalDateSP(str){const [y,m,d]=String(str||today()).split('-').map(Number);return new Date(y,(m||1)-1,d||1,12,0,0)} function keyWeek(){let d=parseLocalDateSP(today());let day=d.getDay()||7;d.setDate(d.getDate()-day+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`} function dayIndexSP(){return ((parseLocalDateSP(today()).getDay()+6)%7)}
function pushUndo(){undoStack.push(JSON.stringify(db)); if(undoStack.length>10)undoStack.shift()}
function save(auto=true){
  if(applyingRemote) return;
  db.lastSaved=dateTimeSP();
  db.updatedAtMs=Date.now();
  localStorage.setItem(KEY,JSON.stringify(db));
  // backup local imediato, separado do banco principal
  localStorage.setItem(KEY+'_backup_atual', JSON.stringify({createdAt:db.lastSaved, updatedAtMs:db.updatedAtMs, data:db}));
  let st=document.getElementById('saveStatus');
  if(st) st.innerText='Último salvamento: '+db.lastSaved+(cloudRef?' • enviando nuvem...':' • local');
  if(cloudRef){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>cloudRef.set({data:db,updatedAtMs:db.updatedAtMs,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
      .then(()=>{cloudReady=true;let st=document.getElementById('saveStatus'); if(st) st.innerText='Último salvamento: '+db.lastSaved+' • nuvem sincronizada';})
      .catch(e=>{let st=document.getElementById('saveStatus'); if(st) st.innerText='Salvo local • Firebase bloqueado nas regras'; console.error('Erro Firebase:',e);}), auto?700:0)
  }
}
function cloudBackupNow(){
  try{
    const stamp=dateTimeSP();
    const payload={createdAt:stamp,updatedAtMs:Date.now(),data:JSON.parse(JSON.stringify(db))};
    localStorage.setItem(KEY+'_backup_5min', JSON.stringify(payload));
    db.lastBackup5min=stamp;
    if(cloudRef && firebase && firebase.firestore){
      clearTimeout(autoBackupTimer);
      autoBackupTimer=setTimeout(()=>{
        firebase.firestore().collection('health_app_backups').doc('backup_atual_5min').set({
          ...payload,
          serverAt:firebase.firestore.FieldValue.serverTimestamp()
        },{merge:true}).catch(e=>console.warn('Backup 5min falhou:', e));
      }, 150);
    }
  }catch(e){ console.warn('Backup 5min local falhou:', e); }
}
function startAutoSaveAndBackup(){
  if(autoSaveInterval) clearInterval(autoSaveInterval);
  if(autoBackupInterval) clearInterval(autoBackupInterval);
  autoSaveInterval=null;
  // Salva quando existe alteração real; não fica gravando sozinho de 10 em 10 segundos.
  document.addEventListener('change',()=>setTimeout(()=>{ if(!applyingRemote) save(true); },120),true);
  document.addEventListener('input',()=>{ clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ if(!applyingRemote) save(true); },900); },true);
  // Backup completo local + nuvem a cada 5 minutos para economizar Firestore.
  autoBackupInterval=setInterval(()=>{ if(!applyingRemote) cloudBackupNow(); },5*60*1000);
  window.addEventListener('beforeunload',()=>{ try{ checkDayRollover(); localStorage.setItem(KEY,JSON.stringify(db)); cloudBackupNow(); }catch(e){} });
  setInterval(()=>{ try{ checkDayRollover(); renderHome(); }catch(e){} },30*1000);
}
function manualSave(){save(false);alert('Alterações salvas. Se aparecer “nuvem sincronizada”, celular e PC vão compartilhar os mesmos dados.')} function undoLast(){let s=undoStack.pop(); if(!s){alert('Nada para desfazer.');return;} db=JSON.parse(s);save();renderAll()}
async function loadCloud(){
  renderTabs();
  if(!cloudRef){let st=document.getElementById('saveStatus'); if(st) st.innerText='Modo local pronto'; renderAll();return}
  try{
    let snap=await cloudRef.get();
    if(snap.exists&&snap.data().data){
      let remote=snap.data().data;
      let rTime=Number(snap.data().updatedAtMs||remote.updatedAtMs||0);
      let lTime=Number(db.updatedAtMs||0);
      if(rTime>=lTime){db=remote;migrate();localStorage.setItem(KEY,JSON.stringify(db));}
      else{save(false)}
    }else{save(false)}
    if(unsubscribeCloud) unsubscribeCloud();
    unsubscribeCloud=cloudRef.onSnapshot(s=>{
      if(!s.exists||!s.data().data) return;
      let remote=s.data().data;
      let rTime=Number(s.data().updatedAtMs||remote.updatedAtMs||0);
      let lTime=Number(db.updatedAtMs||0);
      if(rTime>lTime){
        applyingRemote=true;
        db=remote;migrate();localStorage.setItem(KEY,JSON.stringify(db));
        let st=document.getElementById('saveStatus'); if(st) st.innerText='Atualizado pela nuvem: '+(db.lastSaved||dateTimeSP());
        renderAll();
        applyingRemote=false;
      }
    },e=>{let st=document.getElementById('saveStatus'); if(st) st.innerText='Firebase bloqueado nas regras'; console.error('Listener Firebase:',e);});
  }catch(e){let st=document.getElementById('saveStatus'); if(st) st.innerText='Salvo local • Firebase bloqueado nas regras'; console.error(e)}
  checkDayRollover();
  renderAll();
  {let st=document.getElementById('saveStatus'); if(st && (st.innerText==='Carregando...' || st.innerText==='Abrindo dados...' || st.innerText.includes('carregando'))) st.innerText=cloudRef?'Nuvem pronta':'Modo local pronto';}
}
function change(fn){pushUndo();fn();save();renderAll()}
function renderTabs(){document.getElementById('tabs').innerHTML=tabs.map(t=>`<button class="tab ${t[0]=='home'?'active':''}" onclick="openTab('${t[0]}')">${t[1]}</button>`).join('')} function openTab(id){document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');document.querySelectorAll('.tab').forEach((b,i)=>b.classList.toggle('active',tabs[i][0]==id));renderAll(false)}
function renderAll(){renderHome();renderExams();renderFood();renderGym();renderWeight();renderAvatar();renderLoads();renderSupps();renderCardio();renderSun();renderSleep();renderTasks();renderWheel();renderReports();renderBackup();}
function score(){let f=foodToday(),t=totalsFood(),wk=keyWeek(),d=daysWeek()[dayIndexSP()];let pts=0,max=7;if(t.p>=db.profile.protein*.9)pts++; if(f.water>=db.profile.water)pts++; if(db.gym[wk]?.[d]?.done)pts++; if(db.cardio[wk]?.[d]?.done)pts++; if(db.sleep[wk]?.[d]?.val>=7)pts++; if(db.sun[wk]?.[d]?.done)pts++; if(db.supplements[wk]?.[d+'_Creatina']||db.supplements[wk]?.[d+'_Whey'])pts++; return Math.round(pts/max*10)}
function alerts(){let f=foodToday(),t=totalsFood(),wk=keyWeek(),d=daysWeek()[dayIndexSP()],a=[]; if(!f.items.length)a.push('Você ainda não registrou alimentação hoje.'); if(t.p<db.profile.protein*.8)a.push('Proteína abaixo da meta.'); if(f.water<db.profile.water)a.push('Faltam '+(db.profile.water-f.water).toFixed(1)+'L de água.'); if(!db.gym[wk]?.[d]?.done)a.push('Academia de hoje ainda não marcada.'); if(!db.sleep[wk]?.[d]?.val)a.push('Sono ainda não registrado.'); return a;}
function cardioWeekTotal(){let wk=keyWeek();return daysWeek().reduce((s,d)=>s+Number(db.cardio[wk]?.[d]?.val||0),0)}
function cardioAutoMeta(){
  let atual=Number(latestWeight()||0), meta=Number(db.profile.goalWeight||0);
  if(!atual||!meta) return {daily:30,weekly:210,msg:'Meta padrão até registrar peso atual e meta.'};
  let diff=+(atual-meta).toFixed(1);
  let daily=30, msg='Manutenção/ganho limpo: cardio moderado para saúde e condicionamento.';
  if(diff>8){daily=50;msg='Peso bem acima da meta: cardio mais alto para acelerar perda de gordura.'}
  else if(diff>4){daily=40;msg='Acima da meta: cardio moderado/alto.'}
  else if(diff>1){daily=30;msg='Perto da meta: cardio moderado.'}
  else if(diff>=-3){daily=25;msg='Meta de ganho/volume: cardio leve para saúde sem atrapalhar ganho de peso.'}
  else{daily=20;msg='Abaixo da meta: cardio mínimo para condicionamento, priorizando ganho de peso.'}
  return {daily,weekly:daily*6,diff,msg};
}
function nextExam(){let now=today();return [...db.exams].filter(e=>!e.done&&e.date).sort((a,b)=>a.date.localeCompare(b.date))[0]||null}
function todayTasks(){return [...db.tasks].filter(t=>!t.done&&t.date==today()).sort(sortTasks)}
function foodTotalsForDate(dateKey){
  const m=db.meals?.[dateKey]||{items:[],water:0,check:{}};
  const totals=(m.items||[]).reduce((a,i)=>({p:a.p+Number(i.p||0),c:a.c+Number(i.c||0),g:a.g+Number(i.g||0),k:a.k+Number(i.k||0)}),{p:0,c:0,g:0,k:0});
  return {...totals,water:Number(m.water||0),items:(m.items||[]).length};
}
function registrarDiaAlimentacao(dateKey, overwrite=false){
  if(!dateKey) return;
  db.dailyFoodReports ||= {};
  if(db.dailyFoodReports[dateKey] && !overwrite) return;
  const totals=foodTotalsForDate(dateKey);
  db.dailyFoodReports[dateKey]={date:dateKey,created:dateTimeSP(),totals,snapshot:JSON.parse(JSON.stringify(db.meals?.[dateKey]||{items:[],water:0,check:{}}))};
}
function moverAlimentacaoHojeParaOntem(){
  const hoje=today(), ontem=yesterday();
  const cur=db.meals?.[hoje]||{items:[],water:0,check:{}};
  const old=db.meals?.[ontem]||{items:[],water:0,check:{}};
  if(!(cur.items||[]).length && !Number(cur.water||0)){
    alert('Hoje já está zerado. Não há alimentação para mover.');
    return;
  }
  if(!confirm('Confirmar? Vou registrar todos os alimentos que aparecem hoje na data de ontem e zerar o gráfico de hoje.')) return;
  change(()=>{
    db.meals[ontem]={
      items:[...(old.items||[]),...(cur.items||[])],
      water:Number(old.water||0)+Number(cur.water||0),
      check:{...(old.check||{}),...(cur.check||{})}
    };
    db.meals[hoje]={items:[],water:0,check:{}};
    registrarDiaAlimentacao(ontem,true);
    db.lastAppDate=hoje;
  });
  alert('Pronto: alimentação registrada em '+brDate(ontem)+' e gráfico de hoje zerado.');
}
function autoDailyBackup(){let k=today(); db.dailyBackups ||= {}; db.dailyFoodReports ||= {}; db.lastAppDate ||= k; if(!db.dailyBackups[k]){db.dailyBackups[k]={created:dateTimeSP(),snapshot:JSON.parse(JSON.stringify(db))}; localStorage.setItem(KEY,JSON.stringify(db));}}
function checkDayRollover(force=false){
  const current=today();
  db.lastAppDate ||= current;
  if(force || db.lastAppDate!==current){
    const previous=db.lastAppDate;
    registrarDiaAlimentacao(previous);
    if(!db.dailyBackups[previous]) db.dailyBackups[previous]={created:dateTimeSP(),snapshot:JSON.parse(JSON.stringify(db))};
    db.lastAppDate=current;
    db.meals[current] ||= {items:[],water:0,check:{}};
    save(false);
    renderAll();
  }
}
function renderHome(){let p=db.profile, pending=[...db.tasks].filter(t=>!t.done).sort(sortTasks).slice(0,8), t=totalsFood(), f=foodToday(), nx=nextExam(), tw=todayTasks();document.getElementById('home').innerHTML=`<div class="card"><div class="row"><div class="avatarBox" style="height:100px">${avatarHtml()}</div><div><h2>Olá, ${p.name}</h2><div class="small">Hoje: ${brDate(today())} • ${timeSP()} • Divinópolis/MG</div><span class="pill ok">Nota do dia: ${score()}/10</span><span class="pill">Último salvamento: ${db.lastSaved||'ainda não salvo'}</span></div></div><br><button class="primary" onclick="manualSave()">Salvar alterações agora</button><button onclick="undoLast()">Desfazer última ação</button></div><div class="card"><h2>Dashboard de hoje</h2><div class="grid"><div><b>Peso atual</b><br><span class="pill">${latestWeight()||'-'}kg</span></div><div><b>Meta de peso</b><br><span class="pill">${p.goalWeight}kg</span></div><div><b>Água hoje</b><br><span class="pill">${f.water.toFixed(1)}L / ${p.water}L</span></div><div><b>Proteína hoje</b><br><span class="pill">${t.p.toFixed(1)}g / ${p.protein}g</span></div><div><b>Cardio da semana</b><br><span class="pill">${cardioWeekTotal()} / ${cardioAutoMeta().weekly} min</span></div><div><b>Próximo exame</b><br><span class="pill">${nx?nx.name+' - '+brDate(nx.date):'Nenhum cadastrado'}</span></div><div><b>Tarefas de hoje</b><br><span class="pill">${tw.length} pendente(s)</span></div></div></div><div class="card"><h2>Avisos inteligentes</h2>${alerts().length?alerts().map(x=>`<p class="warn">⚠️ ${x}</p>`).join(''):'<p class="ok">Tudo certo até agora.</p>'}</div><div class="card"><h2>Tarefas pendentes por data e horário</h2>${pending.length?`<table><tr><th>Data</th><th>Horário</th><th>Tarefa</th><th>Prioridade</th></tr>${pending.map(t=>`<tr><td>${brDate(t.date)}</td><td>${t.start||'-'} até ${t.end||'-'}</td><td>${t.title}</td><td>${t.priority}</td></tr>`).join('')}</table>`:'<p class="small">Nenhuma tarefa pendente.</p>'}<br><button onclick="openTab('tarefas')" class="primary">Adicionar tarefa</button></div><div class="card"><h2>Metas principais</h2><span class="pill">Proteína ${p.protein}g</span><span class="pill">Carboidrato ${p.carbs}g</span><span class="pill">Gordura/óleo ${p.fat}g</span><span class="pill">Água ${p.water}L</span><span class="pill">Calorias ${p.calories||Math.round(p.protein*4+p.carbs*4+p.fat*9)} kcal</span><span class="pill">Peso meta ${p.goalWeight}kg</span><span class="pill">BF estimado ${p.bf||'-'}%</span><span class="pill">Cardio meta ${cardioAutoMeta().daily} min/dia</span></div>`}
function renderExams(){let presets=['Hemograma','Testosterona total','Testosterona livre','Estradiol','SHBG','TSH','T3','T4 livre','Vitamina D','Colesterol total','HDL','LDL','Triglicerídeos','Glicose','Insulina','TGO','TGP','Creatinina'];document.getElementById('exames').innerHTML=`<div class="card"><h2>Exames de 6 em 6 meses</h2><p class="small">Cadastre os exames e coloque a data prevista. O painel inicial mostra o próximo vencimento.</p><div class="grid"><input id="exName" placeholder="Exame"><input id="exDate" type="date"><input id="exObs" placeholder="Obs"></div><br><button class="primary" onclick="change(()=>db.exams.push({id:uid(),name:val('exName'),date:val('exDate'),obs:val('exObs'),done:false}))">Adicionar exame</button><button onclick="addPresetExams()">Adicionar lista recomendada</button></div><div class="card"><h2>Lista base sugerida</h2><p class="small">${presets.join(' • ')}</p></div><div class="card"><table><tr><th>Feito</th><th>Exame</th><th>Data</th><th>Obs</th><th></th></tr>${db.exams.map(e=>`<tr><td><input type="checkbox" ${e.done?'checked':''} onchange="change(()=>db.exams.find(x=>x.id=='${e.id}').done=!db.exams.find(x=>x.id=='${e.id}').done)"></td><td class="${e.done?'done':''}">${e.name}</td><td>${brDate(e.date)}</td><td>${e.obs||''}</td><td><button class="mini danger" onclick="change(()=>db.exams=db.exams.filter(x=>x.id!='${e.id}'))">X</button></td></tr>`).join('')}</table></div>`}
function addPresetExams(){let presets=['Hemograma','Testosterona total','Testosterona livre','Estradiol','SHBG','TSH','T3','T4 livre','Vitamina D','Colesterol total','HDL','LDL','Triglicerídeos','Glicose','Insulina','TGO','TGP','Creatinina'];let date=today();change(()=>{presets.forEach(name=>{if(!db.exams.some(e=>e.name==name))db.exams.push({id:uid(),name,date,obs:'Rotina 6 meses',done:false})})})}
const foodDB={'banana':{unit:'unidade',p:1.3,c:27,g:.3,k:105},'doce de leite':{unit:'colher',p:1.2,c:13,g:2,k:70},'arroz':{unit:'colher',p:.7,c:6,g:.1,k:32},'feijao':{unit:'colher',p:1.2,c:4,g:.2,k:25},'frango':{unit:'100g',p:31,c:0,g:3.6,k:165},'carne':{unit:'100g',p:26,c:0,g:10,k:220},'ovo':{unit:'unidade',p:6,c:.6,g:5,k:70},'whey':{unit:'scoop',p:24,c:3,g:2,k:120},'leite':{unit:'copo',p:6,c:9,g:6,k:120},'pao':{unit:'unidade',p:4,c:28,g:2,k:140},'aveia':{unit:'colher',p:2.5,c:10,g:1.5,k:60},'azeite':{unit:'colher',p:0,c:0,g:13.5,k:119},'óleo':{unit:'colher',p:0,c:0,g:14,k:126},'batata doce':{unit:'100g',p:1.6,c:20,g:.1,k:86},'macarrao':{unit:'100g',p:5,c:25,g:1,k:130},'pasta de amendoim':{unit:'colher',p:4,c:3,g:8,k:95}};
function norm(x){return (x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()} function allFoodDB(){return {...foodDB,...(db.foodCustom||{})}} function foodToday(){db.meals[today()] ||= {items:[],water:0,check:{}};return db.meals[today()]} function totalsFood(){return foodToday().items.reduce((a,i)=>({p:a.p+Number(i.p),c:a.c+Number(i.c),g:a.g+Number(i.g),k:a.k+Number(i.k)}),{p:0,c:0,g:0,k:0})}
function renderFood(){let f=foodToday(),t=totalsFood(),p=db.profile,opts=Object.keys(allFoodDB()).sort().map(x=>`<option value="${x}">${x} (${allFoodDB()[x].unit})</option>`).join('');const fixCard=((f.items||[]).length||Number(f.water||0))?`<div class="card warn"><h2>Correção de virada do dia</h2><p>Se esses alimentos são de ontem, clique abaixo para registrar tudo em ${brDate(yesterday())} e deixar o gráfico de hoje zerado.</p><button class="primary" onclick="moverAlimentacaoHojeParaOntem()">Registrar como ontem e zerar hoje</button></div>`:'';document.getElementById('alimentacao').innerHTML=fixCard+`<div class="card"><h2>Metas de alimentação explicadas</h2><p><b>Proteína:</b> ajuda a construir e manter músculo. Meta: ${p.protein}g/dia.</p><p><b>Carboidrato:</b> energia para treino e rotina. Meta: ${p.carbs}g/dia.</p><p><b>Gordura/óleo:</b> hormônios e energia. Meta: ${p.fat}g/dia.</p><p><b>Água:</b> hidratação. Meta fixa: ${p.water}L/dia.</p><p><b>Calorias aproximadas:</b> meta calculada automaticamente pelo peso/meta: ${p.calories||Math.round(p.protein*4+p.carbs*4+p.fat*9)} kcal/dia.</p>${macro('Proteína consumida',t.p,p.protein,'g')}${macro('Carboidrato consumido',t.c,p.carbs,'g')}${macro('Gordura/óleo consumido',t.g,p.fat,'g')}${macro('Água consumida',f.water,p.water,'L')}<p><b>Calorias aproximadas:</b> ${t.k} kcal</p></div><div class="card"><h2>Adicionar refeição</h2><div class="grid"><div><label>Item</label><input id="foodName" list="foodList" placeholder="banana, arroz, frango"><datalist id="foodList">${opts}</datalist></div><div><label>Quantidade</label><input id="foodQtd" type="number" step="0.1" value="1"></div></div><br><button class="primary" onclick="addFood()">Adicionar alimento</button>
<h3>Adicionar refeição avulsa com IA</h3>
<p class="small">Digite o alimento do jeito que você comeu. Exemplo: “200g arroz, 150g frango e 1 concha feijão”. A IA preenche os dados; você confere e aceita para somar nos gráficos.</p>
<div class="grid">
  <input id="aiFoodText" placeholder="Digite o alimento/refeição">
  <button class="primary" onclick="estimateFoodByText()">IA preencher dados</button>
</div>
<div id="aiFoodTextResult" class="small" style="margin-top:12px"></div>
<h3>Adicionar refeição avulsa/manual</h3>
<p class="small">Use quando não quiser usar IA. Exemplo: “Almoço livre” e preencha proteína, carboidrato, gordura/óleo e calorias.</p>
<div class="grid">
  <input id="manualMealName" placeholder="Nome da refeição">
  <input id="manualMealP" type="number" step="0.1" placeholder="Proteína g">
  <input id="manualMealC" type="number" step="0.1" placeholder="Carboidrato g">
  <input id="manualMealG" type="number" step="0.1" placeholder="Gordura/óleo g">
  <input id="manualMealK" type="number" step="1" placeholder="Calorias kcal">
</div><br>
<button onclick="addManualMeal()">Adicionar refeição manual</button>
<h3>Água</h3><div class="row"><input id="waterAdd" type="number" step="0.1" placeholder="Litros" style="max-width:180px"><button onclick="change(()=>foodToday().water+=num('waterAdd'))">Somar água</button></div></div><div class="card"><h2>Cadastrar alimento próprio</h2><p class="small">Use por porção: exemplo banana por unidade, frango por 100g, whey por scoop.</p><div class="grid"><input id="newFoodName" placeholder="Nome"><input id="newFoodUnit" placeholder="Unidade/porção"><input id="newFoodP" type="number" step="0.1" placeholder="Proteína"><input id="newFoodC" type="number" step="0.1" placeholder="Carbo"><input id="newFoodG" type="number" step="0.1" placeholder="Gordura"><input id="newFoodK" type="number" step="1" placeholder="Kcal"></div><br><button onclick="addCustomFood()">Salvar alimento</button></div><div class="card"><h2>Horários de refeições</h2>${db.mealTimes.map(h=>`<label><input type="checkbox" ${f.check[h]?'checked':''} onchange="change(()=>foodToday().check['${h}']=!foodToday().check['${h}'])"> ${h}</label>`).join('')}</div><div class="card"><h2>Comidas registradas</h2><table><tr><th>Alimento</th><th>Qtd</th><th>Proteína</th><th>Carbo</th><th>Gordura</th><th>Kcal</th><th></th></tr>${f.items.map(i=>`<tr><td>${i.name}</td><td>${i.qtd} ${i.unit}</td><td>${i.p}g</td><td>${i.c}g</td><td>${i.g}g</td><td>${i.k}</td><td><button class="mini danger" onclick="change(()=>foodToday().items=foodToday().items.filter(x=>x.id!='${i.id}'))">X</button></td></tr>`).join('')}</table></div>`}
function macro(n,a,b,u){return `<p><b>${n}:</b> ${Number(a).toFixed(1)}${u} / ${b}${u} <span class="pill">faltam ${Math.max(0,b-a).toFixed(1)}${u}</span></p><div class="progress"><div class="bar" style="width:${pct(a,b)}%"></div></div>`} function addFood(){let name=val('foodName'),q=num('foodQtd')||1,item=allFoodDB()[norm(name)]; if(!item){alert('Alimento não encontrado na tabela. Cadastre ele abaixo.');return} change(()=>foodToday().items.push({id:uid(),name,qtd:q,unit:item.unit,p:+(item.p*q).toFixed(1),c:+(item.c*q).toFixed(1),g:+(item.g*q).toFixed(1),k:+(item.k*q).toFixed(0)}))}
let pendingAITextFood=null;
async function estimateFoodByText(){
  const box=document.getElementById('aiFoodTextResult');
  const text=val('aiFoodText');
  if(!text){alert('Digite o alimento ou refeição.');return}
  pendingAITextFood=null;
  box.innerHTML='<span class="pill">IA analisando...</span>';
  try{
    const r=await fetch('/.netlify/functions/analisar-alimento',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto:text})});
    const data=await r.json();
    if(!r.ok||data.error) throw new Error(data.error||'Erro na IA');
    const item={
      name:data.nome||text,
      qtd:data.quantidade||1,
      unit:data.unidade||'estimado',
      p:Number(data.proteina||0),
      c:Number(data.carboidrato||0),
      g:Number(data.gordura||0),
      k:Number(data.calorias||0)
    };
    pendingAITextFood=item;
    box.innerHTML=`<div class="card" style="margin-top:10px"><b>${item.name}</b><br><span class="pill">Qtd: ${item.qtd} ${item.unit}</span><span class="pill">Proteína: ${item.p.toFixed(1)}g</span><span class="pill">Carbo: ${item.c.toFixed(1)}g</span><span class="pill">Gordura: ${item.g.toFixed(1)}g</span><span class="pill">Kcal: ${Math.round(item.k)}</span><p class="small">${data.observacao||'Estimativa feita por IA. Confira antes de aceitar.'}</p><button class="primary" onclick="acceptAITextFood()">Aceitar e somar nos gráficos</button><button onclick="editAITextFood()">Editar manualmente</button></div>`;
  }catch(e){
    box.innerHTML='<b>Erro:</b> '+(e.message||e);
  }
}
function acceptAITextFood(){
  if(!pendingAITextFood){alert('Analise um alimento primeiro.');return}
  const i=pendingAITextFood;
  change(()=>foodToday().items.push({id:uid(),name:i.name,qtd:i.qtd,unit:i.unit,p:+i.p.toFixed(1),c:+i.c.toFixed(1),g:+i.g.toFixed(1),k:+i.k.toFixed(0)}));
  pendingAITextFood=null;
}
function editAITextFood(){
  if(!pendingAITextFood)return;
  document.getElementById('manualMealName').value=pendingAITextFood.name;
  document.getElementById('manualMealP').value=pendingAITextFood.p;
  document.getElementById('manualMealC').value=pendingAITextFood.c;
  document.getElementById('manualMealG').value=pendingAITextFood.g;
  document.getElementById('manualMealK').value=Math.round(pendingAITextFood.k);
  const el=document.getElementById('manualMealName'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'});
}
function addManualMeal(){
  let name=val('manualMealName')||'Refeição manual';
  let p=num('manualMealP'), c=num('manualMealC'), g=num('manualMealG'), k=num('manualMealK');
  if(!k) k=Math.round(p*4+c*4+g*9);
  change(()=>foodToday().items.push({id:uid(),name,qtd:1,unit:'manual',p:+p.toFixed(1),c:+c.toFixed(1),g:+g.toFixed(1),k:+k.toFixed(0)}));
}

function addCustomFood(){let name=norm(val('newFoodName')); if(!name){alert('Digite o nome do alimento.');return} change(()=>{db.foodCustom[name]={unit:val('newFoodUnit')||'porção',p:num('newFoodP'),c:num('newFoodC'),g:num('newFoodG'),k:num('newFoodK')}})}
const treino={Seg:['Peito','Tríceps'],Ter:['Costas','Bíceps'],Qua:['Perna'],Qui:['Folga'],Sex:['Ombro','Peito'],Sáb:['Costas','Bíceps'],Dom:['Livre/Alongamento']};
function renderGym(){let wk=keyWeek();db.gym[wk] ||= {};document.getElementById('academia').innerHTML=`<div class="card"><h2>Academia semanal</h2><p class="small">Não zera automaticamente. A semana fica salva.</p><table><tr><th>Dia</th><th>Treino</th><th>Feito</th><th>Obs</th></tr>${daysWeek().map(d=>`<tr><td>${d}</td><td>${treino[d].join(' + ')}</td><td><input type="checkbox" ${db.gym[wk][d]?.done?'checked':''} onchange="change(()=>{db.gym['${wk}']['${d}'] ||= {};db.gym['${wk}']['${d}'].done=!db.gym['${wk}']['${d}'].done})"></td><td><input value="${db.gym[wk][d]?.obs||''}" onchange="db.gym['${wk}']['${d}'] ||= {};db.gym['${wk}']['${d}'].obs=this.value;save()"></td></tr>`).join('')}</table></div>`}
function idealWeight(){let h=Number(db.profile.height||1.78);return +(22*h*h).toFixed(1)} function latestWeight(){return db.weights.at(-1)?.value||0}
function renderWeight(){let p=db.profile;let photos=(db.bodyPhotos||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));let measures=(db.measures||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));document.getElementById('peso').innerHTML=`<div class="card"><h2>Peso, meta e avaliação física</h2><div class="grid"><div><label>Altura (m)</label><input id="height" type="number" step="0.01" value="${p.height}"></div><div><label>Peso meta desejado (kg)</label><input id="goalWeight" type="number" step="0.1" value="${p.goalWeight}"></div><div><label>Peso atual para registrar (kg)</label><input id="wVal" type="number" step="0.1" value="${latestWeight()||''}"></div><div><label>BF estimado (%)</label><input id="bfVal" type="number" step="0.1" value="${p.bf||''}"></div><div><label>Data</label><input id="wDate" type="date" value="${today()}"></div></div><p class="small">Peso ideal estimado pela sua altura: <b>${idealWeight()}kg</b>. Sua meta pessoal: <b>${p.goalWeight}kg</b>. Ao salvar, o sistema recalcula automaticamente proteína, carboidrato, gordura/óleo, água, calorias aproximadas e meta de cardio para o painel de alimentação.</p><button class="primary" onclick="saveWeightProfile()">Salvar peso e recalcular alimentação</button></div><div class="card"><h2>Medidas corporais</h2><div class="grid"><div><label>Data da medição</label><input id="mDate" type="date" value="${today()}"></div><input id="mBraco" type="number" step="0.1" placeholder="Braço cm"><input id="mTorax" type="number" step="0.1" placeholder="Tórax cm"><input id="mCintura" type="number" step="0.1" placeholder="Cintura cm"><input id="mAbdomen" type="number" step="0.1" placeholder="Abdômen cm"><input id="mCoxa" type="number" step="0.1" placeholder="Coxa cm"><input id="mPant" type="number" step="0.1" placeholder="Panturrilha cm"></div><br><button onclick="saveMeasures()">Salvar medidas</button><p class="small">Registre as medidas sempre com data para comparar sua evolução junto das fotos.</p></div><div class="card"><h2>📸 Fotos corporais para evolução</h2><div class="grid"><div><label>Data que as fotos foram tiradas</label><input id="bodyPhotoDate" type="date" value="${today()}"></div><div><label>Adicionar várias fotos ao mesmo tempo</label><input id="bodyPhotoFiles" type="file" accept="image/*" multiple onchange="previewBodyPhotos()"></div></div><div id="bodyPhotoPreview" class="body-photo-grid"></div><br><button class="primary" onclick="saveBodyPhotos()">Salvar fotos no registro</button><p class="small">Dica: tire fotos de frente, lado e costas, sempre com a mesma luz e distância. O sistema salva as imagens com a data para comparar sua evolução.</p></div><div class="card"><h2>🤖 Análise corporal inteligente</h2><div id="bodyAnalysis">${generateBodyAnalysis()}</div></div><div class="card"><h2>Gráficos de evolução corporal</h2><canvas id="weightChart"></canvas><br><canvas id="measureChart"></canvas></div><div class="card"><h2>Histórico de fotos corporais</h2>${photos.length?`<div class="body-photo-grid">${photos.map(f=>`<div class="body-photo-card"><img src="${f.data}" loading="lazy"><b>${brDate(f.date)}</b><span>${f.name||'Foto corporal'}</span><button class="mini danger" onclick="deleteBodyPhoto('${f.id}')">Excluir</button></div>`).join('')}</div>`:'<p class="small">Nenhuma foto corporal salva ainda.</p>'}</div>`;setTimeout(()=>{chart('weightChart','Peso',db.weights.map(x=>brDate(x.date)),db.weights.map(x=>x.value));renderMeasureChart(measures);},80)}
function saveWeightProfile(){change(()=>{db.profile.height=num('height')||db.profile.height;db.profile.goalWeight=num('goalWeight')||db.profile.goalWeight;db.profile.bf=num('bfVal')||db.profile.bf;calcMacrosByWeight();if(num('wVal')){db.weights.push({date:val('wDate')||today(),value:num('wVal')});db.weights.sort((a,b)=>a.date.localeCompare(b.date))}})} function saveMeasures(){change(()=>db.measures.push({date:val('mDate')||today(),braco:num('mBraco'),torax:num('mTorax'),cintura:num('mCintura'),abdomen:num('mAbdomen'),coxa:num('mCoxa'),panturrilha:num('mPant')}))}

function previewBodyPhotos(){let box=document.getElementById('bodyPhotoPreview'), files=[...(document.getElementById('bodyPhotoFiles')?.files||[])];if(!box)return;box.innerHTML=files.map(f=>`<div class="body-photo-card"><div class="small">${f.name}</div></div>`).join('')||'<p class="small">Nenhuma foto selecionada.</p>'}
function resizeBodyImage(file){return new Promise((resolve,reject)=>{let reader=new FileReader();reader.onload=()=>{let img=new Image();img.onload=()=>{let max=1100,scale=Math.min(1,max/Math.max(img.width,img.height));let canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);let ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/jpeg',.78))};img.onerror=reject;img.src=reader.result};reader.onerror=reject;reader.readAsDataURL(file)})}
async function saveBodyPhotos(){let input=document.getElementById('bodyPhotoFiles'), files=[...(input?.files||[])], date=val('bodyPhotoDate')||today();if(!files.length){alert('Selecione uma ou mais fotos.');return}try{let saved=[];for(const file of files){let data=await resizeBodyImage(file);saved.push({id:uid(),date,name:file.name,data,createdAt:new Date().toISOString()})}pushUndo();db.bodyPhotos ||= [];db.bodyPhotos.push(...saved);save(false);cloudBackupNow();renderWeight();alert(saved.length+' foto(s) salva(s) no registro corporal.')}catch(e){console.error(e);alert('Não consegui salvar as fotos. Tente imagens menores.')}}
function deleteBodyPhoto(id){if(!confirm('Excluir esta foto corporal?'))return;change(()=>{db.bodyPhotos=(db.bodyPhotos||[]).filter(f=>f.id!==id)})}
function renderMeasureChart(measures){let el=document.getElementById('measureChart');if(!el)return;if(charts['measureChart'])charts['measureChart'].destroy();let labels=measures.map(m=>brDate(m.date));let keys=[['braco','Braço'],['torax','Tórax'],['cintura','Cintura'],['abdomen','Abdômen'],['coxa','Coxa'],['panturrilha','Panturrilha']];charts['measureChart']=new Chart(el,{type:'line',data:{labels,datasets:keys.map(([k,label])=>({label,data:measures.map(m=>Number(m[k]||0)),tension:.3}))},options:{responsive:true,plugins:{legend:{labels:{color:'#fff'}}},scales:{x:{ticks:{color:'#9fb0c8'}},y:{ticks:{color:'#9fb0c8'}}}}})}
function measureDelta(first,last,key){return Number((Number(last?.[key]||0)-Number(first?.[key]||0)).toFixed(1))}
function generateBodyAnalysis(){let ms=(db.measures||[]).filter(m=>m.date).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));let photos=(db.bodyPhotos||[]);if(ms.length<2 && photos.length===0)return '<p class="small">Salve pelo menos duas medições ou algumas fotos para gerar comparação de evolução.</p>';let html='';if(ms.length>=2){let first=ms[0],last=ms.at(-1);let d={braco:measureDelta(first,last,'braco'),torax:measureDelta(first,last,'torax'),cintura:measureDelta(first,last,'cintura'),abdomen:measureDelta(first,last,'abdomen'),coxa:measureDelta(first,last,'coxa'),panturrilha:measureDelta(first,last,'panturrilha')};let fortes=[];if(d.braco>0)fortes.push('braços evoluindo');if(d.torax>0)fortes.push('tórax evoluindo');if(d.coxa>0)fortes.push('coxas evoluindo');if(d.panturrilha>0)fortes.push('panturrilhas evoluindo');if(d.cintura<0||d.abdomen<0)fortes.push('redução de cintura/abdômen');let foco=[];if(d.cintura>0||d.abdomen>0)foco.push('controlar cintura/abdômen com alimentação, cardio e sono');if(d.braco<=0)foco.push('dar mais atenção a braços com progressão de carga');if(d.torax<=0)foco.push('fortalecer peitoral/costas para melhorar volume do tronco');if(d.coxa<=0)foco.push('priorizar treino de pernas e execução completa');if(d.panturrilha<=0)foco.push('incluir panturrilha com frequência maior');html+=`<p><b>Comparação:</b> ${brDate(first.date)} até ${brDate(last.date)}</p><p><b>Pontos fortes:</b> ${fortes.length?fortes.join(', '):'ainda sem evolução clara nas medidas registradas'}.</p><p><b>Onde focar mais:</b> ${foco.length?foco.slice(0,4).join('; '):'manter constância, carga progressiva e registrar fotos mensais'}.</p><p class="small">Resumo das mudanças: braço ${d.braco}cm, tórax ${d.torax}cm, cintura ${d.cintura}cm, abdômen ${d.abdomen}cm, coxa ${d.coxa}cm, panturrilha ${d.panturrilha}cm.</p>`}if(photos.length){let dates=[...new Set(photos.map(f=>f.date))].sort();html+=`<p><b>Fotos salvas:</b> ${photos.length} foto(s) em ${dates.length} data(s). Use as fotos de datas diferentes para comparar postura, definição, volume e simetria.</p>`}html+='<p class="small">Para uma evolução mais fiel, registre medidas e fotos sempre no mesmo padrão: manhã, luz parecida, mesma distância, frente/lado/costas.</p>';return html}

function avatarHtml(){let w=latestWeight()||80, gw=db.profile.goalWeight||90, bf=Number(db.profile.bf||18), scale=Math.max(.75,Math.min(1.35,w/gw));let width=54*scale+(bf>20?8:0), torsoH=62+(w>gw?6:0);return `<div class="body"><div class="head"></div><div class="torso" style="width:${width}px;height:${torsoH}px;border-radius:${bf<15?'18px 18px 10px 10px':'28px 28px 16px 16px'}"></div><div class="legs"><div class="leg"></div><div class="leg"></div></div></div>`} function renderAvatar(){document.getElementById('avatar').innerHTML=`<div class="card"><h2>Avatar físico</h2><div class="avatarBox">${avatarHtml()}</div><p class="small">O porte muda conforme seu peso atual, meta e BF estimado. Peso atual: ${latestWeight()||'-'}kg • Meta: ${db.profile.goalWeight}kg • BF: ${db.profile.bf||'-'}%.</p><p class="small">Para estimar BF com IA, tire foto mensal de frente/lado/costas e peça análise comparando com as medidas salvas.</p></div>`}
function renderLoads(){let groups={};db.loads.forEach(l=>{groups[l.cat||'Sem categoria'] ||= {};groups[l.cat||'Sem categoria'][l.ex] ||= [];groups[l.cat||'Sem categoria'][l.ex].push(l)});document.getElementById('cargas').innerHTML=`<div class="card"><h2>Cargas por categoria</h2><div class="grid"><input id="loadCat" placeholder="Categoria: Peito, Costas..."><input id="loadEx" placeholder="Aparelho/exercício"><input id="loadKg" type="number" placeholder="Carga atual kg"><input id="loadRep" placeholder="Reps/séries"><input id="loadObs" placeholder="Obs"></div><br><button class="primary" onclick="change(()=>db.loads.push({id:uid(),cat:val('loadCat'),ex:val('loadEx'),kg:num('loadKg'),rep:val('loadRep'),obs:val('loadObs'),date:today()}))">Salvar carga</button></div>${Object.keys(groups).map(cat=>`<div class="card"><h2>${cat}</h2><table><tr><th>Exercício</th><th>Carga anterior</th><th>Última carga</th><th>Data</th><th>Progresso</th></tr>${Object.keys(groups[cat]).map(ex=>{let arr=groups[cat][ex].sort((a,b)=>a.date.localeCompare(b.date));let last=arr.at(-1),prev=arr.at(-2);return `<tr><td>${ex}</td><td>${prev?prev.kg+'kg':'-'}</td><td>${last.kg}kg</td><td>${brDate(last.date)}</td><td class="${prev&&last.kg>prev.kg?'ok':'warn'}">${prev?((last.kg-prev.kg)>=0?'+':'')+(last.kg-prev.kg)+'kg':'novo'}</td></tr>`}).join('')}</table></div>`).join('')}`}
function renderSupps(){let wk=keyWeek();db.supplements[wk] ||= {};let list=['Testo','Creatina','Whey'];document.getElementById('suplementos').innerHTML=`<div class="card"><h2>Suplementos</h2><table><tr><th>Dia</th><th>Testo</th><th>Creatina</th><th>Whey</th></tr>${daysWeek().map(d=>`<tr><td>${d}</td>${list.map(s=>`<td>${s=='Testo'&&d!='Seg'?'-':`<input type="checkbox" ${db.supplements[wk][d+'_'+s]?'checked':''} onchange="change(()=>db.supplements['${wk}']['${d}_${s}']=!db.supplements['${wk}']['${d}_${s}'])">`}</td>`).join('')}</tr>`).join('')}</table></div>`}
function metricSection(id,title,unit,obj){let wk=keyWeek();db[obj][wk] ||= {};document.getElementById(id).innerHTML=`<div class="card"><h2>${title}</h2><table><tr><th>Dia</th><th>Feito</th><th>${unit}</th></tr>${daysWeek().map(d=>`<tr><td>${d}</td><td><input type="checkbox" ${db[obj][wk][d]?.done?'checked':''} onchange="change(()=>{db['${obj}']['${wk}']['${d}'] ||= {};db['${obj}']['${wk}']['${d}'].done=!db['${obj}']['${wk}']['${d}'].done})"></td><td><input type="number" step="0.1" value="${db[obj][wk][d]?.val||''}" onchange="db['${obj}']['${wk}']['${d}'] ||= {};db['${obj}']['${wk}']['${d}'].val=Number(this.value);save();renderAll()"></td></tr>`).join('')}</table></div><div class="card"><canvas id="${id}Chart"></canvas></div>`;setTimeout(()=>chart(id+'Chart',title,daysWeek(),daysWeek().map(d=>db[obj][wk][d]?.val||0)),50)}
function renderCardio(){
  let wk=keyWeek();db.cardio[wk] ||= {};let meta=cardioAutoMeta();let total=cardioWeekTotal();let pctMeta=pct(total,meta.weekly);
  document.getElementById('cardio').innerHTML=`<div class="card"><h2>Cardio</h2><p class="small">Meta automática: <b>${meta.daily} min/dia</b> • <b>${meta.weekly} min/semana</b>. ${meta.msg}</p><div class="grid"><div><b>Peso atual</b><br><span class="pill">${latestWeight()||'-'}kg</span></div><div><b>Peso meta</b><br><span class="pill">${db.profile.goalWeight||'-'}kg</span></div><div><b>Diferença</b><br><span class="pill">${meta.diff!==undefined?meta.diff+'kg':'-'}</span></div><div><b>Feito na semana</b><br><span class="pill">${total} / ${meta.weekly} min</span></div></div><div class="progress" style="margin-top:12px"><div class="bar" style="width:${pctMeta}%"></div></div></div><div class="card"><table><tr><th>Dia</th><th>Feito</th><th>Minutos</th><th>Meta do dia</th></tr>${daysWeek().map(d=>`<tr><td>${d}</td><td><input type="checkbox" ${db.cardio[wk][d]?.done?'checked':''} onchange="change(()=>{db.cardio['${wk}']['${d}'] ||= {};db.cardio['${wk}']['${d}'].done=!db.cardio['${wk}']['${d}'].done})"></td><td><input type="number" step="1" value="${db.cardio[wk][d]?.val||''}" onchange="db.cardio['${wk}']['${d}'] ||= {};db.cardio['${wk}']['${d}'].val=Number(this.value);db.cardio['${wk}']['${d}'].done=Number(this.value)>=${meta.daily};save();renderAll()"></td><td>${meta.daily} min</td></tr>`).join('')}</table></div><div class="card"><canvas id="cardioChart"></canvas></div>`;
  setTimeout(()=>chart('cardioChart','Cardio',daysWeek(),daysWeek().map(d=>db.cardio[wk][d]?.val||0)),50)
}
function renderSun(){metricSection('sol','Sol','Minutos','sun')} function renderSleep(){metricSection('sono','Sono','Horas','sleep')}
function sortTasks(a,b){return (a.done-b.done)||String(a.date).localeCompare(String(b.date))||String(a.start||'').localeCompare(String(b.start||''))||({Alta:0,Média:1,Baixa:2}[a.priority]??3)}
function renderTasks(){let list=[...db.tasks].sort(sortTasks);document.getElementById('tarefas').innerHTML=`<div class="card"><h2>Tarefas com início, fim e edição</h2><input id="taskId" type="hidden"><div class="grid"><input id="taskTitle" placeholder="Tarefa"><input id="taskDate" type="date" value="${today()}"><input id="taskStart" type="time" placeholder="Início"><input id="taskEnd" type="time" placeholder="Fim"><select id="taskPriority"><option>Alta</option><option selected>Média</option><option>Baixa</option></select><input id="taskObs" placeholder="Observação"></div><br><button class="primary" onclick="saveTask()">Salvar tarefa</button><button onclick="clearTaskForm()">Limpar</button></div><div class="card"><h2>Lista de tarefas</h2><table><tr><th>Feita</th><th>Data</th><th>Horário</th><th>Tarefa</th><th>Prioridade</th><th>Ações</th></tr>${list.map(t=>`<tr><td><input type="checkbox" ${t.done?'checked':''} onchange="change(()=>db.tasks.find(x=>x.id=='${t.id}').done=!db.tasks.find(x=>x.id=='${t.id}').done)"></td><td>${brDate(t.date)}</td><td>${t.start||'-'} até ${t.end||'-'}</td><td class="${t.done?'done':''}">${t.title}<br><span class="small">${t.obs||''}</span></td><td>${t.priority}</td><td><button class="mini" onclick="editTask('${t.id}')">Editar</button><button class="mini danger" onclick="change(()=>db.tasks=db.tasks.filter(x=>x.id!='${t.id}'))">X</button></td></tr>`).join('')}</table></div>`}
function saveTask(){let id=val('taskId');change(()=>{if(id){let t=db.tasks.find(x=>x.id==id);Object.assign(t,{title:val('taskTitle'),date:val('taskDate'),start:val('taskStart'),end:val('taskEnd'),priority:val('taskPriority'),obs:val('taskObs')})}else db.tasks.push({id:uid(),title:val('taskTitle'),date:val('taskDate')||today(),start:val('taskStart'),end:val('taskEnd'),priority:val('taskPriority')||'Média',obs:val('taskObs'),done:false})})} function editTask(id){let t=db.tasks.find(x=>x.id==id);openTab('tarefas');setTimeout(()=>{document.getElementById('taskId').value=t.id;document.getElementById('taskTitle').value=t.title;document.getElementById('taskDate').value=t.date;document.getElementById('taskStart').value=t.start||'';document.getElementById('taskEnd').value=t.end||'';document.getElementById('taskPriority').value=t.priority;document.getElementById('taskObs').value=t.obs||''},50)} function clearTaskForm(){['taskId','taskTitle','taskStart','taskEnd','taskObs'].forEach(i=>document.getElementById(i).value='')}
const wheelCats=['Saúde','Família','Relacionamento','Financeiro','Trabalho','Espiritual','Servir','Lazer','Desenvolvimento','Propósito'];
function renderWheel(){let last=db.wheel.at(-1);let selected=val('wheelSelect')||last?.id||'';let item=db.wheel.find(x=>x.id==selected)||last;let scores=item?.scores||{};let avg=Math.round((Object.values(scores).reduce((a,b)=>a+(+b||0),0)/Math.max(Object.keys(scores).length,1))*10)||0;document.getElementById('roda').innerHTML=`<div class="card"><h2>Roda da Vida</h2><div class="grid"><div><label>Nome da Pessoa</label><input id="wheelName" value="${item?.name||''}"></div><div><label>Idade</label><input id="wheelAge" type="number" value="${item?.age||''}"></div></div><label>Propósito de Vida</label><textarea id="wheelPurpose">${item?.purpose||''}</textarea><label>Grande Meta Atual</label><textarea id="wheelGoal">${item?.goal||''}</textarea><p class="small">Avalie cada área de 0 a 10.</p><div class="grid">${wheelCats.map(c=>`<div><label>${c}</label><input id="wheel_${c}" type="number" min="0" max="10" value="${scores[c]||5}"></div>`).join('')}</div><br><button class="primary" onclick="saveWheel()">Salvar avaliação da roda</button></div><div class="card"><h2>🤖 IA de Equilíbrio de Vida</h2><p><b>Índice de equilíbrio:</b> ${avg}%</p><div id="wheelAI">${generateWheelAI(item)}</div></div><div class="card"><h2>Avaliações antigas</h2><select id="wheelSelect" onchange="renderWheel()"><option value=''>Selecione uma data</option>${db.wheel.map(w=>`<option value="${w.id}" ${item?.id==w.id?'selected':''}>${w.name||'Sem nome'} - ${brDate(w.date)} ${w.time||''}</option>`).join('')}</select><table><tr><th>Nome</th><th>Data</th><th>Hora</th><th>Equilíbrio</th></tr>${db.wheel.slice().reverse().map(w=>`<tr><td>${w.name||''}</td><td>${brDate(w.date)}</td><td>${w.time||''}</td><td>${Math.round((Object.values(w.scores||{}).reduce((a,b)=>a+(+b||0),0)/Math.max(Object.keys(w.scores||{}).length,1))*10)||0}%</td></tr>`).join('')}</table><canvas id="wheelChart"></canvas></div>`;setTimeout(()=>{radar('wheelChart',wheelCats,wheelCats.map(c=>scores[c]||0));},100)}
function generateWheelAI(item){if(!item||!item.scores)return '<p>Faça uma avaliação para receber recomendações.</p>';let arr=Object.entries(item.scores).sort((a,b)=>a[1]-b[1]);let fracos=arr.slice(0,3).map(x=>x[0]).join(', ');let fortes=arr.slice(-3).reverse().map(x=>x[0]).join(', ');return `<p><b>Pontos fortes:</b> ${fortes}</p><p><b>Maior atenção:</b> ${fracos}</p><p>Quando os pilares da vida não estão alinhados, é comum ocorrer oscilação de humor, energia, motivação e sensação de bem-estar. Quanto mais equilibradas estiverem as áreas da vida, maior tende a ser a estabilidade emocional e a satisfação geral.</p><p><b>Plano:</b> Dedique atenção semanal aos pilares mais baixos até aproximá-los da média dos demais.</p>`}
function saveWheel(){change(()=>{let scores={};wheelCats.forEach(c=>scores[c]=Number(document.getElementById('wheel_'+c).value||0));db.wheel.push({id:uid(),date:today(),time:timeSP().slice(0,5),name:document.getElementById('wheelName').value,age:document.getElementById('wheelAge').value,purpose:document.getElementById('wheelPurpose').value,goal:document.getElementById('wheelGoal').value,scores})})}
function renderReports(){let cur=ym();let daily=Object.values(db.dailyFoodReports||{}).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,10);document.getElementById('relatorios').innerHTML=`<div class="card"><h2>Relatórios mensais</h2><button class="primary" onclick="generateReport('${cur}');renderAll()">Fechar mês atual</button></div><div class="card"><table><tr><th>Mês</th><th>Dias alimentação</th><th>Média água</th><th>Peso início</th><th>Peso fim</th></tr>${Object.values(db.monthlyReports).map(r=>`<tr><td>${r.month}</td><td>${r.daysFood}</td><td>${r.avgWater.toFixed(1)}L</td><td>${r.weightStart}</td><td>${r.weightEnd}</td></tr>`).join('')}</table></div><div class="card"><h2>Dias de alimentação registrados automaticamente</h2><table><tr><th>Dia</th><th>Itens</th><th>Água</th><th>Proteína</th><th>Carbo</th><th>Gordura</th><th>Kcal</th></tr>${daily.map(r=>`<tr><td>${brDate(r.date)}</td><td>${r.totals.items}</td><td>${Number(r.totals.water||0).toFixed(1)}L</td><td>${Number(r.totals.p||0).toFixed(1)}g</td><td>${Number(r.totals.c||0).toFixed(1)}g</td><td>${Number(r.totals.g||0).toFixed(1)}g</td><td>${Math.round(Number(r.totals.k||0))}</td></tr>`).join('')}</table></div>`} function generateReport(month){let foods=Object.entries(db.meals).filter(([d])=>d.startsWith(month));let weights=db.weights.filter(w=>w.date.startsWith(month));change(()=>db.monthlyReports[month]={month,daysFood:foods.length,avgWater:foods.length?foods.reduce((s,[,v])=>s+v.water,0)/foods.length:0,weightStart:weights[0]?.value||0,weightEnd:weights.at(-1)?.value||0,created:today()})}
function renderBackup(){document.getElementById('backup').innerHTML=`<div class="card"><h2>Backup</h2><p>Além do Firebase, você pode exportar/importar backup manual. O sistema salva ao alterar algo e cria backup automático a cada 5 minutos.</p><p class="small">Backups diários locais: ${Object.keys(db.dailyBackups||{}).length}</p><p class="small">Último backup 5min: ${db.lastBackup5min||'aguardando'}</p><div class="row"><button class="primary" onclick="save(false);cloudBackupNow();renderBackup();alert('Backup criado agora.')">Salvar e fazer backup agora</button><button onclick="exportBackup()">Exportar backup</button><input type="file" accept="application/json" onchange="importBackup(event)"></div><br><button class="danger" onclick="if(confirm('Apagar tudo?')){localStorage.removeItem(KEY);localStorage.removeItem(KEY+'_backup_atual');localStorage.removeItem(KEY+'_backup_5min');location.reload()}">Apagar dados locais</button></div>`} function exportBackup(){let blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='backup-saude-'+today()+'.json';a.click()} function importBackup(ev){let f=ev.target.files[0];if(!f)return;let r=new FileReader();r.onload=()=>{pushUndo();db=JSON.parse(r.result);migrate();save(false);cloudBackupNow();renderAll()};r.readAsText(f)}
function chart(id,label,labels,data){if(charts[id])charts[id].destroy();let el=document.getElementById(id);if(!el)return;charts[id]=new Chart(el,{type:'line',data:{labels,datasets:[{label,data,tension:.3}]},options:{responsive:true,plugins:{legend:{labels:{color:'#fff'}}},scales:{x:{ticks:{color:'#9fb0c8'}},y:{ticks:{color:'#9fb0c8'}}}}})}
function radar(id,labels,data){if(charts[id])charts[id].destroy();let el=document.getElementById(id);if(!el)return;charts[id]=new Chart(el,{type:'radar',data:{labels,datasets:[{label:'Roda da Vida',data,fill:true}]},options:{responsive:true,scales:{r:{min:0,max:10,ticks:{color:'#9fb0c8'},grid:{color:'#243653'},pointLabels:{color:'#f4f7fb'}}},plugins:{legend:{labels:{color:'#fff'}}}}})}
async function iniciarDanielHealthOS(){
  try{
    renderTabs();
    autoDailyBackup();
    checkDayRollover();
    await initFirebaseHealthOS();
    await loadCloud();
    startAutoSaveAndBackup();
    cloudBackupNow();
    const st=document.getElementById('saveStatus');
    if(st && st.innerText==='Carregando...') st.innerText=cloudRef?'Nuvem pronta':'Modo local pronto';
  }catch(e){
    console.error('Falha ao iniciar o sistema:', e);
    try{ renderTabs(); renderAll(); }catch(_e){}
    const st=document.getElementById('saveStatus');
    if(st) st.innerText='Sistema pronto em modo local';
  }
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', iniciarDanielHealthOS);
}else{
  iniciarDanielHealthOS();
}


(function(){
  if(window.__danielCleanFixV3) return; window.__danielCleanFixV3=true;

  function goTop(){ try{ window.scrollTo({top:0,behavior:'smooth'}); }catch(e){ window.scrollTo(0,0); } }
  const originalOpenTab = window.openTab;
  window.openTab = function(id){
    if(typeof originalOpenTab==='function') originalOpenTab(id);
    document.querySelectorAll('.section').forEach(s=>{ s.style.display = s.id===id ? 'block' : 'none'; });
    setTimeout(goTop, 50);
    setTimeout(mountIA, 250);
  };

  const originalRenderTabs = window.renderTabs;
  window.renderTabs = function(){
    if(typeof originalRenderTabs==='function') originalRenderTabs();
    const active=document.querySelector('.section.active')?.id || 'home';
    document.querySelectorAll('.section').forEach(s=>{ s.style.display = s.id===active ? 'block' : 'none'; });
  };

  const originalRenderAll = window.renderAll;
  window.renderAll = function(){
    if(typeof originalRenderAll==='function') originalRenderAll();
    const active=document.querySelector('.section.active')?.id || 'home';
    document.querySelectorAll('.section').forEach(s=>{ s.style.display = s.id===active ? 'block' : 'none'; });
    mountIA();
  };

  function fileToDataURL(file){
    return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=()=>reject(r.error||new Error('Falha ao ler imagem')); r.readAsDataURL(file); });
  }
  async function imageFileToJpegDataURL(file){
    // iPhone pode enviar HEIC/HEIF ou imagens muito grandes. A IA aceita melhor JPEG/PNG.
    // Então sempre normalizamos a foto para JPEG menor antes de enviar.
    const originalUrl = await fileToDataURL(file);
    const img = await new Promise((resolve,reject)=>{
      const im = new Image();
      im.onload = ()=>resolve(im);
      im.onerror = ()=>reject(new Error('Não consegui abrir esta imagem. No iPhone, tente selecionar pela galeria ou tirar foto em formato Mais Compatível/JPEG.'));
      im.src = originalUrl;
    });
    const maxSide = 1200;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if(!w || !h) throw new Error('Imagem inválida.');
    const scale = Math.min(1, maxSide / Math.max(w,h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const jpg = canvas.toDataURL('image/jpeg', 0.82);
    if(!/^data:image\/jpeg;base64,/.test(jpg)) throw new Error('Falha ao converter imagem para JPEG.');
    return jpg;
  }
  function n(v){ const x=parseFloat(String(v||'').replace(',','.')); return Number.isFinite(x)?x:0; }
  function setPreview(file){
    if(!file) return;
    fileToDataURL(file).then(url=>{ const img=document.getElementById('iaPratoPreview'); if(img){ img.src=url; img.style.display='block'; }}).catch(()=>{});
  }
  function chosenFile(){
    return (document.getElementById('iaPratoGaleria')?.files||[])[0] || (document.getElementById('iaPratoCamera')?.files||[])[0];
  }
  async function analisarPrato(){
    const file=chosenFile();
    if(!file){ alert('Escolha uma imagem da galeria ou tire uma foto primeiro.'); return; }
    const out=document.getElementById('iaPratoResultado');
    out.innerHTML='<p>Analisando prato com IA...</p>';
    try{
      const imageBase64=await imageFileToJpegDataURL(file);
      const resp=await fetch('/.netlify/functions/analisar-prato',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64})});
      const data=await resp.json();
      if(!resp.ok || data.error){ out.innerHTML='<p><b>Erro:</b> '+(data.error||'não foi possível analisar')+'</p><p class="small">Se estiver no iPhone, tente escolher pela galeria. O sistema agora converte para JPG antes de enviar.</p>'; return; }
      const t=data.totais||{};
      out.innerHTML=`<div class="card"><h4>Resultado da IA</h4><p><b>Prato:</b> ${data.descricao||'estimativa do prato'}</p><div class="grid"><div><label>Proteína</label><input id="iaProt" type="number" step="0.1" value="${n(t.proteina).toFixed(1)}"></div><div><label>Carboidrato</label><input id="iaCarb" type="number" step="0.1" value="${n(t.carboidrato).toFixed(1)}"></div><div><label>Gordura</label><input id="iaGord" type="number" step="0.1" value="${n(t.gordura).toFixed(1)}"></div><div><label>Calorias</label><input id="iaCal" type="number" step="1" value="${Math.round(n(t.calorias))}"></div></div><p class="small">${data.observacao||'Ajuste os números se precisar antes de confirmar.'}</p><button type="button" class="primary" id="iaConfirmarPrato">Confirmar e adicionar</button></div>`;
      document.getElementById('iaConfirmarPrato').onclick=function(){
        if(typeof window.change==='function' && typeof window.foodToday==='function'){
          window.change(()=>window.foodToday().items.push({id:window.uid?window.uid():String(Date.now()),name:'Prato IA',qtd:1,unit:'prato',p:n(document.getElementById('iaProt').value),c:n(document.getElementById('iaCarb').value),g:n(document.getElementById('iaGord').value),k:Math.round(n(document.getElementById('iaCal').value))}));
        }else{
          alert('Não consegui encontrar a alimentação principal para adicionar.'); return;
        }
        alert('Prato adicionado na alimentação.');
        setTimeout(()=>{ try{window.renderAll()}catch(e){} },200);
      };
    }catch(e){ out.innerHTML='<p><b>Erro:</b> '+(e.message||'falha ao analisar')+'</p><p class="small">Dica: no iPhone, use foto em JPG ou vá em Ajustes > Câmera > Formatos > Mais Compatível.</p>'; }
  }
  function mountIA(){
    const sec=document.getElementById('alimentacao');
    if(!sec) return;
    if(document.getElementById('iaPratoBoxClean')) return;
    const box=document.createElement('div');
    box.id='iaPratoBoxClean';
    box.className='card';
    box.innerHTML=`<h2>Ler prato com IA</h2><p class="small">Funciona no celular e no PC. Você pode carregar imagem da galeria/arquivos ou tirar foto pela câmera.</p><div class="grid"><div><label>Carregar imagem / galeria / PC</label><input id="iaPratoGaleria" type="file" accept="image/*"></div><div><label>Tirar foto com a câmera</label><input id="iaPratoCamera" type="file" accept="image/*" capture="environment"></div></div><img id="iaPratoPreview" style="display:none;max-width:260px;width:100%;border-radius:14px;margin-top:12px"><br><button type="button" class="primary" id="iaPratoAnalisar">Analisar foto</button><div id="iaPratoResultado" style="margin-top:12px"></div>`;
    sec.appendChild(box);
    document.getElementById('iaPratoGaleria').onchange=e=>setPreview(e.target.files[0]);
    document.getElementById('iaPratoCamera').onchange=e=>setPreview(e.target.files[0]);
    document.getElementById('iaPratoAnalisar').onclick=analisarPrato;
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ window.renderTabs&&window.renderTabs(); mountIA(); },800));
})();


(function(){
  if(window.__rodaVidaServirGraficoFix) return; window.__rodaVidaServirGraficoFix=true;
  window.wheelCats = ['Saúde','Família','Relacionamento','Financeiro','Trabalho','Espiritual','Servir','Lazer','Desenvolvimento'];
  const cats = window.wheelCats;
  function wheelAI(scores){
    const arr=cats.map(c=>({cat:c,val:Number(scores[c] ?? 0)}));
    const avg=arr.length?arr.reduce((s,x)=>s+x.val,0)/arr.length:0;
    const min=Math.min(...arr.map(x=>x.val));
    const max=Math.max(...arr.map(x=>x.val));
    const gap=max-min;
    const low=arr.filter(x=>x.val<=5).sort((a,b)=>a.val-b.val);
    const attention=(low.length?low:arr.slice().sort((a,b)=>a.val-b.val).slice(0,3));
    const tips={
      'Saúde':'sono, água, alimentação e treino. Comece com uma ação simples por dia para o corpo voltar a responder.',
      'Família':'presença de qualidade, conversa sem celular e pequenos combinados para diminuir cobrança e aumentar conexão.',
      'Relacionamento':'diálogo honesto, carinho, iniciativa e tempo protegido para o casal.',
      'Financeiro':'clareza de entradas, saídas, dívidas e uma retirada saudável sem misturar emoção com decisão.',
      'Trabalho':'prioridade, delegação, rotina de cobrança/execução e pausa para não viver só no modo pressão.',
      'Espiritual':'oração, silêncio, gratidão e direção. Fortalece o emocional quando o dia pesa.',
      'Servir':'ajudar alguém, orientar, doar tempo ou fazer algo bom sem esperar retorno. Isso aumenta propósito.',
      'Lazer':'descanso real, diversão e momentos leves. Sem lazer, o corpo entende que a vida é só obrigação.',
      'Desenvolvimento':'estudo, terapia, leitura e melhoria contínua. Escolha uma habilidade por vez.'
    };
    let status=avg>=8 && gap<=2 ? 'Sua roda está bem alinhada. O foco agora é manter constância.' : gap>=4 ? 'Sua roda está desequilibrada: alguns pilares estão fortes, mas outros estão puxando sua energia para baixo.' : 'Sua roda está razoável, mas ainda tem pilares que precisam de atenção para subir seu bem-estar.';
    return `<div class="card"><h2>IA da Roda da Vida</h2><p><b>${status}</b></p><p class="small">Quando os pilares da vida não estão alinhados, nossa sensação de bem-estar não chega no potencial máximo. Isso pode fazer humor e energia oscilarem muito, mesmo quando uma área está indo bem.</p><h3>Onde dar mais atenção agora</h3><ul>${attention.map(x=>`<li><b>${x.cat} (${x.val}/10):</b> ${tips[x.cat]||'crie uma ação pequena e repetível para melhorar esse pilar.'}</li>`).join('')}</ul><h3>Como equilibrar</h3><p class="small">Escolha no máximo 2 pilares fracos por semana. Defina uma ação pequena, com horário e repetição. Exemplo: 20 minutos de treino, 10 minutos de oração, conversa com a família, revisar finanças ou fazer uma atitude de servir. O segredo é alinhar aos poucos, sem tentar mudar tudo em um dia.</p></div>`;
  }
  window.renderWheel = function(){
    const last=(db.wheel||[]).at(-1);
    const selected=(document.getElementById('wheelSelect')?.value)||last?.id||'';
    const item=(db.wheel||[]).find(x=>x.id==selected)||last||{scores:{}};
    const scores=item.scores||{};
    document.getElementById('roda').innerHTML=`<div class="card"><h2>Roda da Vida</h2><p class="small">Preencha de 0 a 10. Agora também tem <b>Servir</b>. O gráfico atualiza na hora depois de salvar.</p><div class="grid">${cats.map(c=>`<div><label>${c}</label><input id="wheel_${c}" type="number" min="0" max="10" value="${scores[c] ?? 5}"></div>`).join('')}</div><br><button class="primary" onclick="saveWheel()">Salvar avaliação da roda</button></div><div class="card"><h2>Avaliações antigas</h2><select id="wheelSelect" onchange="renderWheel()"><option value="">Selecione uma data</option>${(db.wheel||[]).map(w=>`<option value="${w.id}" ${item?.id==w.id?'selected':''}>${brDate(w.date)} ${w.time||''}</option>`).join('')}</select><canvas id="wheelChart"></canvas></div>${wheelAI(scores)}`;
    setTimeout(()=>{
      try{ radar('wheelChart',cats,cats.map(c=>Number(scores[c] ?? 0))); if(charts.wheelChart){charts.wheelChart.resize();charts.wheelChart.update('none');} }catch(e){console.warn(e)}
    },120);
  };
  window.saveWheel = function(){
    change(()=>{
      const scores={}; cats.forEach(c=>scores[c]=Number(document.getElementById('wheel_'+c)?.value||0));
      db.wheel ||= []; db.wheel.push({id:uid(),date:today(),time:timeSP().slice(0,5),scores});
    });
    setTimeout(()=>{ try{renderWheel(); if(charts.wheelChart){charts.wheelChart.resize();charts.wheelChart.update('none');}}catch(e){} },180);
  };
  const oldOpenTab=window.openTab;
  window.openTab=function(id){
    if(typeof oldOpenTab==='function') oldOpenTab(id);
    if(id==='roda') setTimeout(()=>{try{renderWheel(); if(charts.wheelChart){charts.wheelChart.resize();charts.wheelChart.update('none');}}catch(e){}},220);
  };
})();
