export async function renderConceptsTools(ctx){
  const { content, supabase, toast, esc, money, openModal, closeModal } = ctx;
  const [financeResult, paymentSettingsResult] = await Promise.all([
    supabase.rpc('admin_finance_get_settings', {}),
    supabase.rpc('admin_finance_get_payment_settings', {})
  ]);
  if (financeResult.error) throw financeResult.error;
  if (paymentSettingsResult.error) throw paymentSettingsResult.error;
  const d = financeResult.data || {};
  const ps = paymentSettingsResult.data || {};
  const activities = d.activities || [];
  const discounts = d.discounts || [];
  const concepts = d.concepts || [];
  const venues = d.venues || [];

  content.innerHTML = `
    <div class="grid-3">
      <div class="card">
        <div class="card-head"><h3>Actividades</h3><button class="btn primary small" id="newActivity">+ Agregar</button></div>
        ${activities.map(x => `<div class="kpi-line"><span>${esc(x.name)} · ${money(x.amount)} · día ${x.billing_day} · ${Number(x.sessions_per_week || 1)} vez${Number(x.sessions_per_week || 1) === 1 ? '' : 'es'} por semana</span><button class="btn light small edit-activity" data-id="${x.id}">Editar</button></div>`).join('') || '<div class="section-note">Sin actividades cargadas.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><h3>Descuentos</h3><button class="btn primary small" id="newDiscount">+ Agregar</button></div>
        <div class="kpi-line"><span>SIN DESCUENTO</span><strong>0%</strong></div>
        ${discounts.map(x => `<div class="kpi-line"><span>${esc(x.name)}</span><button class="btn light small edit-discount" data-id="${x.id}">${x.percentage}% · Editar</button></div>`).join('')}
      </div>
      <div class="card">
        <div class="card-head"><h3>Otros conceptos</h3><button class="btn primary small" id="newExtra">+ Agregar</button></div>
        ${concepts.map(x => `<div class="kpi-line"><span>${esc(x.name)} · ${money(x.default_amount)}</span><button class="btn light small edit-extra" data-id="${x.id}">Editar</button></div>`).join('') || '<div class="section-note">Sin otros conceptos cargados.</div>'}
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head">
        <div><h3>Sedes de entrenamiento</h3><div class="card-sub">La familia podrá elegir una sede al definir los días del mes.</div></div>
        <button class="btn primary small" id="newVenue">+ Agregar</button>
      </div>
      ${venues.length ? venues.map(v => `<div class="kpi-line"><span>${esc(v.name)}${v.address ? ` · ${esc(v.address)}` : ''}</span><button class="btn light small edit-venue" data-id="${v.id}">Editar</button></div>`).join('') : '<div class="section-note">Todavía no hay sedes cargadas. Hasta que cargues una, la sede no será obligatoria.</div>'}
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><div><h3>Configuración de pagos</h3><div class="card-sub">Datos que verá el adulto responsable al momento de pagar</div></div></div>
      <form id="paymentSettingsForm" class="form-grid">
        <label class="span-2" style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="installments_enabled" ${ps.installments_enabled ? 'checked' : ''} style="width:auto">Habilitar opción “Pago en cuotas”</label>
        <label class="span-2">Link de pago en cuotas<input name="installments_url" placeholder="https://..." value="${esc(ps.installments_url || '')}"></label>
        <label>Banco<input name="bank_name" value="${esc(ps.bank_name || '')}"></label>
        <label>Titular de la cuenta<input name="account_holder" value="${esc(ps.account_holder || '')}"></label>
        <label>CUIT<input name="tax_id" value="${esc(ps.tax_id || '')}"></label>
        <label>Alias<input name="alias" value="${esc(ps.alias || '')}"></label>
        <label class="span-2">CBU<input name="cbu" value="${esc(ps.cbu || '')}"></label>
        <div class="form-actions span-2"><button class="btn primary">Guardar configuración de pagos</button></div>
      </form>
    </div>`;

  function editConceptItem(type, r = null){
    const map = {
      activity: { title:'actividad', fields:`<label>Nombre<input name="name" required value="${esc(r?.name || '')}"></label><label>Valor mensual<input type="number" step="0.01" name="amount" required value="${r?.amount ?? ''}"></label><label>Día de vencimiento<input type="number" min="1" max="28" name="day" value="${r?.billing_day ?? 10}"></label><label>Entrenamientos por semana<select name="sessions" required>${[1,2,3,4,5].map(n => `<option value="${n}" ${Number(r?.sessions_per_week || 1) === n ? 'selected' : ''}>${n} vez${n === 1 ? '' : 'es'} por semana</option>`).join('')}</select></label>` },
      discount: { title:'descuento', fields:`<label>Nombre<input name="name" required value="${esc(r?.name || '')}"></label><label>Porcentaje<input type="number" min="0.01" max="100" step="0.01" name="percentage" value="${r?.percentage ?? ''}"></label>` },
      extra: { title:'concepto', fields:`<label>Nombre<input name="name" required value="${esc(r?.name || '')}"></label><label>Valor<input type="number" step="0.01" name="amount" value="${r?.default_amount ?? ''}"></label>` }
    };
    const cfg = map[type];
    openModal(`${r ? 'Editar' : 'Nuevo'} ${cfg.title}`, `<form id="conceptForm" class="form-grid">${cfg.fields}<div class="form-actions span-2">${r ? '<button type="button" id="deleteConcept" class="btn danger">Eliminar</button>' : ''}<button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar</button></div></form>`);
    document.querySelector('#cancelModal').onclick = closeModal;
    document.querySelector('#conceptForm').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      let fn, p;
      if (type === 'activity'){
        fn = r ? 'admin_finance_update_activity_v2' : 'admin_finance_create_activity_v2';
        p = r ? {p_id:r.id,p_name:fd.get('name'),p_amount:Number(fd.get('amount')),p_billing_day:Number(fd.get('day')),p_sessions_per_week:Number(fd.get('sessions'))}
              : {p_name:fd.get('name'),p_amount:Number(fd.get('amount')),p_billing_day:Number(fd.get('day')),p_sessions_per_week:Number(fd.get('sessions'))};
      } else if (type === 'discount'){
        fn = r ? 'admin_finance_update_discount' : 'admin_finance_create_discount';
        p = r ? {p_id:r.id,p_name:fd.get('name'),p_percentage:Number(fd.get('percentage'))} : {p_name:fd.get('name'),p_percentage:Number(fd.get('percentage'))};
      } else {
        fn = r ? 'admin_finance_update_extra_concept' : 'admin_finance_create_extra_concept';
        p = r ? {p_id:r.id,p_name:fd.get('name'),p_default_amount:Number(fd.get('amount'))} : {p_name:fd.get('name'),p_default_amount:Number(fd.get('amount'))};
      }
      const { error } = await supabase.rpc(fn, p);
      if (error){ toast(error.message, 'error'); return; }
      closeModal(); toast('Concepto guardado'); await renderConceptsTools(ctx);
    };
    if (r) document.querySelector('#deleteConcept').onclick = async () => {
      if (!confirm('¿Eliminar este concepto para usos futuros? El historial se conserva.')) return;
      const fn = type === 'activity' ? 'admin_finance_delete_activity' : type === 'discount' ? 'admin_finance_delete_discount' : 'admin_finance_delete_extra_concept';
      const { error } = await supabase.rpc(fn, { p_id:r.id });
      if (error){ toast(error.message, 'error'); return; }
      closeModal(); toast('Concepto eliminado'); await renderConceptsTools(ctx);
    };
  }

  function editVenue(r = null){
    openModal(r ? 'Editar sede' : 'Nueva sede', `<form id="venueForm" class="form-grid"><label>Nombre de la sede<input name="name" required value="${esc(r?.name || '')}"></label><label>Dirección<input name="address" value="${esc(r?.address || '')}"></label><div class="form-actions span-2">${r ? '<button type="button" id="deleteVenue" class="btn danger">Eliminar</button>' : ''}<button type="button" id="cancelModal" class="btn light">Cancelar</button><button class="btn primary">Guardar sede</button></div></form>`);
    document.querySelector('#cancelModal').onclick = closeModal;
    document.querySelector('#venueForm').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const { error } = await supabase.rpc('admin_training_venue_save', {p_id:r?.id || null,p_name:String(fd.get('name') || '').trim(),p_address:String(fd.get('address') || '').trim() || null});
      if (error){ toast(error.message, 'error'); return; }
      closeModal(); toast('Sede guardada'); await renderConceptsTools(ctx);
    };
    if (r) document.querySelector('#deleteVenue').onclick = async () => {
      if (!confirm('¿Eliminar esta sede para futuras elecciones?')) return;
      const { error } = await supabase.rpc('admin_training_venue_delete', { p_id:r.id });
      if (error){ toast(error.message, 'error'); return; }
      closeModal(); toast('Sede eliminada'); await renderConceptsTools(ctx);
    };
  }

  document.querySelector('#newActivity').onclick = () => editConceptItem('activity');
  document.querySelector('#newDiscount').onclick = () => editConceptItem('discount');
  document.querySelector('#newExtra').onclick = () => editConceptItem('extra');
  document.querySelector('#newVenue').onclick = () => editVenue();
  document.querySelectorAll('.edit-activity').forEach(b => b.onclick = () => editConceptItem('activity', activities.find(x => x.id === b.dataset.id)));
  document.querySelectorAll('.edit-discount').forEach(b => b.onclick = () => editConceptItem('discount', discounts.find(x => x.id === b.dataset.id)));
  document.querySelectorAll('.edit-extra').forEach(b => b.onclick = () => editConceptItem('extra', concepts.find(x => x.id === b.dataset.id)));
  document.querySelectorAll('.edit-venue').forEach(b => b.onclick = () => editVenue(venues.find(x => x.id === b.dataset.id)));

  document.querySelector('#paymentSettingsForm').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      p_installments_enabled:fd.get('installments_enabled') === 'on',
      p_installments_url:String(fd.get('installments_url') || ''),
      p_bank_name:String(fd.get('bank_name') || ''),
      p_account_holder:String(fd.get('account_holder') || ''),
      p_tax_id:String(fd.get('tax_id') || ''),
      p_alias:String(fd.get('alias') || ''),
      p_cbu:String(fd.get('cbu') || '')
    };
    const { error } = await supabase.rpc('admin_finance_update_payment_settings', payload);
    if (error){ toast(error.message, 'error'); return; }
    toast('Configuración de pagos guardada'); await renderConceptsTools(ctx);
  };
}
