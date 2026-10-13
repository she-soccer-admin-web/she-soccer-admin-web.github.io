import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

function norm(v){
  return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
function rowNorm(row){ const out={}; Object.entries(row||{}).forEach(([k,v])=>out[norm(k)]=v); return out; }
function dni(v){ return String(v??'').replace(/\D/g,''); }
function bool(v, fallback=null){
  const s=norm(v); if(!s) return fallback;
  if(['SI','S','YES','TRUE','1','HABILITADO','HABILITADA','ACTIVO','ACTIVA'].includes(s)) return true;
  if(['NO','N','FALSE','0','NO_HABILITADO','NO_HABILITADA','INACTIVO','INACTIVA'].includes(s)) return false;
  return fallback;
}
function enabled(v, fallback=null){ return bool(v,fallback); }
function gender(v,fallback='masculino'){
  const s=norm(v); if(['F','FEMENINO','MUJER'].includes(s)) return 'femenino';
  if(['M','MASCULINO','HOMBRE'].includes(s)) return 'masculino';
  if(['OTRO','OTRA','X'].includes(s)) return 'otro'; return fallback;
}
function dateValue(v){
  if(v===null||v===undefined||v==='') return '';
  if(typeof v==='number' && Number.isFinite(v)){
    const d=XLSX.SSF.parse_date_code(v); if(d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s=String(v).trim(); if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); if(m) return `${m[3]}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;
  const d=new Date(s); return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateAR(v){ if(!v) return ''; const s=String(v).slice(0,10); const [y,m,d]=s.split('-'); return d&&m&&y?`${d}/${m}/${y}`:s; }
function stamp(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function safeName(v){ return String(v||'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^_+|_+$/g,'')||'archivo'; }
function teamKey(v){ return norm(v).replace(/_/g,' '); }
function teams(v){ return String(v??'').split(/[;,|]/).map(x=>x.trim()).filter(Boolean); }

async function readRows(file){
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
  if(!wb.SheetNames.length) throw new Error('El Excel no contiene hojas.');
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:'',raw:false}).map(rowNorm);
}
function saveBook(wb,name){ XLSX.writeFile(wb,name,{compression:true}); }
function sheet(rows,headers){ return rows.length?XLSX.utils.json_to_sheet(rows):XLSX.utils.aoa_to_sheet([headers]); }
async function allRows(supabase,table,select='*'){
  const out=[]; const size=1000;
  for(let from=0;;from+=size){ const {data,error}=await supabase.from(table).select(select).range(from,from+size-1); if(error) throw error; out.push(...(data||[])); if((data||[]).length<size) break; }
  return out;
}
async function byDnis(supabase,dnis){
  const out=[]; for(let i=0;i<dnis.length;i+=200){ const {data,error}=await supabase.from('students').select('*').in('dni',dnis.slice(i,i+200)); if(error) throw error; out.push(...(data||[])); } return out;
}
function summary(openModal,closeModal,esc,title,d){
  const blocks=[];
  if(d.created) blocks.push(`<div class="metric green"><div class="label">Creados</div><div class="value">${d.created}</div></div>`);
  if(d.updated) blocks.push(`<div class="metric brand"><div class="label">Actualizados</div><div class="value">${d.updated}</div></div>`);
  if(d.enabled) blocks.push(`<div class="metric green"><div class="label">Habilitados</div><div class="value">${d.enabled}</div></div>`);
  if(d.disabled) blocks.push(`<div class="metric red"><div class="label">No habilitados</div><div class="value">${d.disabled}</div></div>`);
  blocks.push(`<div class="metric"><div class="label">Sin cambios / omitidos</div><div class="value">${d.skipped||0}</div></div>`);
  const warnings=(d.warnings||[]);
  openModal(title,`<div class="metrics">${blocks.join('')}</div>${warnings.length?`<div class="card" style="margin-top:16px"><h3>Observaciones</h3><p class="section-note">${warnings.slice(0,25).map(esc).join('<br>')}</p>${warnings.length>25?`<p class="section-note">... y ${warnings.length-25} más.</p>`:''}</div>`:''}<div class="form-actions" style="margin-top:16px"><button class="btn primary" id="filesSummaryClose">Aceptar</button></div>`);
  document.getElementById('filesSummaryClose').onclick=closeModal;
}

async function getTemplate(supabase){
  const {data,error}=await supabase.from('medical_form_templates').select('*').eq('is_active',true).order('uploaded_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw error; return data||null;
}
async function uploadTemplate(ctx,file){
  const {supabase,profile}=ctx;
  if(!file) return;
  const allowed=['application/pdf','image/jpeg','image/png','image/webp'];
  if(file.type && !allowed.includes(file.type)) throw new Error('Usá un archivo PDF, JPG, PNG o WEBP.');
  if(file.size>20*1024*1024) throw new Error('El archivo no puede superar 20 MB.');
  const bucket='medical-files'; const path=`templates/${Date.now()}-${safeName(file.name)}`;
  const {error:upErr}=await supabase.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type||undefined}); if(upErr) throw upErr;
  try{
    const {error:offErr}=await supabase.from('medical_form_templates').update({is_active:false}).eq('is_active',true); if(offErr) throw offErr;
    const {error:insErr}=await supabase.from('medical_form_templates').insert({storage_ref:`storage://${bucket}/${path}`,file_name:file.name,mime_type:file.type||null,is_active:true,uploaded_by:profile?.id||null}); if(insErr) throw insErr;
  }catch(e){ await supabase.storage.from(bucket).remove([path]); throw e; }
}
async function downloadPrivate(ctx,reference,name){
  const {supabase}=ctx; const ref=String(reference||'');
  const m=ref.match(/^storage:\/\/([^/]+)\/(.+)$/); if(!m) throw new Error('La referencia del archivo no es válida.');
  const {data,error}=await supabase.storage.from(m[1]).download(m[2]); if(error) throw error;
  const url=URL.createObjectURL(data); const a=document.createElement('a'); a.href=url; a.download=name||m[2].split('/').pop(); document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
}

async function exportAll(ctx){
  const {supabase}=ctx;
  const [students,links,profiles,teamLinks,teamRows]=await Promise.all([
    allRows(supabase,'students','*'), allRows(supabase,'student_guardians','*'), allRows(supabase,'profiles','id,dni,first_name,last_name,phone,email,role,parentesco,relationship,status,is_enabled,is_active,created_at,updated_at'), allRows(supabase,'team_students','student_id,team_id,status'), allRows(supabase,'teams','id,name,category,tira,season,is_enabled')
  ]);
  const pMap=new Map(profiles.map(x=>[x.id,x])); const tMap=new Map(teamRows.map(x=>[x.id,x])); const tByStudent=new Map();
  teamLinks.forEach(l=>{ if(l.status&&l.status!=='activo') return; const t=tMap.get(l.team_id); if(!t) return; if(!tByStudent.has(l.student_id)) tByStudent.set(l.student_id,[]); tByStudent.get(l.student_id).push(t.name); });
  const gByStudent=new Map(); links.forEach(l=>{ if(l.is_enabled===false||String(l.status||'activo').toLowerCase()==='inactivo') return; const p=pMap.get(l.guardian_id); if(!p) return; if(!gByStudent.has(l.student_id)) gByStudent.set(l.student_id,[]); gByStudent.get(l.student_id).push({link:l,p}); });
  const detail=[]; const players=[];
  students.slice().sort((a,b)=>`${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`,'es')).forEach(s=>{
    const gs=gByStudent.get(s.id)||[]; const base={
      'JUGADOR ID':s.id,'JUGADOR NOMBRE':s.first_name||'','JUGADOR APELLIDO':s.last_name||'','JUGADOR DNI':s.dni||'','FECHA NACIMIENTO':dateAR(s.birth_date),'GÉNERO':s.gender||'','ESTADO JUGADOR':s.is_enabled===false?'NO HABILITADO':'HABILITADO','LESIONADO':s.is_injured?'SI':'NO','SITUACIÓN':s.status||'','EQUIPOS':(tByStudent.get(s.id)||[]).join(' / '),'FOTO PERFIL':s.profile_photo_url||'','CREADO':s.created_at||'','ACTUALIZADO':s.updated_at||''
    };
    players.push({...base,'ADULTOS RESPONSABLES':gs.length});
    if(!gs.length) detail.push({...base,'PARENTESCO':'','ADULTO NOMBRE':'','ADULTO APELLIDO':'','ADULTO DNI':'','ADULTO TELÉFONO':'','ADULTO EMAIL':'','ADULTO ESTADO':''});
    gs.forEach(({link,p})=>detail.push({...base,'PARENTESCO':link.relationship||p.parentesco||p.relationship||'','ADULTO NOMBRE':p.first_name||'','ADULTO APELLIDO':p.last_name||'','ADULTO DNI':p.dni||'','ADULTO TELÉFONO':p.phone||'','ADULTO EMAIL':p.email||'','ADULTO ESTADO':p.is_enabled===false||p.is_active===false?'NO HABILITADO':'HABILITADO'}));
  });
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheet(detail,Object.keys(detail[0]||{})),'Listado completo'); XLSX.utils.book_append_sheet(wb,sheet(players,Object.keys(players[0]||{})),'Jugadores'); saveBook(wb,`SHE_SOCCER_JUGADORES_COMPLETO_${stamp()}.xlsx`);
}
function playerModel(){ const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['DNI','NOMBRE','APELLIDO','FECHA_NACIMIENTO','GENERO','ESTADO','LESIONADO','EQUIPOS']]),'Jugadores'); saveBook(wb,'MODELO_IMPORTAR_JUGADORES_SHE_SOCCER.xlsx'); }
function statusModel(){ const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['DNI','ESTADO']]),'Estados'); saveBook(wb,'MODELO_ESTADO_JUGADORES_SHE_SOCCER.xlsx'); }

async function importPlayers(ctx,file){
  const {supabase,profile,catalogs,openModal,closeModal,esc}=ctx; const raw=await readRows(file); if(!raw.length) throw new Error('El Excel no contiene jugadores.');
  const warnings=[]; const parsed=[]; const seen=new Set();
  raw.forEach((r,i)=>{ const line=i+2; const id=dni(r.DNI||r.DOCUMENTO); if(!id){warnings.push(`Fila ${line}: falta DNI.`); return;} if(seen.has(id)){warnings.push(`Fila ${line}: DNI ${id} repetido en el archivo.`); return;} seen.add(id);
    const state=enabled(r.ESTADO,null); if(String(r.ESTADO||'').trim() && state===null){warnings.push(`Fila ${line}: estado inválido para DNI ${id}.`); return;}
    const birthRaw=r.FECHA_NACIMIENTO||r.FECHA_DE_NACIMIENTO||r.NACIMIENTO; const birth=birthRaw?dateValue(birthRaw):''; if(birthRaw&&!birth){warnings.push(`Fila ${line}: fecha de nacimiento inválida para DNI ${id}.`); return;}
    parsed.push({line,dni:id,first:String(r.NOMBRE||r.FIRST_NAME||'').trim(),last:String(r.APELLIDO||r.LAST_NAME||'').trim(),birth,gender:r.GENERO||r.SEXO||'',state,injured:bool(r.LESIONADO,null),teamNames:teams(r.EQUIPOS||r.EQUIPO||''),teamsProvided:!!String(r.EQUIPOS||r.EQUIPO||'').trim()});
  });
  if(!parsed.length) throw new Error(warnings[0]||'No hay filas válidas para importar.');
  const existing=await byDnis(supabase,parsed.map(x=>x.dni)); const oldMap=new Map(existing.map(x=>[x.dni,x])); const before=new Map(existing.map(x=>[x.dni,x])); const created=new Set(); const up=[];
  parsed.forEach(r=>{ const o=oldMap.get(r.dni); if(!o&&(!r.first||!r.last||!r.birth)){warnings.push(`Fila ${r.line}: para crear DNI ${r.dni} completá NOMBRE, APELLIDO y FECHA_NACIMIENTO.`); return;} if(!o) created.add(r.dni); up.push({...(o||{}),dni:r.dni,first_name:r.first||o?.first_name||'',last_name:r.last||o?.last_name||'',birth_date:r.birth||o?.birth_date,gender:r.gender?gender(r.gender,o?.gender||'masculino'):(o?.gender||'masculino'),is_enabled:r.state===null?(o?.is_enabled!==false):r.state,is_injured:r.injured===null?(o?.is_injured||false):r.injured,status:o?.status||'activo',created_by:o?.created_by||profile?.id||null,created_by_role:o?.created_by_role||'administrativo'}); });
  if(!up.length) throw new Error(warnings[0]||'No hay filas válidas para importar.');
  const saved=[]; for(let i=0;i<up.length;i+=100){ const {data,error}=await supabase.from('students').upsert(up.slice(i,i+100),{onConflict:'dni'}).select('id,dni,is_enabled'); if(error) throw error; saved.push(...(data||[])); }
  const savedMap=new Map(saved.map(x=>[x.dni,x])); const teamMap=new Map((catalogs?.teams||[]).map(t=>[teamKey(t.name),t.id]));
  for(const r of parsed){ if(!r.teamsProvided) continue; const s=savedMap.get(r.dni); if(!s) continue; const ids=[]; r.teamNames.forEach(n=>{const id=teamMap.get(teamKey(n)); if(id) ids.push(id); else warnings.push(`Fila ${r.line}: no existe el equipo "${n}" para DNI ${r.dni}.`);}); const {error}=await supabase.rpc('admin_set_student_teams',{p_student_id:s.id,p_team_ids:[...new Set(ids)]}); if(error) warnings.push(`DNI ${r.dni}: no se pudieron actualizar los equipos.`); }
  const disabled=saved.filter(s=>{const o=before.get(s.dni); return o&&o.is_enabled!==false&&s.is_enabled===false;}).map(s=>s.id); if(disabled.length){ const n=await supabase.functions.invoke('send-disabled-student-notifications',{body:{student_ids:disabled}}); if(n.error) warnings.push('Los estados se actualizaron, pero alguna notificación de NO HABILITADO no pudo enviarse.'); }
  const createdCount=[...created].filter(x=>savedMap.has(x)).length; summary(openModal,closeModal,esc,'Importación de jugadores',{created:createdCount,updated:saved.length-createdCount,skipped:raw.length-saved.length,warnings});
}
async function importStatuses(ctx,file){
  const {supabase,openModal,closeModal,esc}=ctx; const raw=await readRows(file); if(!raw.length) throw new Error('El Excel no contiene filas.'); const warnings=[]; const wanted=new Map();
  raw.forEach((r,i)=>{const line=i+2; const id=dni(r.DNI||r.DOCUMENTO); const st=enabled(r.ESTADO||r.HABILITADO,null); if(!id){warnings.push(`Fila ${line}: falta DNI.`); return;} if(st===null){warnings.push(`Fila ${line}: estado inválido para DNI ${id}. Usá HABILITADO o NO HABILITADO.`); return;} wanted.set(id,{st,line});});
  if(!wanted.size) throw new Error(warnings[0]||'No hay filas válidas.'); const existing=await byDnis(supabase,[...wanted.keys()]); const map=new Map(existing.map(x=>[x.dni,x])); const on=[],off=[],notify=[];
  for(const [id,v] of wanted){const s=map.get(id); if(!s){warnings.push(`Fila ${v.line}: no existe un jugador con DNI ${id}.`); continue;} if(v.st&&s.is_enabled===false) on.push(s.id); if(!v.st&&s.is_enabled!==false){off.push(s.id); notify.push(s.id);} }
  if(on.length){const {error}=await supabase.from('students').update({is_enabled:true}).in('id',on); if(error) throw error;} if(off.length){const {error}=await supabase.from('students').update({is_enabled:false}).in('id',off); if(error) throw error;} if(notify.length){const n=await supabase.functions.invoke('send-disabled-student-notifications',{body:{student_ids:notify}}); if(n.error) warnings.push('Los estados se actualizaron, pero alguna notificación de NO HABILITADO no pudo enviarse.');}
  summary(openModal,closeModal,esc,'Estados actualizados',{enabled:on.length,disabled:off.length,skipped:raw.length-on.length-off.length,warnings});
}

export async function renderFilesTools(ctx){
  const {content,toast,esc}=ctx; const template=await getTemplate(ctx.supabase);
  const info=template?`<div class="kpi-line"><span>Archivo actual</span><strong>${esc(template.file_name||'Ficha médica')}</strong></div><div class="kpi-line"><span>Cargado</span><strong>${template.uploaded_at?new Date(template.uploaded_at).toLocaleString('es-AR'):'-'}</strong></div>`:'<p class="section-note">Todavía no hay un modelo de ficha médica cargado.</p>';
  content.innerHTML=`<div class="grid-2">
    <div class="card"><h3>Modelo de ficha médica</h3><p class="section-note">Cargá o reemplazá el modelo que los adultos responsables ven desde la app.</p><div class="summary-box">${info}</div><div class="form-actions" style="margin-top:14px"><input id="medicalTemplateInput" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" hidden><button class="btn primary" id="uploadMedicalTemplate">${template?'Reemplazar modelo':'Cargar modelo'}</button>${template?'<button class="btn light" id="downloadMedicalTemplate">Descargar actual</button>':''}</div></div>
    <div class="card"><h3>Listado completo</h3><p class="section-note">Descargá un Excel con todos los jugadores, estado, equipos y datos de sus adultos responsables.</p><button class="btn primary" id="exportPlayersExcel">Descargar Excel completo</button></div>
    <div class="card"><h3>Importar jugadores desde Excel</h3><p class="section-note">Crea jugadores nuevos o actualiza existentes usando el DNI como identificador. Los campos vacíos no pisan estado, lesión ni datos existentes.</p><div class="form-actions"><input id="playersImportInput" type="file" accept=".xlsx,.xls" hidden><button class="btn primary" id="importPlayersExcel">Cargar Excel de jugadores</button><button class="btn light" id="downloadPlayersTemplate">Descargar modelo</button></div></div>
    <div class="card"><h3>Habilitados / No habilitados</h3><p class="section-note">Cargá un Excel con DNI y ESTADO. Si un jugador pasa a NO HABILITADO, se dispara la misma notificación a sus adultos responsables que desde la edición individual.</p><div class="form-actions"><input id="statusImportInput" type="file" accept=".xlsx,.xls" hidden><button class="btn primary" id="importStatusExcel">Cargar Excel de estados</button><button class="btn light" id="downloadStatusTemplate">Descargar modelo</button></div></div>
  </div>`;
  const $=s=>content.querySelector(s);
  $('#uploadMedicalTemplate').onclick=()=>$('#medicalTemplateInput').click();
  $('#medicalTemplateInput').onchange=async e=>{const f=e.target.files?.[0]; if(!f)return; const b=$('#uploadMedicalTemplate'),old=b.textContent; b.disabled=true;b.textContent='Subiendo...';try{await uploadTemplate(ctx,f);toast('Modelo de ficha médica actualizado correctamente.');await renderFilesTools(ctx);}catch(ex){console.error(ex);toast(ex?.message||'No pudimos cargar el modelo.','error');if(b.isConnected){b.disabled=false;b.textContent=old;}}};
  if(template) $('#downloadMedicalTemplate').onclick=async()=>{try{await downloadPrivate(ctx,template.storage_ref,template.file_name);}catch(ex){toast(ex?.message||'No pudimos descargar el modelo.','error');}};
  $('#exportPlayersExcel').onclick=async()=>{const b=$('#exportPlayersExcel'),old=b.textContent;b.disabled=true;b.textContent='Generando Excel...';try{await exportAll(ctx);toast('Excel generado correctamente.');}catch(ex){console.error(ex);toast(ex?.message||'No pudimos generar el Excel.','error');}finally{if(b.isConnected){b.disabled=false;b.textContent=old;}}};
  $('#downloadPlayersTemplate').onclick=playerModel; $('#downloadStatusTemplate').onclick=statusModel;
  $('#importPlayersExcel').onclick=()=>$('#playersImportInput').click();
  $('#playersImportInput').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;const b=$('#importPlayersExcel'),old=b.textContent;b.disabled=true;b.textContent='Importando...';try{await importPlayers(ctx,f);}catch(ex){console.error(ex);toast(ex?.message||'No pudimos importar el Excel.','error');}finally{if(b.isConnected){b.disabled=false;b.textContent=old;}e.target.value='';}};
  $('#importStatusExcel').onclick=()=>$('#statusImportInput').click();
  $('#statusImportInput').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;const b=$('#importStatusExcel'),old=b.textContent;b.disabled=true;b.textContent='Actualizando...';try{await importStatuses(ctx,f);}catch(ex){console.error(ex);toast(ex?.message||'No pudimos actualizar los estados.','error');}finally{if(b.isConnected){b.disabled=false;b.textContent=old;}e.target.value='';}};
}
