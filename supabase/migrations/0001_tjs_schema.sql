-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 Meenakshi Ramesh
--
-- TJS hosted backend (Supabase, Mumbai region): schema, row-level security, append-only consent ledger and audit log,
-- erasure with crypto-shredding and deletion receipts, retention, and access alerts.
--
-- Design rules (see docs/BACKEND-PLAN.md):
-- * Only non-identifying fields are stored in the clear (ids, case codes, dates, statuses, roles). Names, contact
--   details, clinical notes and reports are stored as ciphertext (*_enc), encrypted with the patient's own data key.
-- * Patient data keys live in the private `keys` schema, wrapped by a KMS master key; never exposed through the API.
-- * Every policy requires a signed-in staff member of the same clinic who passed MFA (aal2).
-- * The consent ledger and the audit log are append-only: the database refuses updates and deletes.

create extension if not exists pgcrypto;

create schema if not exists app;      -- helper functions used by policies
create schema if not exists keys;     -- wrapped per-patient keys: service role only
revoke all on schema keys from public;

-- ---------------------------------------------------------------- tenants and staff

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  retention_years int not null default 8 check (retention_years between 0 and 50),
  idle_minutes int not null default 10 check (idle_minutes between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.staff (
  user_id uuid primary key,                       -- auth.users.id
  clinic_id uuid not null references public.clinics(id),
  name text not null,
  email text not null,
  role text not null check (role in ('supervisor', 'therapist', 'student', 'diagnostician')),
  year text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.staff (clinic_id);

-- ---------------------------------------------------------------- helpers for policies

create or replace function app.uid() returns uuid language sql stable as $$ select auth.uid() $$;

create or replace function app.me() returns public.staff language sql stable security definer set search_path = public as $$
  select s.* from public.staff s where s.user_id = auth.uid() and s.active
$$;

-- Staff must have passed multi-factor authentication for any patient data.
create or replace function app.mfa_ok() returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function app.my_clinic() returns uuid language sql stable security definer set search_path = public as $$
  select clinic_id from public.staff where user_id = auth.uid() and active
$$;

create or replace function app.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.staff where user_id = auth.uid() and active
$$;

-- ---------------------------------------------------------------- patients and clinical records

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  case_code text not null,
  status text not null check (status in ('waiting', 'referred', 'active', 'discharged')),
  age_group text not null default 'Child' check (age_group in ('Child', 'Adult')),
  assigned_to uuid references public.staff(user_id),
  supervisor_id uuid references public.staff(user_id),
  assessed_by uuid references public.staff(user_id),
  sessions_allotted int not null default 0,
  registered_at timestamptz not null default now(),
  discharged_at date,
  legal_hold boolean not null default false,
  consent_flags jsonb not null default '{}',      -- derived from the ledger: { therapy, records, students, ... }
  details_enc bytea,                              -- name, dob, guardian, contact, case type, diagnosis, notes
  unique (clinic_id, case_code)
);
create index on public.patients (clinic_id, status);
create index on public.patients (assigned_to);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  date date not null,
  start_time time not null,
  duration_min int not null default 30 check (duration_min between 5 and 480),
  room text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'attended', 'missed', 'cancelled')),
  cover_by uuid references public.staff(user_id),
  cover_needed boolean not null default false,
  details_enc bytea                               -- goals, materials, reschedule reasons
);
create index on public.appointments (clinic_id, date);
create index on public.appointments (patient_id);

create table public.appointment_observers (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  user_id uuid not null references public.staff(user_id),
  role text not null default 'Observe',
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  invited_by uuid references public.staff(user_id),
  primary key (appointment_id, user_id)
);

-- Need-to-know, the same rule as the app (js/logic.js canSeePatient + js/sync.js grants).
create or replace function app.can_see_patient(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.patients p join public.staff s on s.user_id = auth.uid() and s.active and s.clinic_id = p.clinic_id
    where p.id = pid and app.mfa_ok() and (
      s.role = 'supervisor'
      or (s.role = 'diagnostician' and (p.status = 'waiting' or p.assessed_by = s.user_id))
      or (s.role in ('therapist', 'student') and p.assigned_to = s.user_id)
      or exists (select 1 from public.appointments a where a.patient_id = p.id and a.cover_by = s.user_id)
      or exists (select 1 from public.appointments a join public.appointment_observers o on o.appointment_id = a.id
                 where a.patient_id = p.id and o.user_id = s.user_id and o.status <> 'declined')
    )
  )
$$;

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  assessor_id uuid references public.staff(user_id),
  date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  content_enc bytea
);
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  from_id uuid references public.staff(user_id),
  at date not null default current_date,
  priority text not null default 'Routine' check (priority in ('Routine', 'Soon', 'Urgent')),
  status text not null default 'pending' check (status in ('pending', 'allotted')),
  allotted_to uuid references public.staff(user_id),
  notes_enc bytea
);
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  status text not null default 'active',
  content_enc bytea
);
create table public.session_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  date date not null,
  report_sent boolean not null default false,
  content_enc bytea
);
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  type text not null check (type in ('pre-assessment', 'lesson-plan', 'session-report', 'conclusion')),
  author_id uuid references public.staff(user_id),
  reviewer_id uuid references public.staff(user_id),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'approved')),
  submitted_at timestamptz,
  content_enc bytea
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  to_id uuid not null references public.staff(user_id),
  from_id uuid references public.staff(user_id),
  patient_id uuid references public.patients(id) on delete cascade,
  kind text not null default 'note',
  at timestamptz not null default now(),
  read boolean not null default false,
  content_enc bytea                               -- subject and body: case codes and initials only
);

-- ---------------------------------------------------------------- consent: notices and the append-only ledger

create table public.notices (
  version text not null,
  language text not null check (language in ('en', 'ta', 'hi', 'ml', 'kn')),
  status text not null check (status in ('draft', 'draft-translation', 'approved', 'retired')),
  effective_from date,
  body jsonb not null,                            -- title, intro, purposes {id: {label, text, simple}}, rights
  approved_by text,
  primary key (version, language)
);

create table public.consent_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id),
  seq int not null,
  at timestamptz not null default now(),
  decisions jsonb not null,                       -- [{purpose, action: grant|refuse|withdraw}]
  relationship text not null check (relationship in ('self', 'parent', 'guardian', 'legal-guardian', 'nominated-rep')),
  giver_enc bytea,                                -- name of the person giving consent
  basis text not null default '',                 -- legal basis for an adult's guardian
  basis_ref_enc bytea,
  recorded_by uuid not null references public.staff(user_id),
  notice_version text not null,
  language text not null,
  method text not null check (method in ('signature', 'otp', 'paper', 'thumbprint', 'witness', 'in-person', 'phone', 'written', 'remote-link', 'legacy')),
  accessible boolean not null default false,
  evidence_digest jsonb not null default '{}',    -- sha256 of signature/scan files kept in Storage
  evidence_path text,                             -- Storage object (bucket consent-evidence), encrypted
  receipt_id text not null,
  prev_hash text not null default '',
  hash text not null,
  unique (patient_id, seq)
);

-- Nobody edits the ledger, not even a supervisor. Only erase_patient() removes a patient's entries.
create or replace function app.append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('tjs.erasing', true) = 'on' then return old; end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;
create trigger consent_entries_append_only before update or delete on public.consent_entries
  for each row execute function app.append_only();

-- ---------------------------------------------------------------- team calendar, leave

create table public.leave (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  user_id uuid not null references public.staff(user_id),
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  reason text not null default '',               -- may be health data (sick leave): only the person and supervisors see it
  status text not null default 'requested'
);
create table public.events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  title text not null,
  date date not null,
  start_time time not null,
  duration_min int not null default 30,
  attendees uuid[] not null default '{}',
  created_by uuid not null references public.staff(user_id),
  note text not null default ''
);

-- What colleagues may see of each other's day: busy times, no patients, no reasons.
create or replace function public.team_busy(day_from date, day_to date)
returns table (user_id uuid, date date, start_time time, duration_min int, kind text, room text)
language sql stable security definer set search_path = public as $$
  select coalesce(a.cover_by, p.assigned_to), a.date, a.start_time, a.duration_min, 'session', a.room
    from public.appointments a join public.patients p on p.id = a.patient_id
   where a.clinic_id = app.my_clinic() and app.mfa_ok() and a.status <> 'cancelled' and a.date between day_from and day_to
  union all
  select e_att, e.date, e.start_time, e.duration_min, 'busy', ''
    from public.events e, unnest(e.attendees) e_att
   where e.clinic_id = app.my_clinic() and app.mfa_ok() and e.date between day_from and day_to
  union all
  select l.user_id, d::date, null, null, 'away', ''
    from public.leave l, generate_series(greatest(l.from_date, day_from), least(l.to_date, day_to), interval '1 day') d
   where l.clinic_id = app.my_clinic() and app.mfa_ok() and l.status not in ('declined', 'cancelled')
$$;

-- ---------------------------------------------------------------- family portal links, reminders

create table public.report_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  log_id uuid references public.session_logs(id) on delete cascade,
  token_hash text not null unique,               -- sha256 of a long random token; the token itself is never stored
  otp_hash text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references public.staff(user_id),
  created_at timestamptz not null default now()
);
create table public.reminders_sent (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp')),
  provider_ref text,
  sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- keys (crypto-shredding)

create table keys.patient_keys (
  patient_id uuid primary key,
  clinic_id uuid not null,
  wrapped_key bytea not null,                    -- the patient's AES-256 data key, encrypted by the KMS master key
  kms_key_id text not null,
  created_at timestamptz not null default now()
);
revoke all on keys.patient_keys from public;

-- ---------------------------------------------------------------- audit log (append-only, no patient content)

create table public.audit_log (
  id bigserial primary key,
  clinic_id uuid,
  at timestamptz not null default now(),
  actor uuid,
  actor_role text,
  action text not null,
  case_code text,                                -- pseudonym only, kept after erasure
  target_table text,
  target_id uuid,
  detail text not null default ''                -- never names, notes or report text
);
create index on public.audit_log (clinic_id, at);
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.append_only();

create or replace function app.log(action text, clinic uuid, case_code text, target_table text, target_id uuid, detail text default '')
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (clinic_id, actor, actor_role, action, case_code, target_table, target_id, detail)
  values (clinic, auth.uid(), app.my_role(), action, case_code, target_table, target_id, coalesce(detail, ''))
$$;

-- Every change to clinical tables is logged automatically: which table, which record, which case. Never the content.
create or replace function app.audit_change() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; code text;
begin
  r := coalesce(new, old);
  if tg_table_name = 'patients' then code := r.case_code;
  else select case_code into code from public.patients where id = r.patient_id; end if;
  perform app.log(lower(tg_op), r.clinic_id, code, tg_table_name, r.id);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['patients', 'appointments', 'assessments', 'referrals', 'goals', 'session_logs', 'documents', 'consent_entries', 'report_links'] loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.audit_change()', t, t);
  end loop;
end $$;

-- Opening a record can't fire a trigger, so the app logs it. The actor is always the signed-in user.
create or replace function public.log_open(pid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.can_see_patient(pid) then raise exception 'No access' using errcode = 'insufficient_privilege'; end if;
  perform app.log('open', p.clinic_id, p.case_code, 'patients', pid) from public.patients p where p.id = pid;
end $$;

-- ---------------------------------------------------------------- erasure, receipts, retention

create table public.deletion_receipts (
  id text primary key,
  clinic_id uuid not null references public.clinics(id),
  record_id uuid not null,
  case_code text not null,
  erased_at timestamptz not null default now(),
  erased_by text not null,
  reason text not null,
  destroyed jsonb not null,
  key_destroyed text not null,
  is_test boolean not null default false
);

-- Erase a patient everywhere in the live database, destroy their key, and issue a receipt.
-- Backups keep only ciphertext; once the key table backups that held this key have aged out, the patient is unreadable everywhere.
create or replace function public.erase_patient(pid uuid, why text, is_test boolean default false)
returns public.deletion_receipts language plpgsql security definer set search_path = public as $$
declare p public.patients; counts jsonb; rid text; rec public.deletion_receipts; had_key boolean; caller text;
begin
  select * into p from public.patients where id = pid;
  if p.id is null then raise exception 'No such patient'; end if;
  caller := coalesce((select name from public.staff where user_id = auth.uid()), 'Automatic retention rule');
  if auth.uid() is not null and not (app.my_role() = 'supervisor' and app.my_clinic() = p.clinic_id and app.mfa_ok()) then
    raise exception 'Only a supervisor of this clinic can erase records' using errcode = 'insufficient_privilege';
  end if;
  counts := jsonb_build_object(
    'appointments', (select count(*) from public.appointments where patient_id = pid),
    'session_logs', (select count(*) from public.session_logs where patient_id = pid),
    'documents', (select count(*) from public.documents where patient_id = pid),
    'consent_entries', (select count(*) from public.consent_entries where patient_id = pid));
  perform set_config('tjs.erasing', 'on', true);
  delete from public.consent_entries where patient_id = pid;
  delete from public.patients where id = pid;                       -- cascades to linked records
  perform set_config('tjs.erasing', 'off', true);
  delete from keys.patient_keys where patient_id = pid returning true into had_key;
  rid := 'DR-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  insert into public.deletion_receipts (id, clinic_id, record_id, case_code, erased_by, reason, destroyed, key_destroyed, is_test)
  values (rid, p.clinic_id, pid, p.case_code, caller, why, counts,
          case when had_key then 'Key destroyed. Backups hold only ciphertext; key-table backups that held this key age out by the documented date'
               else 'No key existed' end, is_test)
  returning * into rec;
  perform app.log('erase', p.clinic_id, p.case_code, 'patients', pid, 'receipt ' || rid);
  return rec;
end $$;

-- Daily job (pg_cron on Supabase): erase discharged records once the clinic's retention period has passed.
create or replace function public.run_retention() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select p.id, c.retention_years from public.patients p join public.clinics c on c.id = p.clinic_id
            where p.status = 'discharged' and not p.legal_hold and p.discharged_at is not null
              and p.discharged_at + make_interval(years => c.retention_years) < current_date loop
    perform public.erase_patient(r.id, 'Retention period ended (' || r.retention_years || ' years after discharge)');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.run_retention() from public;
-- select cron.schedule('tjs-retention', '15 2 * * *', 'select public.run_retention()');

-- ---------------------------------------------------------------- breach alerting

-- Unusual access: someone opening many different patients in an hour, or exporting. An Edge Function polls this and alerts supervisors.
create or replace view public.access_alerts with (security_invoker = true) as
  select clinic_id, actor, actor_role, date_trunc('hour', at) as hour, count(distinct case_code) as patients, 'many patients in one hour' as why
    from public.audit_log where action in ('select', 'open') and at > now() - interval '7 days'
   group by 1, 2, 3, 4 having count(distinct case_code) > 25
  union all
  select clinic_id, actor, actor_role, date_trunc('hour', at), count(*), 'export'
    from public.audit_log where action in ('export', 'export_all', 'copy_record') and at > now() - interval '7 days'
   group by 1, 2, 3, 4;

-- ---------------------------------------------------------------- row-level security

alter table public.clinics enable row level security;
alter table public.staff enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_observers enable row level security;
alter table public.assessments enable row level security;
alter table public.referrals enable row level security;
alter table public.goals enable row level security;
alter table public.session_logs enable row level security;
alter table public.documents enable row level security;
alter table public.messages enable row level security;
alter table public.notices enable row level security;
alter table public.consent_entries enable row level security;
alter table public.leave enable row level security;
alter table public.events enable row level security;
alter table public.report_links enable row level security;
alter table public.reminders_sent enable row level security;
alter table public.audit_log enable row level security;
alter table public.deletion_receipts enable row level security;

create policy clinic_read on public.clinics for select to authenticated using (id = app.my_clinic());
create policy clinic_lead on public.clinics for update to authenticated using (id = app.my_clinic() and app.my_role() = 'supervisor' and app.mfa_ok());

create policy staff_read on public.staff for select to authenticated using (clinic_id = app.my_clinic());
create policy staff_lead_ins on public.staff for insert to authenticated with check (clinic_id = app.my_clinic() and app.my_role() = 'supervisor' and app.mfa_ok());
create policy staff_lead_upd on public.staff for update to authenticated using (clinic_id = app.my_clinic() and app.my_role() = 'supervisor' and app.mfa_ok());

create policy patients_read on public.patients for select to authenticated using (app.can_see_patient(id));
create policy patients_add on public.patients for insert to authenticated with check (
  clinic_id = app.my_clinic() and app.mfa_ok() and (
    app.my_role() in ('supervisor', 'diagnostician') or (app.my_role() = 'therapist' and assigned_to = auth.uid())));
create policy patients_edit on public.patients for update to authenticated using (app.can_see_patient(id)) with check (clinic_id = app.my_clinic());
-- No delete policy: erasure goes through erase_patient().

do $$ declare t text; begin
  foreach t in array array['assessments', 'referrals', 'goals', 'session_logs', 'documents', 'report_links', 'reminders_sent'] loop
    execute format('create policy %I_read on public.%I for select to authenticated using (app.can_see_patient(patient_id))', t, t);
    execute format('create policy %I_add on public.%I for insert to authenticated with check (clinic_id = app.my_clinic() and app.can_see_patient(patient_id))', t, t);
    execute format('create policy %I_edit on public.%I for update to authenticated using (app.can_see_patient(patient_id)) with check (clinic_id = app.my_clinic())', t, t);
  end loop;
end $$;

create policy appts_read on public.appointments for select to authenticated using (
  app.can_see_patient(patient_id) or (cover_by = auth.uid() and app.mfa_ok()));
create policy appts_add on public.appointments for insert to authenticated with check (clinic_id = app.my_clinic() and app.can_see_patient(patient_id));
create policy appts_edit on public.appointments for update to authenticated using (app.can_see_patient(patient_id)) with check (clinic_id = app.my_clinic());

create policy obs_read on public.appointment_observers for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.appointments a where a.id = appointment_id and app.can_see_patient(a.patient_id)));
create policy obs_invite on public.appointment_observers for insert to authenticated with check (
  exists (select 1 from public.appointments a where a.id = appointment_id and app.can_see_patient(a.patient_id)));
create policy obs_answer on public.appointment_observers for update to authenticated using (user_id = auth.uid());

create policy msg_read on public.messages for select to authenticated using (clinic_id = app.my_clinic() and (to_id = auth.uid() or from_id = auth.uid()));
create policy msg_send on public.messages for insert to authenticated with check (clinic_id = app.my_clinic() and from_id = auth.uid());
create policy msg_mark on public.messages for update to authenticated using (to_id = auth.uid());

create policy notices_read on public.notices for select to authenticated using (true);

create policy consent_read on public.consent_entries for select to authenticated using (app.can_see_patient(patient_id));
-- Students take part in care but don't take consent.
create policy consent_add on public.consent_entries for insert to authenticated with check (
  clinic_id = app.my_clinic() and app.can_see_patient(patient_id) and recorded_by = auth.uid() and app.my_role() <> 'student');

create policy leave_read on public.leave for select to authenticated using (clinic_id = app.my_clinic() and (user_id = auth.uid() or app.my_role() = 'supervisor'));
create policy leave_add on public.leave for insert to authenticated with check (clinic_id = app.my_clinic() and user_id = auth.uid());
create policy leave_lead on public.leave for update to authenticated using (clinic_id = app.my_clinic() and (user_id = auth.uid() or app.my_role() = 'supervisor'));

create policy events_read on public.events for select to authenticated using (clinic_id = app.my_clinic() and (created_by = auth.uid() or auth.uid() = any (attendees) or app.my_role() = 'supervisor'));
create policy events_add on public.events for insert to authenticated with check (clinic_id = app.my_clinic() and created_by = auth.uid());
create policy events_own on public.events for update to authenticated using (created_by = auth.uid());
create policy events_del on public.events for delete to authenticated using (created_by = auth.uid());

create policy audit_lead on public.audit_log for select to authenticated using (clinic_id = app.my_clinic() and app.my_role() = 'supervisor' and app.mfa_ok());
create policy receipts_lead on public.deletion_receipts for select to authenticated using (clinic_id = app.my_clinic() and app.my_role() = 'supervisor' and app.mfa_ok());

grant usage on schema app to authenticated;
grant execute on function app.can_see_patient(uuid), app.my_clinic(), app.my_role(), app.mfa_ok(), app.me(), app.uid() to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant delete on public.events to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.erase_patient(uuid, text, boolean), public.team_busy(date, date), public.log_open(uuid) to authenticated;
revoke update, delete on public.audit_log, public.consent_entries from authenticated;
