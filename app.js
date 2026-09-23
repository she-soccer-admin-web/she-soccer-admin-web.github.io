import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import Chart from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/auto/+esm';

const SUPABASE_URL = 'https://qgwfzutqyownkzfefofi.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qvFDNxwQvTOlCDI9HVlf8g_nmlZ7O7P';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const BRAND = '#5A3686';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const content = $('#content');
const appView = $('#appView');
const loginView = $('#loginView');
const titleEl = $('#sectionTitle');
const eyebrowEl = $('#sectionEyebrow');
const lastUpdatedEl = $('#lastUpdated');
let activeSection = 'dashboard';
let charts = [];
let profile = null;
let catalogs = { teams: [], leagues: [], coaches: [] };

const sectionTitles = {
  dashboard:'Dashboard', players:'Jugadores', teams:'Equipos', matches:'Partidos',
  attendance:'Asistencia', citations:'Citaciones', commitment:'Compromiso', users:'Usuarios',
  leagues:'Ligas', news:'Novedades', sponsors:'Sponsors', benefits:'Beneficios',
  payments:'Pagos', concepts:'Conceptos', expenses:'Gastos', balances:'Balances', files:'Archivos'
};

function friendlyErrorText(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  if (
    lower.includes('students_dni_key') ||
    (lower.includes('duplicate key value') && lower.includes('dni'))
  ) {
    return 'Ya existe un jugador registrado con ese DNI. Buscalo en Jugadores y editá su ficha.';
  }

  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'No tenés permisos para realizar esta acción. Volvé a iniciar sesión y probá nuevamente.';
  }

  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return 'No pudimos comunicarnos con el servidor. Revisá tu conexión e intentá nuevamente.';
  }

  if (lower.includes('not_authorized')) {
    return 'Tu usuario no está autorizado para realizar esta acción.';
  }

  if (lower.includes('student_not_found')) {
    return 'No encontramos ese jugador. Actualizá la pantalla e intentá nuevamente.';
  }

  return text || 'Ocurrió un inconveniente. Intentá nuevamente.';
}

function toast(message, type='success') {
  const el = $('#toast');
  el.textContent = type === 'error' ? friendlyErrorText(message) : message;
  el.className = `toast show ${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.className='toast', 4200);
}
function money(v){return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:0,maximumFractionDigits:0}).format(Number(v||0));}
function dateLabel(v){ if(!v) return '-'; const [y,m,d]=String(v).slice(0,10).split('-'); return `${d}/${m}/${y}`; }

function storageRefParts(reference){
  const ref=String(reference||'').trim();
  if(!ref.startsWith('storage://')) return null;
  const rest=ref.slice('storage://'.length);
  const slash=rest.indexOf('/');
  if(slash<=0) return null;
  return {bucket:rest.slice(0,slash),path:rest.slice(slash+1)};
}

async function getPrivateFileUrl(reference){
  const ref=String(reference||'').trim();
  if(!ref) throw new Error('No hay archivo disponible.');
  if(/^https?:\/\//i.test(ref)) return ref;

  const parts=storageRefParts(ref);
  if(!parts) throw new Error('La referencia del archivo no es válida.');

  const {data,error}=await supabase.storage
    .from(parts.bucket)
    .createSignedUrl(parts.path,900);

  if(error || !data?.signedUrl) throw error||new Error('No pudimos abrir el archivo.');
  return data.signedUrl;
}

async function openPaymentProof(file){
  try{
    const url=await getPrivateFileUrl(file?.storage_ref||file?.proof_path);
    const mime=String(file?.mime_type||'');
    const name=String(file?.file_name||'Comprobante');

    if(mime.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name)){
      openModal('Comprobante',`
        <div class="proof-viewer">
          <img src="${esc(url)}" alt="${esc(name)}">
          <div class="form-actions">
            <a class="btn light" href="${esc(url)}" target="_blank" rel="noopener">Abrir en otra pestaña</a>
          </div>
        </div>
      `);
      return;
    }

    window.open(url,'_blank','noopener');
  }catch(ex){
    console.error('OPEN PAYMENT PROOF ERROR:',ex);
    toast(ex?.message||'No pudimos abrir el comprobante.','error');
  }
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function loading(text='Cargando información...'){ content.innerHTML=`<div class="loading"><div><div class="spinner"></div>${esc(text)}</div></div>`; }
function destroyCharts(){ charts.forEach(c=>{try{c.destroy()}catch{}}); charts=[]; }
function setUpdated(){ lastUpdatedEl.textContent=`Actualizado ${new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}`; }
function statusBadge(label, kind='gray'){return `<span class="badge ${kind}">${esc(label)}</span>`;}
function activeStatus(row){
  if(row.is_injured) return statusBadge('LESIONADO','red');
  if(row.is_enabled===false) return statusBadge('NO HABILITADO','red');
  return statusBadge('HABILITADO','green');
}
function openModal(title, html){ $('#modalTitle').textContent=title; $('#modalBody').innerHTML=html; $('#modalBackdrop').classList.remove('hidden'); }
function closeModal(){ $('#modalBackdrop').classList.add('hidden'); $('#modalBody').innerHTML=''; }
$('#modalClose').onclick=closeModal;
$('#modalBackdrop').addEventListener('click',e=>{ if(e.target.id==='modalBackdrop') closeModal(); });

async function invokeDniLogin(dni,password){
  const res = await fetch(`${SUPABASE_URL}/functions/v1/login-by-dni`,{
    method:'POST', headers:{'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY},
    body:JSON.stringify({dni:dni.replace(/\D/g,''),password,role:'administrativo'})
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data?.session?.access_token) throw new Error(data?.message||'No pudimos iniciar sesión.');
  const {error}=await supabase.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
  if(error) throw error;
}

async function verifyAdmin(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session) return false;
  const {data:p,error}=await supabase.from('profiles').select('*').eq('id',session.user.id).single();
  if(error || !p) return false;
  let admin = p.role==='administrativo';
  if(!admin){
    const {data:r}=await supabase.from('profile_roles').select('role,is_enabled').eq('profile_id',p.id).eq('role','administrativo').eq('is_enabled',true).maybeSingle();
    admin=!!r;
  }
  if(!admin) return false;
  profile=p;
  return true;
}

async function showApp(){
  loginView.classList.add('hidden'); appView.classList.remove('hidden');
  const name=[profile?.first_name,profile?.last_name].filter(Boolean).join(' ')||'Administración';
  $('#sidebarUserName').textContent=name; $('#sidebarAvatar').textContent=(profile?.first_name?.[0]||'A').toUpperCase();
  await loadCatalogs();
  navigate(activeSection);
}

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); const btn=$('#loginButton'); const err=$('#loginError');
  err.textContent=''; btn.disabled=true; btn.textContent='Ingresando...';
  try{ await invokeDniLogin($('#loginDni').value,$('#loginPassword').value); if(!(await verifyAdmin())) throw new Error('Este usuario no tiene rol Administrativo habilitado.'); await showApp(); }
  catch(ex){ err.textContent=ex.message||'Error de ingreso.'; await supabase.auth.signOut(); }
  finally{ btn.disabled=false; btn.textContent='Ingresar al panel'; }
});
$('#logoutButton').onclick=async()=>{await supabase.auth.signOut(); location.reload();};

async function loadCatalogs(){
  const [teams,leagues,profiles] = await Promise.all([
    supabase.from('teams').select('*').eq('is_enabled',true).order('name'),
    supabase.from('leagues').select('*').eq('is_enabled',true).order('name'),
    supabase.from('profiles').select('id,first_name,last_name,role,is_enabled,is_active').eq('is_enabled',true).eq('is_active',true).order('last_name')
  ]);
  catalogs.teams=teams.data||[]; catalogs.leagues=leagues.data||[];
  catalogs.coaches=(profiles.data||[]).filter(p=>p.role==='entrenador'||p.role==='administrativo');
}

$('#mainNav').addEventListener('click',e=>{ const b=e.target.closest('[data-section]'); if(b) navigate(b.dataset.section); });
$('#refreshButton').onclick=()=>navigate(activeSection,true);
async function navigate(section){
  activeSection=section; destroyCharts();
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.section===section));
  titleEl.textContent=sectionTitles[section]||section; eyebrowEl.textContent='SHE SOCCER · ADMIN WEB'; loading();
  try{
    const fn={dashboard:renderDashboard,players:renderPlayers,teams:renderTeams,matches:renderMatches,attendance:renderAttendance,citations:renderCitations,commitment:renderCommitment,users:renderUsers,leagues:renderLeagues,news:renderNews,sponsors:renderSponsors,benefits:renderBenefits,payments:renderPayments,concepts:renderConcepts,expenses:renderExpenses,balances:renderBalances,files:renderFiles}[section];
    await (fn||renderDashboard)(); setUpdated();
  }catch(ex){ console.error(ex); content.innerHTML=`<div class="card"><h3>No pudimos cargar esta sección</h3><p class="section-note">${esc(ex.message||ex)}</p></div>`; }
}

async function renderDashboard(){
  const {data,error}=await supabase.rpc('admin_web_financial_dashboard',{p_months:12});
  if(error) throw new Error('Falta ejecutar 30_SHE_SOCCER_WEB_GASTOS_BALANCE.sql en Supabase.');
  const d=data||{}; const k=d.kpis||{};
  content.innerHTML=`
    <div class="hero"><div><h2>Control integral de SHE SOCCER</h2><p>Jugadores, cobranzas, gastos y resultado económico en una sola pantalla.</p></div><div class="hero-badge">${new Date().toLocaleDateString('es-AR',{month:'long',year:'numeric'}).toUpperCase()}</div></div>
    <div class="metrics">
      <div class="metric brand"><div class="label">Cobrado este mes</div><div class="value">${money(k.income_month)}</div><div class="sub">Ingresos registrados</div></div>
      <div class="metric red"><div class="label">Gastos este mes</div><div class="value">${money(k.expenses_month)}</div><div class="sub">Egresos registrados</div></div>
      <div class="metric green"><div class="label">Resultado del mes</div><div class="value">${money(k.net_month)}</div><div class="sub">Ingresos - gastos</div></div>
      <div class="metric"><div class="label">Deuda vencida</div><div class="value">${money(k.total_debt)}</div><div class="sub">${Number(k.debtors||0)} jugadores con deuda</div></div>
      <div class="metric"><div class="label">Jugadores activos</div><div class="value">${Number(k.active_players||0)}</div><div class="sub">${Number(k.disabled_players||0)} no habilitados</div></div>
      <div class="metric"><div class="label">Ingreso esperado mensual</div><div class="value">${money(k.expected_monthly)}</div><div class="sub">Según actividades y descuentos</div></div>
      <div class="metric"><div class="label">Promedio ingresos</div><div class="value">${money(k.avg_income_month)}</div><div class="sub">Últimos 12 meses</div></div>
      <div class="metric"><div class="label">Promedio gastos</div><div class="value">${money(k.avg_expenses_month)}</div><div class="sub">Últimos 12 meses</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><div><h3>Ingresos vs. egresos</h3><div class="card-sub">Evolución mensual</div></div></div><div class="chart-wrap"><canvas id="cashFlowChart"></canvas></div></div>
      <div class="card"><div class="card-head"><div><h3>Composición de gastos</h3><div class="card-sub">Por categoría</div></div></div><div class="chart-wrap"><canvas id="expenseChart"></canvas></div></div>
    </div>
    <div class="grid-2" style="margin-top:18px">
      <div class="card"><div class="card-head"><div><h3>Estado de cobranza</h3><div class="card-sub">Indicadores principales</div></div></div>
        <div class="kpi-line"><span>Cuentas al día</span><strong>${Number(k.up_to_date||0)}</strong></div>
        <div class="kpi-line"><span>Jugadores con deuda</span><strong>${Number(k.debtors||0)}</strong></div>
        <div class="kpi-line"><span>Deuda +30 días</span><strong>${money(k.debt_over_30_days)}</strong></div>
        <div class="kpi-line"><span>Pagos a revisar</span><strong>${Number(k.pending_review||0)}</strong></div>
      </div>
      <div class="card"><div class="card-head"><div><h3>Resultado acumulado</h3><div class="card-sub">Últimos 12 meses</div></div></div>
        <div class="kpi-line"><span>Ingresos</span><strong class="money positive">${money(k.income_period)}</strong></div>
        <div class="kpi-line"><span>Gastos</span><strong class="money negative">${money(k.expenses_period)}</strong></div>
        <div class="kpi-line"><span>Resultado</span><strong>${money(k.net_period)}</strong></div>
        <div class="kpi-line"><span>Margen sobre ingresos</span><strong>${Number(k.margin_pct||0).toLocaleString('es-AR',{maximumFractionDigits:1})}%</strong></div>
      </div>
    </div>`;
  const months=d.monthly||[];
  charts.push(new Chart($('#cashFlowChart'),{type:'bar',data:{labels:months.map(x=>x.label),datasets:[{label:'Ingresos',data:months.map(x=>x.income),backgroundColor:'#5A3686'},{label:'Gastos',data:months.map(x=>x.expenses),backgroundColor:'#E1CADB'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true}}}}));
  const cats=d.expense_categories||[];
  charts.push(new Chart($('#expenseChart'),{type:'doughnut',data:{labels:cats.map(x=>x.category),datasets:[{data:cats.map(x=>x.amount),backgroundColor:['#5A3686','#8a6aaa','#b497cc','#E1CADB','#302436','#9b6b83','#c6a7b9']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}}));
}

async function renderPlayers(search=''){
  const {data,error}=await supabase.rpc('admin_get_students_page',{p_search:search,p_filter:'all',p_limit:100,p_offset:0});
  if(error) throw error; const rows=data?.items||[];
  content.innerHTML=`<div class="toolbar"><input id="playerSearch" class="grow" placeholder="Buscar por DNI, nombre o apellido" value="${esc(search)}"><button class="btn primary" id="newPlayer">+ Nuevo jugador</button></div>
    <div class="metrics"><div class="metric"><div class="label">Total</div><div class="value">${data?.total_count||0}</div></div><div class="metric"><div class="label">Sin equipo</div><div class="value">${data?.sin_equipo_count||0}</div></div></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Jugador</th><th>DNI</th><th>Nacimiento</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="name-cell">${esc(r.first_name)} ${esc(r.last_name)}</td><td>${esc(r.dni)}</td><td>${dateLabel(r.birth_date)}</td><td>${activeStatus(r)}</td><td><div class="actions"><button class="btn light small edit-player" data-id="${r.id}">Editar</button><button class="btn light small account-player" data-id="${r.id}">Cuenta</button></div></td></tr>`).join('')}</tbody></table></div>`;
  let timer; $('#playerSearch').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>renderPlayers(e.target.value.trim()),300)};
  $('#newPlayer').onclick=()=>editPlayer();
  $$('.edit-player').forEach(b=>b.onclick=()=>editPlayer(rows.find(r=>r.id===b.dataset.id)));
  $$('.account-player').forEach(b=>b.onclick=()=>openPlayerAccount(rows.find(r=>r.id===b.dataset.id)));
}

async function editPlayer(row=null){
  const memberships=row
    ? await supabase.from('team_students').select('team_id').eq('student_id',row.id).eq('status','activo')
    : {data:[]};

  const selected=new Set((memberships.data||[]).map(x=>x.team_id));

  openModal(row?'Editar jugador':'Nuevo jugador',`<form id="playerForm" class="form-grid">
    <label>Nombre<input name="first_name" required value="${esc(row?.first_name||'')}"></label>
    <label>Apellido<input name="last_name" required value="${esc(row?.last_name||'')}"></label>
    <label>DNI<input name="dni" required inputmode="numeric" autocomplete="off" value="${esc(row?.dni||'')}"></label>
    <label>Fecha de nacimiento<input type="date" name="birth_date" required value="${esc(row?.birth_date||'')}"></label>
    <label>Género<select name="gender">
      <option value="femenino" ${row?.gender==='femenino'?'selected':''}>Femenino</option>
      <option value="masculino" ${row?.gender==='masculino'?'selected':''}>Masculino</option>
      <option value="otro" ${row?.gender==='otro'?'selected':''}>Otro</option>
    </select></label>
    <label>Estado<select name="is_enabled">
      <option value="true" ${row?.is_enabled!==false?'selected':''}>Habilitado</option>
      <option value="false" ${row?.is_enabled===false?'selected':''}>No habilitado</option>
    </select></label>
    <label class="span-2">Equipos<select name="teams" multiple size="${Math.min(6,Math.max(3,catalogs.teams.length))}">
      ${catalogs.teams.map(t=>`<option value="${t.id}" ${selected.has(t.id)?'selected':''}>${esc(t.name)}</option>`).join('')}
    </select></label>
    <label class="check-row span-2"><input type="checkbox" name="is_injured" ${row?.is_injured?'checked':''}> Marcar como lesionado</label>
    <div class="form-actions span-2">
      <button type="button" class="btn light" id="cancelModal">Cancelar</button>
      <button class="btn primary" type="submit">Guardar jugador</button>
    </div>
  </form>`);

  $('#cancelModal').onclick=closeModal;

  $('#playerForm').onsubmit=async e=>{
    e.preventDefault();

    const form=e.currentTarget;
    const submitButton=form.querySelector('button[type="submit"]');
    const fd=new FormData(form);
    const dni=String(fd.get('dni')||'').replace(/\D/g,'');

    if(!dni){
      toast('Ingresá un DNI válido.','error');
      form.dni.focus();
      return;
    }

    const payload={
      first_name:String(fd.get('first_name')||'').trim(),
      last_name:String(fd.get('last_name')||'').trim(),
      dni,
      birth_date:fd.get('birth_date'),
      gender:fd.get('gender'),
      is_enabled:fd.get('is_enabled')==='true',
      is_injured:form.is_injured.checked,
      status:'activo'
    };

    submitButton.disabled=true;
    const originalLabel=submitButton.textContent;
    submitButton.textContent='Guardando...';

    try{
      const {data:existing,error:lookupError}=await supabase
        .from('students')
        .select('id,first_name,last_name,dni')
        .eq('dni',dni)
        .maybeSingle();

      if(lookupError) throw lookupError;

      if(existing && existing.id!==row?.id){
        const existingName=[existing.first_name,existing.last_name].filter(Boolean).join(' ');
        toast(
          `El DNI ${dni} ya está registrado${existingName? ` para ${existingName}` : ''}. Buscá ese jugador y editá su ficha.`,
          'error'
        );
        form.dni.focus();
        form.dni.select();
        return;
      }

      let id=row?.id;

      if(row){
        const {error}=await supabase.from('students').update(payload).eq('id',id);
        if(error) throw error;
      } else {
        const {data,error}=await supabase
          .from('students')
          .insert({...payload,created_by:profile.id,created_by_role:'administrativo'})
          .select('id')
          .single();

        if(error) throw error;
        id=data.id;
      }

      const teamIds=[...form.teams.selectedOptions].map(o=>o.value);
      const {error:teamErr}=await supabase.rpc('admin_set_student_teams',{
        p_student_id:id,
        p_team_ids:teamIds
      });

      if(teamErr) throw teamErr;

      closeModal();
      toast(row?'Jugador actualizado correctamente':'Jugador creado correctamente');
      await renderPlayers();
    }catch(ex){
      console.error('SAVE PLAYER ERROR:',ex);
      toast(ex?.message||'No pudimos guardar el jugador.','error');
    }finally{
      if(submitButton?.isConnected){
        submitButton.disabled=false;
        submitButton.textContent=originalLabel;
      }
    }
  };
}

async function openPlayerAccount(row){
  try{
    const [accountRes,settingsRes]=await Promise.all([
      supabase.rpc('admin_finance_get_account',{p_student_id:row.id}),
      supabase.rpc('admin_finance_get_settings',{})
    ]);

    if(accountRes.error) throw accountRes.error;
    if(settingsRes.error) throw settingsRes.error;

    const data=accountRes.data||{};
    const settings=settingsRes.data||{};
    const activities=settings.activities||[];
    const discounts=settings.discounts||[];

    openModal(`Cuenta · ${row.first_name} ${row.last_name}`,`
      <div class="metrics account-metrics">
        <div class="metric ${Number(data?.debt||0)>0?'red':'green'}">
          <div class="label">Estado de cuenta</div>
          <div class="value">${Number(data?.debt||0)>0?money(data.debt):'SIN DEUDA'}</div>
          <div class="sub">Deuda vencida a la fecha</div>
        </div>
        <div class="metric brand">
          <div class="label">Cuota mensual</div>
          <div class="value">${money(data?.monthly_final)}</div>
          <div class="sub">Según actividad y descuento</div>
        </div>
        <div class="metric">
          <div class="label">Pagos a revisar</div>
          <div class="value">${Number(data?.pending_review_count||0)}</div>
          <div class="sub">Informados por adultos responsables</div>
        </div>
      </div>

      <div class="card account-config-card">
        <div class="card-head">
          <div>
            <h3>Actividad y descuento</h3>
            <div class="card-sub">Configuración económica de este jugador</div>
          </div>
        </div>

        <form id="billingProfileForm" class="form-grid">
          <label>Actividad
            <select name="activity" required>
              <option value="">Seleccionar actividad</option>
              ${activities.map(a=>`<option value="${a.id}" ${data?.activity_id===a.id?'selected':''}>${esc(a.name)} · ${money(a.amount)} · vence día ${a.billing_day}</option>`).join('')}
            </select>
          </label>

          <label>Descuento
            <select name="discount">
              <option value="" ${!data?.discount_id?'selected':''}>SIN DESCUENTO · 0%</option>
              ${discounts.map(d=>`<option value="${d.id}" ${data?.discount_id===d.id?'selected':''}>${esc(d.name)} · ${Number(d.percentage||0)}%</option>`).join('')}
            </select>
          </label>

          <div class="summary-box span-2">
            <div class="kpi-line"><span>Valor bruto actual</span><strong>${money(data?.monthly_base)}</strong></div>
            <div class="kpi-line"><span>Descuento aplicado</span><strong>${Number(data?.discount_percentage||0)}%</strong></div>
            <div class="kpi-line"><span>Cuota resultante</span><strong class="money positive">${money(data?.monthly_final)}</strong></div>
          </div>

          <div class="form-actions span-2">
            <button class="btn primary" type="submit">Guardar actividad y descuento</button>
          </div>
        </form>
      </div>

      <div class="account-actions">
        <button class="btn primary" id="accountLoadPayment">Cargar pago</button>
        <button class="btn light" id="accountReviewPayments">
          Revisar pagos ${Number(data?.pending_review_count||0)>0?`(${Number(data.pending_review_count)})`:''}
        </button>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <h3>Movimientos</h3>
            <div class="card-sub">Historial de pagos registrados</div>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Concepto</th><th>Fecha</th><th>Forma</th><th>Importe</th><th>Comprobante</th></tr>
            </thead>
            <tbody>
              ${(data?.movements||[]).map(m=>`<tr>
                <td class="name-cell">${esc(m.concept)}</td>
                <td>${dateLabel(m.paid_at)}</td>
                <td>${esc(m.payment_method)}</td>
                <td class="money positive">${money(m.amount)}</td>
                <td>${m.receipt_number?esc(m.receipt_number):'-'}</td>
              </tr>`).join('')||'<tr><td colspan="5" class="empty">Sin movimientos</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `);

    $('#billingProfileForm').onsubmit=async e=>{
      e.preventDefault();
      const form=e.currentTarget;
      const btn=form.querySelector('button[type="submit"]');
      const fd=new FormData(form);
      const activityId=String(fd.get('activity')||'');
      const discountId=String(fd.get('discount')||'');

      if(!activityId){
        toast('Seleccioná una actividad para el jugador.','error');
        return;
      }

      btn.disabled=true;
      const old=btn.textContent;
      btn.textContent='Guardando...';

      try{
        const {error}=await supabase.rpc('admin_finance_set_student_profile',{
          p_student_id:row.id,
          p_activity_id:activityId,
          p_discount_id:discountId||null
        });
        if(error) throw error;

        toast('Actividad y descuento actualizados');
        await openPlayerAccount(row);
      }catch(ex){
        console.error('SAVE BILLING PROFILE ERROR:',ex);
        toast(ex?.message||'No pudimos guardar la actividad y el descuento.','error');
      }finally{
        if(btn?.isConnected){
          btn.disabled=false;
          btn.textContent=old;
        }
      }
    };

    $('#accountLoadPayment').onclick=()=>openPaymentEntry(row);
    $('#accountReviewPayments').onclick=()=>openPaymentReview(row);

  }catch(ex){
    console.error('OPEN PLAYER ACCOUNT ERROR:',ex);
    toast(ex?.message||'No se pudo cargar la cuenta.','error');
  }
}

async function renderTeams(){
  const {data,error}=await supabase.from('teams').select('*').order('name'); if(error) throw error;
  const teams=data||[]; content.innerHTML=`<div class="toolbar"><button class="btn primary" id="newTeam">+ Nuevo equipo</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Equipo</th><th>Categoría</th><th>Tira</th><th>Temporada</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${teams.map(t=>`<tr><td class="name-cell">${esc(t.name)}</td><td>${esc(t.category)}</td><td>${esc(t.tira)}</td><td>${t.season}</td><td>${t.is_enabled?statusBadge('ACTIVO','green'):statusBadge('INACTIVO','gray')}</td><td><button class="btn light small edit-team" data-id="${t.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#newTeam').onclick=()=>editTeam(); $$('.edit-team').forEach(b=>b.onclick=()=>editTeam(teams.find(x=>x.id===b.dataset.id)));
}
async function editTeam(row=null){
  let currentCoach='',currentLeague=''; if(row){const [c,l]=await Promise.all([supabase.from('team_coaches').select('coach_id').eq('team_id',row.id).maybeSingle(),supabase.from('team_leagues').select('league_id').eq('team_id',row.id).maybeSingle()]);currentCoach=c.data?.coach_id||'';currentLeague=l.data?.league_id||'';}
  openModal(row?'Editar equipo':'Nuevo equipo',`<form id="teamForm" class="form-grid"><label>Nombre<input name="name" required value="${esc(row?.name||'')}"></label><label>Categoría<input name="category" value="${esc(row?.category||'')}"></label><label>Tira<select name="tira"><option ${row?.tira==='VIOLETA'?'selected':''}>VIOLETA</option><option ${row?.tira==='BLANCA'?'selected':''}>BLANCA</option></select></label><label>Temporada<input name="season" type="number" value="${row?.season||new Date().getFullYear()}"></label><label>Entrenador<select name="coach"><option value="">Sin asignar</option>${catalogs.coaches.map(c=>`<option value="${c.id}" ${currentCoach===c.id?'selected':''}>${esc(c.first_name)} ${esc(c.last_name)}</option>`).join('')}</select></label><label>Liga<select name="league"><option value="">Sin asignar</option>${catalogs.leagues.map(l=>`<option value="${l.id}" ${currentLeague===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label><label>Estado<select name="enabled"><option value="true" ${row?.is_enabled!==false?'selected':''}>Activo</option><option value="false" ${row?.is_enabled===false?'selected':''}>Inactivo</option></select></label><div class="form-actions span-2"><button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar</button></div></form>`); $('#cancelModal').onclick=closeModal;
  $('#teamForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const payload={name:fd.get('name').trim(),category:fd.get('category').trim(),tira:fd.get('tira'),season:Number(fd.get('season')),condition:'mixta',is_enabled:fd.get('enabled')==='true'};let id=row?.id;if(row){const {error}=await supabase.from('teams').update(payload).eq('id',id);if(error){toast(error.message,'error');return;}}else{const {data,error}=await supabase.from('teams').insert(payload).select('id').single();if(error){toast(error.message,'error');return;}id=data.id;}const coach=fd.get('coach')||null,league=fd.get('league')||null;let r=await supabase.rpc('admin_set_team_single_coach',{p_team_id:id,p_coach_id:coach||null});if(r.error){toast(r.error.message,'error');return;}r=await supabase.rpc('admin_set_team_single_league',{p_team_id:id,p_league_id:league||null});if(r.error){toast(r.error.message,'error');return;}closeModal();toast('Equipo guardado');await loadCatalogs();renderTeams();};
}

async function renderLeagues(){
  const {data,error}=await supabase.from('leagues').select('*').order('name');if(error)throw error;const rows=data||[];
  content.innerHTML=`<div class="toolbar"><button id="newLeague" class="btn primary">+ Nueva liga</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Liga</th><th>Sitio web</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td class="name-cell">${esc(r.name)}</td><td>${r.website_url?`<a class="link" href="${esc(r.website_url)}" target="_blank">Abrir</a>`:'-'}</td><td>${r.is_enabled?statusBadge('ACTIVA','green'):statusBadge('INACTIVA','gray')}</td><td><button class="btn light small edit-league" data-id="${r.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#newLeague').onclick=()=>editLeague();$$('.edit-league').forEach(b=>b.onclick=()=>editLeague(rows.find(r=>r.id===b.dataset.id)));
}
function editLeague(row=null){openModal(row?'Editar liga':'Nueva liga',`<form id="leagueForm" class="form-grid"><label>Nombre<input name="name" required value="${esc(row?.name||'')}"></label><label>Sitio web<input name="website" value="${esc(row?.website_url||'')}"></label><label>Estado<select name="enabled"><option value="true" ${row?.is_enabled!==false?'selected':''}>Activa</option><option value="false" ${row?.is_enabled===false?'selected':''}>Inactiva</option></select></label><div class="form-actions span-2"><button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#leagueForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const payload={name:fd.get('name').trim(),website_url:fd.get('website').trim()||null,football_type:'11',is_enabled:fd.get('enabled')==='true'};const q=row?supabase.from('leagues').update(payload).eq('id',row.id):supabase.from('leagues').insert(payload);const {error}=await q;if(error){toast(error.message,'error');return;}closeModal();toast('Liga guardada');await loadCatalogs();renderLeagues();};}

async function renderMatches(){
  const {data,error}=await supabase.from('matches').select('*,teams:cataluna_team_id(name),leagues:league_id(name)').order('match_date',{ascending:false}).limit(100);if(error)throw error;const rows=data||[];
  content.innerHTML=`<div class="toolbar"><button id="newMatch" class="btn primary">+ Nuevo partido</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Equipo</th><th>Rival</th><th>Condición</th><th>Liga</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${dateLabel(r.match_date)} ${esc(String(r.match_time||'').slice(0,5))}</td><td class="name-cell">${esc(r.teams?.name||'-')}</td><td>${esc(r.opponent_name||'-')}</td><td>${esc(r.match_side)}</td><td>${esc(r.leagues?.name||'-')}</td><td>${r.is_suspended?statusBadge('SUSPENDIDO','red'):statusBadge(r.status||'PROGRAMADO','green')}</td><td><button class="btn light small edit-match" data-id="${r.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#newMatch').onclick=()=>editMatch();$$('.edit-match').forEach(b=>b.onclick=()=>editMatch(rows.find(r=>r.id===b.dataset.id)));
}
function editMatch(row=null){openModal(row?'Editar partido':'Nuevo partido',`<form id="matchForm" class="form-grid"><label>Equipo<select name="team" required><option value="">Seleccionar</option>${catalogs.teams.map(t=>`<option value="${t.id}" ${row?.cataluna_team_id===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>Rival<input name="opponent" required value="${esc(row?.opponent_name||'')}"></label><label>Fecha<input type="date" name="date" required value="${esc(row?.match_date||'')}"></label><label>Hora<input type="time" name="time" value="${esc(String(row?.match_time||'').slice(0,5))}"></label><label>Condición<select name="side"><option value="local" ${row?.match_side==='local'?'selected':''}>Local</option><option value="visitante" ${row?.match_side==='visitante'?'selected':''}>Visitante</option></select></label><label>Liga<select name="league"><option value="">Sin liga</option>${catalogs.leagues.map(l=>`<option value="${l.id}" ${row?.league_id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label><label>Ubicación<input name="location" value="${esc(row?.location||'')}"></label><label class="check-row"><input type="checkbox" name="suspended" ${row?.is_suspended?'checked':''}> Suspendido</label><label class="span-2">Notas<textarea name="notes" rows="3">${esc(row?.notes||'')}</textarea></label><div class="form-actions span-2"><button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#matchForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const payload={cataluna_team_id:fd.get('team'),league_id:fd.get('league')||null,opponent_name:fd.get('opponent').trim(),match_side:fd.get('side'),match_date:fd.get('date'),match_time:fd.get('time')||null,location:fd.get('location').trim()||null,is_suspended:e.target.suspended.checked,status:e.target.suspended.checked?'suspendido':'programado',notes:fd.get('notes').trim()||null,is_enabled:true};const q=row?supabase.from('matches').update(payload).eq('id',row.id):supabase.from('matches').insert(payload);const {error}=await q;if(error){toast(error.message,'error');return;}closeModal();toast('Partido guardado');renderMatches();};}

async function renderAttendance(){
  const {data:sessions,error}=await supabase.from('attendance_sessions').select('*,teams:team_id(name)').order('session_date',{ascending:false}).limit(100);if(error)throw error;content.innerHTML=`<div class="toolbar"><select id="attTeam"><option value="">Todos los equipos</option>${catalogs.teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select><input id="attDate" type="date"><button id="openAttendance" class="btn primary">Abrir asistencia</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Equipo</th><th>Tipo</th><th>Estado</th><th></th></tr></thead><tbody>${(sessions||[]).map(s=>`<tr><td>${dateLabel(s.session_date)}</td><td class="name-cell">${esc(s.teams?.name||'-')}</td><td>${esc(s.session_type)}</td><td>${s.is_suspended?statusBadge('SUSPENDIDO','red'):s.is_closed?statusBadge('CERRADO','gray'):statusBadge('ABIERTO','green')}</td><td><button class="btn light small load-session" data-id="${s.id}">Gestionar</button></td></tr>`).join('')}</tbody></table></div><div id="attendanceManager" style="margin-top:18px"></div>`;
  $('#openAttendance').onclick=async()=>{const team=$('#attTeam').value,date=$('#attDate').value;if(!team||!date){toast('Elegí equipo y fecha','error');return;}let {data:sess}=await supabase.from('attendance_sessions').select('*').eq('team_id',team).eq('session_date',date).eq('session_type','entrenamiento').maybeSingle();if(!sess){const r=await supabase.from('attendance_sessions').insert({team_id:team,session_date:date,session_type:'entrenamiento',title:'Entrenamiento'}).select('*').single();if(r.error){toast(r.error.message,'error');return;}sess=r.data;}manageAttendance(sess.id);};
  $$('.load-session').forEach(b=>b.onclick=()=>manageAttendance(b.dataset.id));
}
async function manageAttendance(sessionId){
  const {data:sess}=await supabase.from('attendance_sessions').select('*,teams:team_id(name)').eq('id',sessionId).single();const {data:members}=await supabase.from('team_students').select('student_id,students:student_id(id,first_name,last_name,is_injured)').eq('team_id',sess.team_id).eq('status','activo');const {data:records}=await supabase.from('attendance_records').select('*').eq('session_id',sessionId);const map=new Map((records||[]).map(r=>[r.student_id,r]));const el=$('#attendanceManager');el.innerHTML=`<div class="card"><div class="card-head"><div><h3>${esc(sess.teams?.name||'Equipo')} · ${dateLabel(sess.session_date)}</h3><div class="card-sub">Marcá la asistencia y guardá.</div></div><button id="saveAttendance" class="btn primary">Guardar asistencia</button></div><div class="roster">${(members||[]).map(m=>{const r=map.get(m.student_id);return `<div class="roster-row" data-student="${m.student_id}"><strong>${esc(m.students?.first_name)} ${esc(m.students?.last_name)}</strong><select class="status-select"><option value="presente" ${r?.status==='presente'?'selected':''}>Presente</option><option value="ausente" ${r?.status==='ausente'?'selected':''}>Ausente</option><option value="justificado" ${r?.status==='justificado'?'selected':''}>Justificado</option><option value="pendiente" ${!r||r.status==='pendiente'?'selected':''}>Pendiente</option></select><label class="switch"><input type="checkbox" class="injured" ${m.students?.is_injured||r?.is_injured_at_time?'checked':''}> Lesionado</label></div>`}).join('')}</div></div>`;$('#saveAttendance').onclick=async()=>{const items=$$('.roster-row',el).map(r=>({student_id:r.dataset.student,status:r.querySelector('select').value,notes:null,is_injured_at_time:r.querySelector('.injured').checked}));const {error}=await supabase.rpc('admin_save_attendance_records',{p_session_id:sessionId,p_records:items});if(error){toast(error.message,'error');return;}toast('Asistencia guardada');};
}

async function renderCitations(){
  const {data,error}=await supabase.from('matches').select('*,teams:cataluna_team_id(name)').gte('match_date',new Date(Date.now()-15*864e5).toISOString().slice(0,10)).order('match_date',{ascending:false}).limit(80);if(error)throw error;content.innerHTML=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Equipo</th><th>Rival</th><th></th></tr></thead><tbody>${(data||[]).map(m=>`<tr><td>${dateLabel(m.match_date)}</td><td>${esc(m.teams?.name||'-')}</td><td>${esc(m.opponent_name||'-')}</td><td><button class="btn primary small manage-citation" data-id="${m.id}" data-team="${m.cataluna_team_id}">Gestionar citación</button></td></tr>`).join('')}</tbody></table></div><div id="citationManager" style="margin-top:18px"></div>`;$$('.manage-citation').forEach(b=>b.onclick=()=>manageCitation(b.dataset.id,b.dataset.team));
}
async function manageCitation(matchId,teamId){const [{data:members},{data:records},{data:match}]=await Promise.all([supabase.from('team_students').select('student_id,students:student_id(id,first_name,last_name,is_injured)').eq('team_id',teamId).eq('status','activo'),supabase.from('citation_records').select('*').eq('match_id',matchId).eq('team_id',teamId),supabase.from('matches').select('*').eq('id',matchId).single()]);const map=new Map((records||[]).map(r=>[r.student_id,r]));const el=$('#citationManager');el.innerHTML=`<div class="card"><div class="card-head"><div><h3>Citación vs. ${esc(match?.opponent_name||'Rival')}</h3><div class="card-sub">${dateLabel(match?.match_date)}</div></div><button id="saveCitation" class="btn primary">Guardar citación</button></div><div class="roster">${(members||[]).map(m=>{const r=map.get(m.student_id);return `<div class="roster-row" data-student="${m.student_id}"><strong>${esc(m.students?.first_name)} ${esc(m.students?.last_name)}</strong><label class="switch"><input type="checkbox" class="called" ${r?.is_called?'checked':''}> Citado</label><label class="switch"><input type="checkbox" class="injured" ${m.students?.is_injured||r?.is_injured_at_time?'checked':''}> Lesionado</label></div>`}).join('')}</div></div>`;$('#saveCitation').onclick=async()=>{const items=$$('.roster-row',el).map(r=>({student_id:r.dataset.student,is_called:r.querySelector('.called').checked,is_injured_at_time:r.querySelector('.injured').checked}));const {error}=await supabase.rpc('admin_save_citation_records',{p_match_id:matchId,p_team_id:teamId,p_records:items});if(error){toast(error.message,'error');return;}toast('Citación guardada');};}

async function renderCommitment(){content.innerHTML=`<div class="toolbar"><input id="commitSearch" class="grow" placeholder="Buscar jugador"><button id="commitBtn" class="btn primary">Buscar</button></div><div id="commitResults"></div>`;$('#commitBtn').onclick=async()=>{const q=$('#commitSearch').value.trim();if(!q)return;const {data,error}=await supabase.rpc('admin_commitment_search_students',{p_search:q});if(error){toast(error.message,'error');return;}$('#commitResults').innerHTML=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Jugador</th><th>DNI</th><th></th></tr></thead><tbody>${(data||[]).map(r=>`<tr><td class="name-cell">${esc(r.first_name)} ${esc(r.last_name)}</td><td>${esc(r.dni)}</td><td><button class="btn light small commitment-year" data-id="${r.id}">Ver compromiso</button></td></tr>`).join('')}</tbody></table></div>`;$$('.commitment-year').forEach(b=>b.onclick=()=>openCommitmentYear(b.dataset.id));};}
async function openCommitmentYear(id){const y=new Date().getFullYear();const {data,error}=await supabase.rpc('admin_get_student_commitment_year',{p_student_id:id,p_year:y});if(error){toast(error.message,'error');return;}openModal(`Compromiso ${y}`,`<div class="metrics"><div class="metric"><div class="label">Entrenamientos</div><div class="value">${data?.training_total??data?.attendance_total??0}</div></div><div class="metric"><div class="label">Presentes</div><div class="value">${data?.training_present??data?.attendance_present??0}</div></div><div class="metric"><div class="label">Citaciones</div><div class="value">${data?.citations_total??0}</div></div><div class="metric"><div class="label">Partidos</div><div class="value">${data?.matches_attended??0}</div></div></div><pre style="white-space:pre-wrap;font-size:12px;background:#f7f4f8;padding:12px;border-radius:12px">${esc(JSON.stringify(data,null,2))}</pre>`);}

async function renderUsers(){const {data,error}=await supabase.rpc('admin_get_staff_users_page',{p_search:'',p_limit:100,p_offset:0});if(error)throw error;const rows=Array.isArray(data)?data:[];content.innerHTML=`<div class="card"><h3>Usuarios de administración y entrenamiento</h3><p class="section-note">Primera versión web: consulta centralizada. La edición avanzada de roles y contraseñas sigue disponible en la app y se incorporará al panel.</p></div><div class="table-wrap" style="margin-top:16px"><table class="data-table"><thead><tr><th>Nombre</th><th>DNI</th><th>Email</th><th>Roles</th><th>Equipos</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="name-cell">${esc(r.first_name)} ${esc(r.last_name)}</td><td>${esc(r.dni)}</td><td>${esc(r.email||'-')}</td><td><div class="pill-row">${(r.roles||[r.role]).filter(Boolean).map(x=>`<span class="pill">${esc(x)}</span>`).join('')}</div></td><td>${esc(r.team_names||'-')}</td></tr>`).join('')}</tbody></table></div>`;}

async function renderNews(){const {data,error}=await supabase.rpc('admin_get_news_current_month',{});if(error)throw error;content.innerHTML=`<div class="grid-2"><div class="card"><h3>Nueva novedad</h3><p class="card-sub">Se enviará también a la app según la configuración actual.</p><form id="newsForm" class="form-stack" style="margin-top:15px"><label>Mensaje<textarea name="message" rows="7" required></textarea></label><button class="btn primary">Publicar novedad</button></form></div><div class="card"><h3>Novedades del mes</h3><div style="margin-top:12px">${(data||[]).map(n=>`<div class="summary-box"><strong>${dateLabel(n.created_at)}</strong><p>${esc(n.message)}</p></div>`).join('')||'<div class="empty">Sin novedades este mes</div>'}</div></div></div>`;$('#newsForm').onsubmit=async e=>{e.preventDefault();const msg=e.target.message.value.trim();const {error}=await supabase.rpc('admin_send_news',{p_message:msg});if(error){toast(error.message,'error');return;}toast('Novedad publicada');renderNews();};}

async function renderSponsors(){const {data,error}=await supabase.from('sponsors').select('*').order('sort_order').order('name');if(error)throw error;const rows=data||[];content.innerHTML=`<div class="toolbar"><button id="newSponsor" class="btn primary">+ Nuevo sponsor</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Sponsor</th><th>Web</th><th>Orden</th><th>Estado</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td class="name-cell">${esc(r.name)}</td><td>${r.website_url?`<a class="link" href="${esc(r.website_url)}" target="_blank">Abrir</a>`:'-'}</td><td>${r.sort_order}</td><td>${r.is_enabled?statusBadge('ACTIVO','green'):statusBadge('INACTIVO','gray')}</td><td><button class="btn light small edit-sponsor" data-id="${r.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;$('#newSponsor').onclick=()=>editSponsor();$$('.edit-sponsor').forEach(b=>b.onclick=()=>editSponsor(rows.find(r=>r.id===b.dataset.id)));}
function editSponsor(r=null){openModal(r?'Editar sponsor':'Nuevo sponsor',`<form id="sponsorForm" class="form-grid"><label>Nombre<input name="name" required value="${esc(r?.name||'')}"></label><label>Orden<input type="number" name="order" value="${r?.sort_order||0}"></label><label>URL logo<input name="logo" value="${esc(r?.logo_url||'')}"></label><label>Sitio web<input name="web" value="${esc(r?.website_url||'')}"></label><label>Estado<select name="enabled"><option value="true" ${r?.is_enabled!==false?'selected':''}>Activo</option><option value="false" ${r?.is_enabled===false?'selected':''}>Inactivo</option></select></label><div class="form-actions span-2"><button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#sponsorForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const {error}=await supabase.rpc('admin_save_sponsor',{p_sponsor_id:r?.id||'',p_name:fd.get('name'),p_logo_url:fd.get('logo'),p_website_url:fd.get('web'),p_is_enabled:fd.get('enabled')==='true',p_sort_order:Number(fd.get('order'))});if(error){toast(error.message,'error');return;}closeModal();toast('Sponsor guardado');renderSponsors();};}

async function renderBenefits(){const {data,error}=await supabase.from('benefits').select('*').order('created_at',{ascending:false});if(error)throw error;const rows=data||[];content.innerHTML=`<div class="toolbar"><button id="newBenefit" class="btn primary">+ Nuevo beneficio</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Beneficio</th><th>Marca</th><th>Descripción</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td class="name-cell">${esc(r.benefit)}</td><td>${esc(r.brand_name)}</td><td>${esc(r.description||'-')}</td><td><button class="btn light small edit-benefit" data-id="${r.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;$('#newBenefit').onclick=()=>editBenefit();$$('.edit-benefit').forEach(b=>b.onclick=()=>editBenefit(rows.find(r=>r.id===b.dataset.id)));}
function editBenefit(r=null){openModal(r?'Editar beneficio':'Nuevo beneficio',`<form id="benefitForm" class="form-grid"><label>Beneficio<input name="benefit" required value="${esc(r?.benefit||'')}"></label><label>Marca<input name="brand" required value="${esc(r?.brand_name||'')}"></label><label class="span-2">Descripción<textarea name="description" rows="3">${esc(r?.description||'')}</textarea></label><label>URL logo<input name="logo" value="${esc(r?.logo_url||'')}"></label><label>Sitio web<input name="web" value="${esc(r?.website_url||'')}"></label><div class="form-actions span-2"><button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#benefitForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const {error}=await supabase.rpc('admin_save_benefit',{p_benefit_id:r?.id||'',p_benefit:fd.get('benefit'),p_description:fd.get('description'),p_brand_name:fd.get('brand'),p_logo_url:fd.get('logo'),p_website_url:fd.get('web')});if(error){toast(error.message,'error');return;}closeModal();toast('Beneficio guardado');renderBenefits();};}

async function renderPayments(){
  content.innerHTML=`
    <div class="toolbar">
      <input id="paySearch" class="grow" placeholder="Buscar jugador por DNI, nombre o apellido">
      <button id="paySearchBtn" class="btn primary">Buscar</button>
    </div>
    <div id="payResults">
      <div class="card">
        <h3>Gestión de cuentas</h3>
        <p class="section-note">Buscá un jugador para asignar actividad y descuento, cargar pagos o revisar pagos informados por sus adultos responsables.</p>
      </div>
    </div>
  `;

  const runSearch=async()=>{
    const q=$('#paySearch').value.trim();
    if(!q){
      toast('Ingresá DNI, nombre o apellido.','error');
      return;
    }

    const {data,error}=await supabase.rpc('admin_get_students_page',{
      p_search:q,
      p_filter:'all',
      p_limit:30,
      p_offset:0
    });

    if(error){
      toast(error.message,'error');
      return;
    }

    const rows=data?.items||[];

    $('#payResults').innerHTML=rows.length?`
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Jugador</th><th>DNI</th><th>Gestión</th></tr></thead>
          <tbody>
            ${rows.map(r=>`<tr>
              <td class="name-cell">${esc(r.first_name)} ${esc(r.last_name)}</td>
              <td>${esc(r.dni)}</td>
              <td>
                <div class="actions">
                  <button class="btn light small pay-account" data-id="${r.id}">Cuenta</button>
                  <button class="btn primary small pay-new" data-id="${r.id}">Cargar pago</button>
                  <button class="btn light small pay-review" data-id="${r.id}">Revisar pagos</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `:'<div class="card"><div class="empty">No encontramos jugadores con esa búsqueda.</div></div>';

    $('.pay-account').forEach(b=>b.onclick=()=>openPlayerAccount(rows.find(r=>r.id===b.dataset.id)));
    $('.pay-new').forEach(b=>b.onclick=()=>openPaymentEntry(rows.find(r=>r.id===b.dataset.id)));
    $('.pay-review').forEach(b=>b.onclick=()=>openPaymentReview(rows.find(r=>r.id===b.dataset.id)));
  };

  $('#paySearchBtn').onclick=runSearch;
  $('#paySearch').addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      runSearch();
    }
  });
}

async function openPaymentEntry(row){
  const {data,error}=await supabase.rpc('admin_finance_get_payment_options',{p_student_id:row.id});
  if(error){
    toast(error.message,'error');
    return;
  }

  const charges=data?.pending_charges||[];
  const extras=data?.extra_concepts||[];

  if(!charges.length && !extras.length){
    toast('Este jugador no tiene conceptos disponibles para cobrar.','error');
    return;
  }

  openModal(`Cargar pago · ${row.first_name} ${row.last_name}`,`
    <form id="paymentForm" class="form-grid">
      <label class="span-2">Concepto
        <select name="source" required>
          ${charges.length?`<optgroup label="Cuotas / deudas">${charges.map(c=>`<option value="charge:${c.id}" data-amount="${c.balance}">${esc(c.concept)} · ${money(c.balance)}</option>`).join('')}</optgroup>`:''}
          ${extras.length?`<optgroup label="Otros conceptos">${extras.map(c=>`<option value="extra:${c.id}" data-amount="${c.default_amount}">${esc(c.name)} · ${money(c.default_amount)}</option>`).join('')}</optgroup>`:''}
        </select>
      </label>

      <label>Importe
        <input name="amount" type="number" step="0.01" min="0.01" required>
      </label>

      <label>Fecha
        <input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required>
      </label>

      <label>Forma de pago
        <select name="method">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="otro">Otro</option>
        </select>
      </label>

      <div class="form-actions span-2">
        <button type="button" id="cancelModal" class="btn light">Cancelar</button>
        <button class="btn primary" type="submit">Registrar pago</button>
      </div>
    </form>
  `);

  $('#cancelModal').onclick=closeModal;
  const form=$('#paymentForm');
  const sel=form.source;

  const sync=()=>{
    const o=sel.selectedOptions[0];
    if(o) form.amount.value=o.dataset.amount||'';
  };

  sel.onchange=sync;
  sync();

  form.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(form);
    const [type,id]=String(fd.get('source')).split(':');
    const btn=form.querySelector('button[type="submit"]');
    btn.disabled=true;
    const old=btn.textContent;
    btn.textContent='Registrando...';

    try{
      const {error}=await supabase.rpc('admin_finance_record_payment',{
        p_student_id:row.id,
        p_charge_id:type==='charge'?id:null,
        p_extra_concept_id:type==='extra'?id:null,
        p_amount:Number(fd.get('amount')),
        p_payment_method:fd.get('method'),
        p_paid_at:fd.get('date')
      });

      if(error) throw error;

      closeModal();
      toast('Pago registrado correctamente');
      if(activeSection==='payments') await renderPayments();
    }catch(ex){
      console.error('RECORD PAYMENT ERROR:',ex);
      toast(ex?.message||'No pudimos registrar el pago.','error');
    }finally{
      if(btn?.isConnected){
        btn.disabled=false;
        btn.textContent=old;
      }
    }
  };
}

async function openPaymentReview(row){
  try{
    const {data,error}=await supabase.rpc('admin_finance_get_pending_submissions',{
      p_student_id:row.id
    });

    if(error) throw error;
    const items=Array.isArray(data)?data:[];

    openModal(`Revisar pagos · ${row.first_name} ${row.last_name}`,`
      <div class="review-list">
        ${items.length?items.map(item=>`
          <div class="review-card" data-submission-id="${item.id}">
            <div class="review-card-head">
              <div>
                <div class="eyebrow purple">${item.source_kind==='batch'?'PAGO ENVIADO POR FAMILIA':'PAGO INFORMADO'}</div>
                <div class="review-amount">${money(item.amount)}</div>
                <div class="card-sub">${dateLabel(item.paid_at)} · ${esc(item.payment_method||'transferencia')}</div>
              </div>
              ${statusBadge('PENDIENTE','amber')}
            </div>

            <div class="review-section-title">Conceptos</div>
            <div class="review-items">
              ${(item.items||[]).length?(item.items||[]).map(detail=>`
                <div class="kpi-line">
                  <span>${esc(detail.concept)}</span>
                  <strong>${money(detail.amount)}</strong>
                </div>
              `).join(''):`<div class="kpi-line"><span>${esc(item.concept||'Pago informado')}</span><strong>${money(item.amount)}</strong></div>`}
            </div>

            <div class="review-section-title">Comprobantes</div>
            <div class="proof-buttons">
              ${(item.files||[]).length?(item.files||[]).map((file,index)=>`
                <button
                  class="btn light small review-proof"
                  data-submission="${item.id}"
                  data-file-index="${index}">
                  Ver comprobante ${index+1}
                </button>
              `).join(''):'<span class="section-note">Sin archivo adjunto.</span>'}
            </div>

            <div class="review-actions">
              <button class="btn danger review-reject" data-id="${item.id}">Rechazar</button>
              <button class="btn green review-approve" data-id="${item.id}">Aprobar pago</button>
            </div>
          </div>
        `).join(''):'<div class="empty">No hay pagos pendientes de revisión para este jugador.</div>'}
      </div>
    `);

    const itemMap=new Map(items.map(item=>[String(item.id),item]));

    $('.review-proof').forEach(button=>{
      button.onclick=()=>{
        const item=itemMap.get(String(button.dataset.submission));
        const file=item?.files?.[Number(button.dataset.fileIndex)];
        if(file) openPaymentProof(file);
      };
    });

    const resolve=async(id,action)=>{
      const label=action==='approve'?'aprobar':'rechazar';
      if(!confirm(`¿Confirmás ${label} este pago?`)) return;

      const buttons=$('.review-approve,.review-reject');
      buttons.forEach(b=>b.disabled=true);

      try{
        const {error}=await supabase.rpc('admin_finance_resolve_submission',{
          p_submission_id:id,
          p_action:action
        });
        if(error) throw error;

        toast(action==='approve'?'Pago aprobado correctamente':'Pago rechazado');
        await openPaymentReview(row);
      }catch(ex){
        console.error('RESOLVE PAYMENT ERROR:',ex);
        toast(ex?.message||'No pudimos procesar el pago.','error');
        buttons.forEach(b=>b.disabled=false);
      }
    };

    $('.review-approve').forEach(b=>b.onclick=()=>resolve(b.dataset.id,'approve'));
    $('.review-reject').forEach(b=>b.onclick=()=>resolve(b.dataset.id,'reject'));

  }catch(ex){
    console.error('LOAD PAYMENT REVIEW ERROR:',ex);
    toast(ex?.message||'No pudimos cargar los pagos a revisar.','error');
  }
}

async function renderConcepts(){const {data,error}=await supabase.rpc('admin_finance_get_settings',{});if(error)throw error;const d=data||{};content.innerHTML=`<div class="grid-3"><div class="card"><div class="card-head"><h3>Actividades</h3><button class="btn primary small" id="newActivity">+ Agregar</button></div>${(d.activities||[]).map(x=>`<div class="kpi-line"><span>${esc(x.name)} · ${money(x.amount)} · día ${x.billing_day}</span><button class="btn light small edit-activity" data-id="${x.id}">Editar</button></div>`).join('')}</div><div class="card"><div class="card-head"><h3>Descuentos</h3><button class="btn primary small" id="newDiscount">+ Agregar</button></div><div class="kpi-line"><span>SIN DESCUENTO</span><strong>0%</strong></div>${(d.discounts||[]).map(x=>`<div class="kpi-line"><span>${esc(x.name)}</span><button class="btn light small edit-discount" data-id="${x.id}">${x.percentage}% · Editar</button></div>`).join('')}</div><div class="card"><div class="card-head"><h3>Otros conceptos</h3><button class="btn primary small" id="newExtra">+ Agregar</button></div>${(d.concepts||[]).map(x=>`<div class="kpi-line"><span>${esc(x.name)} · ${money(x.default_amount)}</span><button class="btn light small edit-extra" data-id="${x.id}">Editar</button></div>`).join('')}</div></div>`;
  $('#newActivity').onclick=()=>editConceptItem('activity');$('#newDiscount').onclick=()=>editConceptItem('discount');$('#newExtra').onclick=()=>editConceptItem('extra');$$('.edit-activity').forEach(b=>b.onclick=()=>editConceptItem('activity',(d.activities||[]).find(x=>x.id===b.dataset.id)));$$('.edit-discount').forEach(b=>b.onclick=()=>editConceptItem('discount',(d.discounts||[]).find(x=>x.id===b.dataset.id)));$$('.edit-extra').forEach(b=>b.onclick=()=>editConceptItem('extra',(d.concepts||[]).find(x=>x.id===b.dataset.id)));
}
function editConceptItem(type,r=null){const map={activity:{title:'actividad',fields:`<label>Nombre<input name="name" required value="${esc(r?.name||'')}"></label><label>Valor mensual<input type="number" step="0.01" name="amount" required value="${r?.amount??''}"></label><label>Día de vencimiento<input type="number" min="1" max="28" name="day" value="${r?.billing_day??10}"></label>`},discount:{title:'descuento',fields:`<label>Nombre<input name="name" required value="${esc(r?.name||'')}"></label><label>Porcentaje<input type="number" min="0.01" max="100" step="0.01" name="percentage" value="${r?.percentage??''}"></label>`},extra:{title:'concepto',fields:`<label>Nombre<input name="name" required value="${esc(r?.name||'')}"></label><label>Valor<input type="number" step="0.01" name="amount" value="${r?.default_amount??''}"></label>`}};const cfg=map[type];openModal(`${r?'Editar':'Nuevo'} ${cfg.title}`,`<form id="conceptForm" class="form-grid">${cfg.fields}<div class="form-actions span-2">${r?'<button type="button" id="deleteConcept" class="btn danger">Eliminar</button>':''}<button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#conceptForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);let fn,p;if(type==='activity'){fn=r?'admin_finance_update_activity':'admin_finance_create_activity';p=r?{p_id:r.id,p_name:fd.get('name'),p_amount:Number(fd.get('amount')),p_billing_day:Number(fd.get('day'))}:{p_name:fd.get('name'),p_amount:Number(fd.get('amount')),p_billing_day:Number(fd.get('day'))};}else if(type==='discount'){fn=r?'admin_finance_update_discount':'admin_finance_create_discount';p=r?{p_id:r.id,p_name:fd.get('name'),p_percentage:Number(fd.get('percentage'))}:{p_name:fd.get('name'),p_percentage:Number(fd.get('percentage'))};}else{fn=r?'admin_finance_update_extra_concept':'admin_finance_create_extra_concept';p=r?{p_id:r.id,p_name:fd.get('name'),p_default_amount:Number(fd.get('amount'))}:{p_name:fd.get('name'),p_default_amount:Number(fd.get('amount'))};}const {error}=await supabase.rpc(fn,p);if(error){toast(error.message,'error');return;}closeModal();toast('Concepto guardado');renderConcepts();};if(r)$('#deleteConcept').onclick=async()=>{if(!confirm('¿Eliminar este concepto para usos futuros? El historial se conserva.'))return;const fn=type==='activity'?'admin_finance_delete_activity':type==='discount'?'admin_finance_delete_discount':'admin_finance_delete_extra_concept';const {error}=await supabase.rpc(fn,{p_id:r.id});if(error){toast(error.message,'error');return;}closeModal();toast('Concepto eliminado');renderConcepts();};}

async function renderExpenses(){const {data,error}=await supabase.rpc('admin_expenses_list',{p_limit:200,p_offset:0,p_from:null,p_to:null,p_category:null});if(error)throw new Error('Falta ejecutar el SQL web de gastos y balances.');const rows=data?.items||[];content.innerHTML=`<div class="toolbar"><button id="newExpense" class="btn primary">+ Registrar gasto</button></div><div class="metrics"><div class="metric red"><div class="label">Total mostrado</div><div class="value">${money(rows.reduce((a,b)=>a+Number(b.amount||0),0))}</div></div><div class="metric"><div class="label">Movimientos</div><div class="value">${rows.length}</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Proveedor</th><th>Forma</th><th>Importe</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${dateLabel(r.expense_date)}</td><td>${statusBadge(r.category,'purple')}</td><td class="name-cell">${esc(r.description)}</td><td>${esc(r.supplier||'-')}</td><td>${esc(r.payment_method||'-')}</td><td class="money negative">${money(r.amount)}</td><td><button class="btn light small edit-expense" data-id="${r.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;$('#newExpense').onclick=()=>editExpense();$$('.edit-expense').forEach(b=>b.onclick=()=>editExpense(rows.find(r=>r.id===b.dataset.id)));}
function editExpense(r=null){const cats=['Alquiler','Sueldos','Servicios','Indumentaria','Material deportivo','Mantenimiento','Torneos y ligas','Transporte','Publicidad','Impuestos','Otros'];openModal(r?'Editar gasto':'Registrar gasto',`<form id="expenseForm" class="form-grid"><label>Fecha<input type="date" name="date" required value="${esc(r?.expense_date||new Date().toISOString().slice(0,10))}"></label><label>Categoría<select name="category">${cats.map(c=>`<option ${r?.category===c?'selected':''}>${c}</option>`).join('')}</select></label><label class="span-2">Descripción<input name="description" required value="${esc(r?.description||'')}"></label><label>Proveedor<input name="supplier" value="${esc(r?.supplier||'')}"></label><label>Forma de pago<select name="method"><option value="transferencia" ${r?.payment_method==='transferencia'?'selected':''}>Transferencia</option><option value="efectivo" ${r?.payment_method==='efectivo'?'selected':''}>Efectivo</option><option value="tarjeta" ${r?.payment_method==='tarjeta'?'selected':''}>Tarjeta</option><option value="otro" ${r?.payment_method==='otro'?'selected':''}>Otro</option></select></label><label>Importe<input type="number" step="0.01" name="amount" required value="${r?.amount??''}"></label><label class="span-2">Notas<textarea name="notes" rows="3">${esc(r?.notes||'')}</textarea></label><div class="form-actions span-2">${r?'<button type="button" id="deleteExpense" class="btn danger">Eliminar</button>':''}<button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar gasto</button></div></form>`);$('#cancelModal').onclick=closeModal;$('#expenseForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const {error}=await supabase.rpc('admin_expense_save',{p_expense_id:r?.id||null,p_expense_date:fd.get('date'),p_category:fd.get('category'),p_description:fd.get('description'),p_amount:Number(fd.get('amount')),p_payment_method:fd.get('method'),p_supplier:fd.get('supplier'),p_notes:fd.get('notes')});if(error){toast(error.message,'error');return;}closeModal();toast('Gasto guardado');renderExpenses();};if(r)$('#deleteExpense').onclick=async()=>{if(!confirm('¿Eliminar este gasto?'))return;const {error}=await supabase.rpc('admin_expense_delete',{p_expense_id:r.id});if(error){toast(error.message,'error');return;}closeModal();toast('Gasto eliminado');renderExpenses();};}

async function renderBalances(){const {data,error}=await supabase.rpc('admin_web_financial_dashboard',{p_months:12});if(error)throw error;const d=data||{},k=d.kpis||{},months=d.monthly||[];content.innerHTML=`<div class="metrics"><div class="metric green"><div class="label">Ingresos período</div><div class="value">${money(k.income_period)}</div></div><div class="metric red"><div class="label">Egresos período</div><div class="value">${money(k.expenses_period)}</div></div><div class="metric brand"><div class="label">Resultado</div><div class="value">${money(k.net_period)}</div></div><div class="metric"><div class="label">Margen</div><div class="value">${Number(k.margin_pct||0).toLocaleString('es-AR',{maximumFractionDigits:1})}%</div></div></div><div class="grid-2"><div class="card"><h3>Resultado mensual</h3><div class="chart-wrap"><canvas id="balanceBar"></canvas></div></div><div class="card"><h3>Ingresos, gastos y resultado</h3><div class="chart-wrap"><canvas id="balanceLine"></canvas></div></div></div><div class="grid-2" style="margin-top:18px"><div class="card"><h3>Gastos por categoría</h3><div class="chart-wrap small"><canvas id="balanceExpenseCat"></canvas></div></div><div class="card"><h3>Lectura del negocio</h3><div class="kpi-line"><span>Promedio ingreso mensual</span><strong>${money(k.avg_income_month)}</strong></div><div class="kpi-line"><span>Promedio gasto mensual</span><strong>${money(k.avg_expenses_month)}</strong></div><div class="kpi-line"><span>Deuda total vencida</span><strong>${money(k.total_debt)}</strong></div><div class="kpi-line"><span>Ingreso mensual esperado</span><strong>${money(k.expected_monthly)}</strong></div><div class="kpi-line"><span>Resultado promedio mensual</span><strong>${money(Number(k.avg_income_month||0)-Number(k.avg_expenses_month||0))}</strong></div></div></div>`;charts.push(new Chart($('#balanceBar'),{type:'bar',data:{labels:months.map(x=>x.label),datasets:[{label:'Ingresos',data:months.map(x=>x.income),backgroundColor:'#5A3686'},{label:'Gastos',data:months.map(x=>x.expenses),backgroundColor:'#d6b9cb'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}}));charts.push(new Chart($('#balanceLine'),{type:'line',data:{labels:months.map(x=>x.label),datasets:[{label:'Resultado',data:months.map(x=>x.net),borderColor:'#168A39',backgroundColor:'rgba(22,138,57,.12)',fill:true,tension:.3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}}));const cats=d.expense_categories||[];charts.push(new Chart($('#balanceExpenseCat'),{type:'bar',data:{labels:cats.map(x=>x.category),datasets:[{label:'Gastos',data:cats.map(x=>x.amount),backgroundColor:'#5A3686'}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}}}));}

async function renderFiles(){content.innerHTML=`<div class="grid-2"><div class="card"><h3>Modelo de ficha médica</h3><p class="section-note">El módulo móvil ya administra el modelo y las fichas médicas privadas. En la próxima iteración web incorporaremos carga, descarga y reemplazo desde navegador manteniendo el mismo Storage privado.</p><button class="btn primary" onclick="document.querySelector('[data-section=players]').click()">Ver jugadores</button></div><div class="card"><h3>Archivos e importaciones</h3><p class="section-note">La primera versión preserva las operaciones sensibles de importación/exportación en la app. El panel ya queda preparado para integrarlas en la siguiente actualización.</p></div></div>`;}

(async function boot(){
  try{ if(await verifyAdmin()) await showApp(); else { await supabase.auth.signOut(); loginView.classList.remove('hidden'); appView.classList.add('hidden'); } }
  catch(e){ console.error(e); }
})();
