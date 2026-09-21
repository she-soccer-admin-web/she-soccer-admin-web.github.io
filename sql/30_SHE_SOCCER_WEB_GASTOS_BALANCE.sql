-- ============================================================
-- SHE SOCCER ADMIN WEB — GASTOS + DASHBOARD FINANCIERO
-- Ejecutar en el MISMO Supabase usado por la app SHE SOCCER.
-- Migración aditiva: no borra datos existentes.
-- ============================================================

begin;

create table if not exists public.club_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null default 'transferencia'
    check (payment_method in ('efectivo','transferencia','tarjeta','otro')),
  supplier text,
  notes text,
  receipt_ref text,
  is_void boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists club_expenses_date_idx
  on public.club_expenses(expense_date desc);
create index if not exists club_expenses_category_idx
  on public.club_expenses(category, expense_date desc);

alter table public.club_expenses enable row level security;

drop policy if exists "she admin full club expenses" on public.club_expenses;
create policy "she admin full club expenses"
on public.club_expenses
for all to authenticated
using (public.is_administrativo())
with check (public.is_administrativo());

grant select, insert, update, delete on public.club_expenses to authenticated;

-- ------------------------------------------------------------
-- LISTADO DE GASTOS
-- ------------------------------------------------------------
create or replace function public.admin_expenses_list(
  p_limit integer default 200,
  p_offset integer default 0,
  p_from date default null,
  p_to date default null,
  p_category text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_items jsonb;
  v_total bigint;
  v_amount numeric(14,2);
begin
  if auth.uid() is null or not public.is_administrativo() then
    raise exception 'not_authorized';
  end if;

  select count(*), coalesce(sum(e.amount),0)
  into v_total, v_amount
  from public.club_expenses e
  where not e.is_void
    and (p_from is null or e.expense_date >= p_from)
    and (p_to is null or e.expense_date <= p_to)
    and (nullif(trim(coalesce(p_category,'')),'') is null or e.category = p_category);

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.expense_date desc, x.created_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select *
    from public.club_expenses e
    where not e.is_void
      and (p_from is null or e.expense_date >= p_from)
      and (p_to is null or e.expense_date <= p_to)
      and (nullif(trim(coalesce(p_category,'')),'') is null or e.category = p_category)
    order by e.expense_date desc, e.created_at desc
    limit greatest(1,least(coalesce(p_limit,200),1000))
    offset greatest(0,coalesce(p_offset,0))
  ) x;

  return jsonb_build_object(
    'items', coalesce(v_items,'[]'::jsonb),
    'total_count', v_total,
    'total_amount', coalesce(v_amount,0)
  );
end;
$$;

-- ------------------------------------------------------------
-- CREAR / EDITAR GASTO
-- ------------------------------------------------------------
create or replace function public.admin_expense_save(
  p_expense_id uuid,
  p_expense_date date,
  p_category text,
  p_description text,
  p_amount numeric,
  p_payment_method text,
  p_supplier text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
  v_category text := trim(coalesce(p_category,''));
  v_description text := trim(coalesce(p_description,''));
  v_method text := lower(trim(coalesce(p_payment_method,'transferencia')));
begin
  if auth.uid() is null or not public.is_administrativo() then
    raise exception 'not_authorized';
  end if;

  if v_category = '' then raise exception 'category_required'; end if;
  if v_description = '' then raise exception 'description_required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if v_method not in ('efectivo','transferencia','tarjeta','otro') then
    raise exception 'invalid_payment_method';
  end if;

  if p_expense_id is null then
    insert into public.club_expenses(
      expense_date,category,description,amount,payment_method,supplier,notes,created_by
    ) values (
      coalesce(p_expense_date,current_date),v_category,v_description,round(p_amount,2),v_method,
      nullif(trim(coalesce(p_supplier,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid()
    ) returning id into v_id;
  else
    update public.club_expenses set
      expense_date=coalesce(p_expense_date,expense_date),
      category=v_category,
      description=v_description,
      amount=round(p_amount,2),
      payment_method=v_method,
      supplier=nullif(trim(coalesce(p_supplier,'')),''),
      notes=nullif(trim(coalesce(p_notes,'')),''),
      updated_at=now()
    where id=p_expense_id and not is_void
    returning id into v_id;

    if v_id is null then raise exception 'expense_not_found'; end if;
  end if;

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- BAJA LÓGICA DE GASTO
-- ------------------------------------------------------------
create or replace function public.admin_expense_delete(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_administrativo() then
    raise exception 'not_authorized';
  end if;

  update public.club_expenses
  set is_void=true, updated_at=now()
  where id=p_expense_id and not is_void;

  if not found then raise exception 'expense_not_found'; end if;
end;
$$;

-- ------------------------------------------------------------
-- DASHBOARD FINANCIERO PARA WEB
-- Devuelve KPIs + serie mensual + categorías de gasto.
-- ------------------------------------------------------------
create or replace function public.admin_web_financial_dashboard(
  p_months integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_months integer := greatest(1,least(coalesce(p_months,12),36));
  v_current_month date := date_trunc('month',current_date)::date;
  v_next_month date := (date_trunc('month',current_date)+interval '1 month')::date;
  v_period_start date;
  v_period_end date := (date_trunc('month',current_date)+interval '1 month')::date;

  v_income_month numeric(14,2) := 0;
  v_expenses_month numeric(14,2) := 0;
  v_income_period numeric(14,2) := 0;
  v_expenses_period numeric(14,2) := 0;
  v_total_debt numeric(14,2) := 0;
  v_debt_over_30 numeric(14,2) := 0;
  v_debtors bigint := 0;
  v_active_players bigint := 0;
  v_disabled_players bigint := 0;
  v_expected_monthly numeric(14,2) := 0;
  v_pending_review bigint := 0;
  v_up_to_date bigint := 0;
  v_monthly jsonb := '[]'::jsonb;
  v_categories jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_administrativo() then
    raise exception 'not_authorized';
  end if;

  v_period_start := (date_trunc('month',current_date) - ((v_months-1)::text || ' months')::interval)::date;

  select count(*) filter (where s.is_enabled and not coalesce(s.is_injured,false)),
         count(*) filter (where not s.is_enabled)
  into v_active_players,v_disabled_players
  from public.students s;

  select coalesce(sum(
    round(a.amount * (1-(coalesce(d.percentage,0)/100.0)),2)
  ),0)
  into v_expected_monthly
  from public.student_billing_profiles sbp
  join public.students s on s.id=sbp.student_id and s.is_enabled
  join public.billing_activities a on a.id=sbp.activity_id and a.is_active
  left join public.billing_discounts d on d.id=sbp.discount_id and d.is_active;

  with paid as (
    select p.charge_id,sum(p.amount)::numeric(14,2) paid_amount
    from public.finance_payments p
    group by p.charge_id
  ), debt as (
    select c.student_id,c.due_date,
      greatest(c.amount-coalesce(p.paid_amount,0),0)::numeric(14,2) balance
    from public.finance_charges c
    left join paid p on p.charge_id=c.id
    where not c.is_void and c.due_date<=current_date
  )
  select coalesce(sum(balance),0),
         coalesce(sum(balance) filter(where due_date<current_date-30),0),
         count(distinct student_id) filter(where balance>0.009)
  into v_total_debt,v_debt_over_30,v_debtors
  from debt;

  select count(*)
  into v_up_to_date
  from public.student_billing_profiles sbp
  join public.students s on s.id=sbp.student_id and s.is_enabled
  where not exists (
    select 1
    from public.finance_charges c
    left join lateral (
      select coalesce(sum(p.amount),0) paid_amount
      from public.finance_payments p where p.charge_id=c.id
    ) p on true
    where c.student_id=sbp.student_id
      and not c.is_void
      and c.due_date<=current_date
      and c.amount-coalesce(p.paid_amount,0)>0.009
  );

  select coalesce(sum(p.amount),0)
  into v_income_month
  from public.finance_payments p
  where p.paid_at>=v_current_month and p.paid_at<v_next_month;

  select coalesce(sum(e.amount),0)
  into v_expenses_month
  from public.club_expenses e
  where not e.is_void and e.expense_date>=v_current_month and e.expense_date<v_next_month;

  select coalesce(sum(p.amount),0)
  into v_income_period
  from public.finance_payments p
  where p.paid_at>=v_period_start and p.paid_at<v_period_end;

  select coalesce(sum(e.amount),0)
  into v_expenses_period
  from public.club_expenses e
  where not e.is_void and e.expense_date>=v_period_start and e.expense_date<v_period_end;

  -- Compatible con el módulo de pagos familiares si ya fue instalado.
  if to_regclass('public.finance_payment_batches') is not null then
    execute 'select count(*) from public.finance_payment_batches where status=''pending'''
    into v_pending_review;
  end if;

  if to_regclass('public.finance_payment_submissions') is not null then
    v_pending_review := v_pending_review + (
      select count(*) from public.finance_payment_submissions where status='pending'
    );
  end if;

  with months as (
    select gs::date month_start
    from generate_series(
      v_period_start::timestamp,
      v_current_month::timestamp,
      interval '1 month'
    ) gs
  ), incomes as (
    select date_trunc('month',p.paid_at)::date month_start,sum(p.amount)::numeric(14,2) amount
    from public.finance_payments p
    where p.paid_at>=v_period_start and p.paid_at<v_period_end
    group by 1
  ), expenses as (
    select date_trunc('month',e.expense_date)::date month_start,sum(e.amount)::numeric(14,2) amount
    from public.club_expenses e
    where not e.is_void and e.expense_date>=v_period_start and e.expense_date<v_period_end
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month',m.month_start,
    'label',to_char(m.month_start,'Mon YY'),
    'income',coalesce(i.amount,0),
    'expenses',coalesce(e.amount,0),
    'net',coalesce(i.amount,0)-coalesce(e.amount,0)
  ) order by m.month_start),'[]'::jsonb)
  into v_monthly
  from months m
  left join incomes i using(month_start)
  left join expenses e using(month_start);

  select coalesce(jsonb_agg(jsonb_build_object(
    'category',x.category,
    'amount',x.amount
  ) order by x.amount desc),'[]'::jsonb)
  into v_categories
  from (
    select e.category,sum(e.amount)::numeric(14,2) amount
    from public.club_expenses e
    where not e.is_void and e.expense_date>=v_period_start and e.expense_date<v_period_end
    group by e.category
  ) x;

  return jsonb_build_object(
    'kpis',jsonb_build_object(
      'income_month',v_income_month,
      'expenses_month',v_expenses_month,
      'net_month',v_income_month-v_expenses_month,
      'income_period',v_income_period,
      'expenses_period',v_expenses_period,
      'net_period',v_income_period-v_expenses_period,
      'avg_income_month',round(v_income_period/v_months,2),
      'avg_expenses_month',round(v_expenses_period/v_months,2),
      'margin_pct',case when v_income_period>0 then round(((v_income_period-v_expenses_period)/v_income_period)*100,1) else 0 end,
      'total_debt',v_total_debt,
      'debt_over_30_days',v_debt_over_30,
      'debtors',v_debtors,
      'up_to_date',v_up_to_date,
      'active_players',v_active_players,
      'disabled_players',v_disabled_players,
      'expected_monthly',v_expected_monthly,
      'pending_review',v_pending_review
    ),
    'monthly',v_monthly,
    'expense_categories',v_categories,
    'period',jsonb_build_object('from',v_period_start,'to',current_date,'months',v_months)
  );
end;
$$;

revoke all on function public.admin_expenses_list(integer,integer,date,date,text) from public,anon;
revoke all on function public.admin_expense_save(uuid,date,text,text,numeric,text,text,text) from public,anon;
revoke all on function public.admin_expense_delete(uuid) from public,anon;
revoke all on function public.admin_web_financial_dashboard(integer) from public,anon;

grant execute on function public.admin_expenses_list(integer,integer,date,date,text) to authenticated,service_role;
grant execute on function public.admin_expense_save(uuid,date,text,text,numeric,text,text,text) to authenticated,service_role;
grant execute on function public.admin_expense_delete(uuid) to authenticated,service_role;
grant execute on function public.admin_web_financial_dashboard(integer) to authenticated,service_role;

commit;
