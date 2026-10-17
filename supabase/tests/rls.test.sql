-- Row-level security tests. Run with supabase/tests/run-local.sh (plain PostgreSQL, uses local-stubs.sql).
-- Everything happens in one transaction that is rolled back at the end.
\set ON_ERROR_STOP on
begin;

create function public.tjs_assert(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok - %', what;
end $$;
grant execute on function public.tjs_assert(boolean, text) to authenticated;

-- Sign in as someone (sub = user id; aal2 = passed MFA).
create function public.tjs_as(uid text, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', aal)::text, true)
$$;
grant execute on function public.tjs_as(text, text) to authenticated;

insert into public.clinics (id, name) values ('c1000000-0000-0000-0000-000000000001', 'Bright Steps'), ('c2000000-0000-0000-0000-000000000002', 'Other Clinic');
insert into public.staff (user_id, clinic_id, name, email, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'Priya', 'p@x', 'supervisor'),
  ('b0000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000001', 'Sam', 's@x', 'therapist'),
  ('c0000000-0000-0000-0000-00000000000c', 'c1000000-0000-0000-0000-000000000001', 'Asha', 'a@x', 'student'),
  ('d0000000-0000-0000-0000-00000000000d', 'c2000000-0000-0000-0000-000000000002', 'Outsider', 'o@x', 'supervisor');
insert into public.patients (id, clinic_id, case_code, status, assigned_to, discharged_at) values
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'SLT-26-001', 'active', 'b0000000-0000-0000-0000-00000000000b', null),
  ('e2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'SLT-26-002', 'active', 'c0000000-0000-0000-0000-00000000000c', null),
  ('e3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'SLT-26-003', 'discharged', 'b0000000-0000-0000-0000-00000000000b', '2010-01-01');
insert into public.appointments (id, clinic_id, patient_id, date, start_time) values
  ('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', current_date, '09:00'),
  ('f2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002', current_date, '10:00');
insert into keys.patient_keys values ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '\x00', 'kms-test');
insert into public.leave (clinic_id, user_id, from_date, to_date, reason) values ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', current_date, current_date, 'Sick leave');

set local role authenticated;

-- Therapist: own patients only
select public.tjs_as('b0000000-0000-0000-0000-00000000000b');
select public.tjs_assert((select count(*) from public.patients) = 2, 'therapist sees only own patients (2 of 3)');
select public.tjs_assert((select count(*) from public.appointments) = 1, 'therapist sees only own sessions');
select public.tjs_assert((select count(*) from public.team_busy(current_date, current_date) where kind = 'session') = 2, 'team calendar shows all busy times');
select public.tjs_assert((select count(*) from public.team_busy(current_date, current_date) where kind = 'away') = 1, 'team calendar shows leave as away, without a reason');
select public.tjs_assert((select count(*) from public.audit_log) = 0, 'therapist cannot read the audit log');

-- Without MFA: nothing
select public.tjs_as('b0000000-0000-0000-0000-00000000000b', 'aal1');
select public.tjs_assert((select count(*) from public.patients) = 0, 'no patient data without MFA (aal1)');

-- Student: only the allotted case, can't take consent
select public.tjs_as('c0000000-0000-0000-0000-00000000000c');
select public.tjs_assert((select count(*) from public.patients) = 1, 'student sees only the allotted case');
select public.tjs_assert((select count(*) from public.leave) = 0, 'student cannot read a colleague''s leave reason');
do $$ begin
  insert into public.consent_entries (clinic_id, patient_id, seq, decisions, relationship, recorded_by, notice_version, language, method, receipt_id, hash)
  values ('c1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002', 1, '[]', 'parent', 'c0000000-0000-0000-0000-00000000000c', '1.0', 'en', 'signature', 'CR-1', 'h');
  raise exception 'FAILED: student recorded consent';
exception when insufficient_privilege then raise notice 'ok - student cannot record consent';
end $$;
do $$ begin
  update public.patients set status = 'discharged' where id = 'e1000000-0000-0000-0000-000000000001';
  if found then raise exception 'FAILED: student changed another clinician''s patient'; end if;
  raise notice 'ok - student cannot change another clinician''s patient';
end $$;

-- Other clinic's supervisor: nothing from this clinic
select public.tjs_as('d0000000-0000-0000-0000-00000000000d');
select public.tjs_assert((select count(*) from public.patients) = 0, 'another clinic sees nothing');
select public.tjs_assert((select count(*) from public.team_busy(current_date, current_date)) = 0, 'another clinic sees no busy times');

-- Therapist records consent; nobody can change it
select public.tjs_as('b0000000-0000-0000-0000-00000000000b');
insert into public.consent_entries (clinic_id, patient_id, seq, decisions, relationship, recorded_by, notice_version, language, method, receipt_id, hash)
values ('c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 1, '[{"purpose":"treatment","action":"grant"}]', 'parent', 'b0000000-0000-0000-0000-00000000000b', '1.0', 'ta', 'signature', 'CR-2', 'h1');
select public.tjs_assert((select count(*) from public.consent_entries) = 1, 'therapist records consent for own patient');
do $$ begin
  update public.consent_entries set decisions = '[]';
  raise exception 'FAILED: consent entry changed';
exception when insufficient_privilege then raise notice 'ok - consent ledger cannot be changed';
end $$;
do $$ begin
  insert into public.patients (clinic_id, case_code, status, assigned_to) values ('c1000000-0000-0000-0000-000000000001', 'SLT-26-099', 'active', 'c0000000-0000-0000-0000-00000000000c');
  raise exception 'FAILED: therapist created a patient for someone else';
exception when insufficient_privilege then raise notice 'ok - therapist cannot register a patient assigned to someone else';
end $$;
do $$ begin
  perform public.erase_patient('e1000000-0000-0000-0000-000000000001', 'test');
  raise exception 'FAILED: therapist erased a patient';
exception when insufficient_privilege then raise notice 'ok - only a supervisor can erase';
end $$;

-- Supervisor erases: records, consent and key gone; receipt issued; audit keeps the case code only
select public.tjs_as('a0000000-0000-0000-0000-00000000000a');
select public.tjs_assert((select count(*) from public.patients) = 3, 'supervisor sees every patient in the clinic');
select public.tjs_assert((select count(*) from public.leave) = 1, 'supervisor sees leave reasons');
select public.tjs_assert((public.erase_patient('e1000000-0000-0000-0000-000000000001', 'Erasure request')).case_code = 'SLT-26-001', 'supervisor erases a patient');
select public.tjs_assert(not exists (select 1 from public.patients where id = 'e1000000-0000-0000-0000-000000000001'), 'patient gone');
select public.tjs_assert(not exists (select 1 from public.appointments where patient_id = 'e1000000-0000-0000-0000-000000000001'), 'linked sessions gone');
select public.tjs_assert((select count(*) from public.consent_entries) = 0, 'consent entries gone with the patient');
select public.tjs_assert((select count(*) from public.deletion_receipts where case_code = 'SLT-26-001') = 1, 'deletion receipt issued');
select public.tjs_assert(exists (select 1 from public.audit_log where case_code = 'SLT-26-001' and action = 'erase'), 'audit trail keeps the case code after erasure');
do $$ begin
  delete from public.audit_log;
  if found then raise exception 'FAILED: audit log deleted'; end if;
  raise notice 'ok - audit log cannot be deleted';
exception when insufficient_privilege then raise notice 'ok - audit log cannot be deleted';
end $$;

reset role;
select public.tjs_assert(not exists (select 1 from keys.patient_keys where patient_id = 'e1000000-0000-0000-0000-000000000001'), 'patient key destroyed (crypto-shredding)');
select public.tjs_assert(public.run_retention() = 1, 'retention job erases the record discharged in 2010');

rollback;
\echo ALL RLS TESTS PASSED
