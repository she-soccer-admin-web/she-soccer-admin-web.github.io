export async function renderRegistration2027Tools(ctx){
  const {content,supabase,toast,esc,dateLabel,statusBadge}=ctx;

  const result=await supabase.rpc('admin_registration_2027_get',{});
  if(result.error) throw result.error;

  const data=result.data||{};
  const settings=data.settings||{};
  const entries=Array.isArray(data.entries)?data.entries:[];
  const summary=data.summary||{};

  const dayLabel=d=>{
    const map={lunes:'Lunes',martes:'Martes',miercoles:'Miércoles',jueves:'Jueves',viernes:'Viernes'};
    return map[String(d||'').toLowerCase()]||String(d||'');
  };

  content.innerHTML=`
    <div class="hero">
      <div>
        <h2>Inscripción 2027</h2>
        <p>Configuración de la inscripción, acceso a la tienda y seguimiento de jugadores.</p>
      </div>
      <div class="hero-badge">${settings.is_enabled?'ACTIVA':'DESACTIVADA'}</div>
    </div>

    <div class="metrics">
      <div class="metric brand">
        <div class="label">Llegaron a la tienda</div>
        <div class="value">${Number(summary.reached_store||0)}</div>
        <div class="sub">Preinscripción completada</div>
      </div>
      <div class="metric green">
        <div class="label">Inscriptos confirmados</div>
        <div class="value">${Number(summary.confirmed||0)}</div>
        <div class="sub">Marcados por Administración</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h3>Configuración Inscripción 2027</h3>
          <div class="card-sub">Estos datos se muestran en la app del Adulto Responsable.</div>
        </div>
      </div>

      <form id="registration2027SettingsForm" class="form-grid">
        <label class="span-2" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" name="is_enabled" ${settings.is_enabled?'checked':''} style="width:auto">
          Activar Inscripción 2027 en la app
        </label>

        <label class="span-2">Link de la tienda
          <input name="store_url" placeholder="https://..." value="${esc(settings.store_url||'')}">
        </label>

        <label class="span-2">Texto informativo
          <textarea name="info_text" rows="5" placeholder="Información que verá la familia antes de finalizar la inscripción.">${esc(settings.info_text||'')}</textarea>
        </label>

        <label class="span-2">Texto del botón final
          <input name="final_button_text" value="${esc(settings.final_button_text||'FINALIZÁ TU INSCRIPCIÓN Y PERSONALIZÁ TU REMERA')}">
        </label>

        <div class="span-2">
          <label>Imagen de la camiseta
            <input id="registrationShirtFile" type="file" accept="image/png,image/jpeg,image/webp">
          </label>
          ${settings.shirt_image_url?`
            <div style="margin-top:12px;display:flex;align-items:center;gap:14px">
              <img src="${esc(settings.shirt_image_url)}" alt="Camiseta 2027" style="width:120px;height:120px;object-fit:contain;background:#fff;border-radius:16px;padding:8px">
              <div class="section-note">Imagen actual. Si elegís un archivo nuevo se reemplaza al guardar.</div>
            </div>
          `:''}
        </div>

        <div class="form-actions span-2">
          <button class="btn primary" id="saveRegistration2027Settings" type="submit">Guardar configuración</button>
        </div>
      </form>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head">
        <div>
          <h3>Jugadores · Inscripción 2027</h3>
          <div class="card-sub">Aparecen quienes llegaron a la tienda o ya fueron confirmados por Administración.</div>
        </div>
        <input id="registration2027Search" placeholder="Buscar nombre, apellido o DNI" style="max-width:320px">
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Jugador</th>
              <th>DNI</th>
              <th>Responsable</th>
              <th>Sede 2027</th>
              <th>Días 2027</th>
              <th>Competencia</th>
              <th>Preinscripción</th>
              <th>Inscripción 2027</th>
            </tr>
          </thead>
          <tbody id="registration2027Rows"></tbody>
        </table>
      </div>
    </div>
  `;

  const renderRows=(query='')=>{
    const q=String(query||'').trim().toLowerCase();
    const filtered=entries.filter(x=>{
      if(!q) return true;
      return [
        x.first_name,x.last_name,x.dni,x.guardian_name,x.venue_name
      ].some(v=>String(v||'').toLowerCase().includes(q));
    });

    const tbody=document.querySelector('#registration2027Rows');
    tbody.innerHTML=filtered.map(x=>`
      <tr>
        <td class="name-cell">${esc(x.first_name)} ${esc(x.last_name)}</td>
        <td>${esc(x.dni||'')}</td>
        <td>
          <strong>${esc(x.guardian_name||'Sin responsable registrado')}</strong>
          ${x.guardian_email?`<div class="muted">${esc(x.guardian_email)}</div>`:''}
          ${x.guardian_phone?`<div class="muted">${esc(x.guardian_phone)}</div>`:''}
        </td>
        <td>${esc(x.venue_name||'SIN DEFINIR')}</td>
        <td>${Array.isArray(x.training_days)&&x.training_days.length?x.training_days.map(dayLabel).map(esc).join(' · '):'<span class="muted">SIN DEFINIR</span>'}</td>
        <td>${x.interested_competition===true?statusBadge('SÍ','green'):x.interested_competition===false?statusBadge('NO','gray'):'-'}</td>
        <td>
          ${x.reached_store?statusBadge('LLEGÓ A LA TIENDA','brand'):statusBadge('NO REGISTRADO','gray')}
          ${x.reached_store_at?`<div class="muted" style="margin-top:4px">${dateLabel(x.reached_store_at)}</div>`:''}
        </td>
        <td>
          <button class="btn small ${x.confirmed_enrolled?'green':'light'} toggle-registration-confirmed"
            data-id="${x.student_id}" data-confirmed="${x.confirmed_enrolled?'true':'false'}">
            ${x.confirmed_enrolled?'✓ INSCRIPTO 2027':'Marcar inscripto'}
          </button>
        </td>
      </tr>
    `).join('')||'<tr><td colspan="8" class="empty">Todavía no hay jugadores en Inscripción 2027.</td></tr>';

    document.querySelectorAll('.toggle-registration-confirmed').forEach(btn=>{
      btn.onclick=async()=>{
        const studentId=btn.dataset.id;
        const current=btn.dataset.confirmed==='true';
        btn.disabled=true;
        try{
          const res=await supabase.rpc('admin_registration_2027_set_confirmed',{
            p_student_id:studentId,
            p_confirmed:!current
          });
          if(res.error) throw res.error;
          toast(!current?'Jugador marcado como INSCRIPTO 2027':'Se quitó la confirmación 2027');
          await renderRegistration2027Tools(ctx);
        }catch(ex){
          toast(ex?.message||'No pudimos actualizar la inscripción.','error');
          btn.disabled=false;
        }
      };
    });
  };

  renderRows();
  document.querySelector('#registration2027Search').oninput=e=>renderRows(e.target.value);

  document.querySelector('#registration2027SettingsForm').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const saveButton=document.querySelector('#saveRegistration2027Settings');
    saveButton.disabled=true;
    saveButton.textContent='Guardando...';

    try{
      const fd=new FormData(form);
      let imageUrl=String(settings.shirt_image_url||'');
      const file=document.querySelector('#registrationShirtFile')?.files?.[0];

      if(file){
        if(file.size>10*1024*1024) throw new Error('La imagen no puede superar los 10 MB.');
        const ext=(file.name.split('.').pop()||'png').toLowerCase().replace(/[^a-z0-9]/g,'')||'png';
        const path=`shirt-2027-${Date.now()}.${ext}`;
        const upload=await supabase.storage.from('registration-assets').upload(path,file,{
          upsert:true,
          contentType:file.type||'image/png'
        });
        if(upload.error) throw upload.error;
        const publicResult=supabase.storage.from('registration-assets').getPublicUrl(path);
        imageUrl=publicResult.data?.publicUrl||'';
        if(!imageUrl) throw new Error('No pudimos obtener la URL pública de la camiseta.');
      }

      const result=await supabase.rpc('admin_registration_2027_update_settings',{
        p_is_enabled:fd.get('is_enabled')==='on',
        p_store_url:String(fd.get('store_url')||'').trim(),
        p_info_text:String(fd.get('info_text')||'').trim(),
        p_shirt_image_url:imageUrl,
        p_final_button_text:String(fd.get('final_button_text')||'').trim()
      });
      if(result.error) throw result.error;

      toast('Configuración de Inscripción 2027 guardada');
      await renderRegistration2027Tools(ctx);
    }catch(ex){
      toast(ex?.message||'No pudimos guardar la configuración.','error');
      saveButton.disabled=false;
      saveButton.textContent='Guardar configuración';
    }
  };
}
