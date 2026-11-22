-- ============================================================================
-- Dhawi Uwaid — Admin roles, request review workflow, audit log, throttle
-- Project: nmsmbcfnlqvnzfprexbh
--
-- Access model:
--   * anon / any visitor : read tree, submit a pending update request.
--   * admins (moderator) : signed in WITH MFA (aal2); review requests, edit tree.
--   * owner              : everything a moderator can + manage the admins list.
--
-- Run order (Dashboard):
--   1. Authentication > Sign In / Providers: turn OFF "Allow new users to sign up".
--   2. Authentication > Multi-Factor: enable TOTP.
--   3. Authentication > Users: "Add user" (or invite) for yourself.
--   4. SQL Editor: run this file, then the BOOTSTRAP block at the bottom.
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- 0. Private schema for helpers (NOT exposed through the Data API) -----------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- 1. Admins ------------------------------------------------------------------
create table if not exists public.admins (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  role                text not null check (role in ('owner', 'moderator')),
  display_name        text not null default '' check (char_length(display_name) <= 80),
  can_review_requests boolean not null default false,
  can_edit_tree       boolean not null default false,
  can_access_brand    boolean not null default false,
  created_at          timestamptz not null default now()
);
alter table public.admins
  add column if not exists can_review_requests boolean not null default false,
  add column if not exists can_edit_tree       boolean not null default false,
  add column if not exists can_access_brand    boolean not null default false;
alter table public.admins
  alter column can_review_requests set default false,
  alter column can_edit_tree set default false,
  alter column can_access_brand set default false;
alter table public.admins enable row level security;

-- Listed admin AND the current session passed MFA (aal2).
create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function private.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admins a
                 where a.user_id = (select auth.uid()) and a.role = 'owner');
$$;

create or replace function private.can_review_requests()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admins a
                 where a.user_id = (select auth.uid())
                   and (a.role = 'owner' or a.can_review_requests = true));
$$;

create or replace function private.can_edit_tree()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admins a
                 where a.user_id = (select auth.uid())
                   and (a.role = 'owner' or a.can_edit_tree = true));
$$;

create or replace function private.can_access_brand()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admins a
                 where a.user_id = (select auth.uid())
                   and (a.role = 'owner' or a.can_access_brand = true));
$$;

revoke all on function
  private.is_admin(),
  private.is_owner(),
  private.can_review_requests(),
  private.can_edit_tree(),
  private.can_access_brand()
from public, anon;
grant execute on function
  private.is_admin(),
  private.is_owner(),
  private.can_review_requests(),
  private.can_edit_tree(),
  private.can_access_brand()
to authenticated;

-- A signed-in user (even before MFA) may read ONLY their own row, so the admin
-- page can tell them whether to set up / verify MFA.
drop policy if exists admins_read_self on public.admins;
create policy admins_read_self on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins
  for select to authenticated using ((select private.is_admin()));

drop policy if exists admins_owner_write on public.admins;
create policy admins_owner_write on public.admins
  for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));

-- 2. Feature toggles, optional bio columns, verified member profiles & requests
alter table public.tree_meta
  add column if not exists feature_bios_enabled        boolean not null default false,
  add column if not exists feature_require_member_auth boolean not null default true,
  add column if not exists feature_require_member_mfa  boolean not null default true;

alter table public.family_members
  add column if not exists kunyah      text not null default '',
  add column if not exists is_deceased boolean not null default false,
  add column if not exists birth_year  text not null default '',
  add column if not exists death_year  text not null default '';

create table if not exists public.member_profiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  member_id           text not null references public.family_members(id) on delete restrict,
  member_full_lineage text not null default '',
  branch_name         text not null default '',
  email               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.member_profiles enable row level security;

create or replace function private.guard_member_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_mem public.family_members;
begin
  select * into v_mem from public.family_members where id = new.member_id and generation >= 1;
  if not found then
    raise exception 'invalid member identity';
  end if;
  if current_user = 'authenticated' then
    new.user_id := (select auth.uid());
    new.email   := coalesce((select auth.jwt()) ->> 'email', new.email, '');
  end if;
  new.member_full_lineage := v_mem.full_lineage;
  new.branch_name         := v_mem.branch_name;
  new.updated_at          := now();
  return new;
end;
$$;
revoke all on function private.guard_member_profile() from public, anon, authenticated;

drop trigger if exists trg_guard_member_profile on public.member_profiles;
create trigger trg_guard_member_profile
  before insert or update on public.member_profiles
  for each row execute function private.guard_member_profile();

drop policy if exists member_profiles_read_own on public.member_profiles;
create policy member_profiles_read_own on public.member_profiles
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists member_profiles_admin_read on public.member_profiles;
create policy member_profiles_admin_read on public.member_profiles
  for select to authenticated using ((select private.is_admin()));

drop policy if exists member_profiles_insert_own on public.member_profiles;
create policy member_profiles_insert_own on public.member_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists member_profiles_update_own on public.member_profiles;
create policy member_profiles_update_own on public.member_profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.update_requests
  add column if not exists reviewed_by         uuid references auth.users(id) on delete set null,
  add column if not exists review_note         text not null default '',
  add column if not exists submitter_user_id   uuid references auth.users(id) on delete set null,
  add column if not exists submitter_member_id text references public.family_members(id) on delete set null,
  add column if not exists submitter_lineage   text not null default '';

create or replace function private.can_submit_request()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_req_auth boolean := true;
  v_req_mfa  boolean := true;
begin
  select coalesce(feature_require_member_auth, true),
         coalesce(feature_require_member_mfa, true)
    into v_req_auth, v_req_mfa
    from public.tree_meta
   where id = 1;

  if not coalesce(v_req_auth, true) then
    return true;
  end if;

  if (select auth.uid()) is null then
    return false;
  end if;

  if coalesce(v_req_mfa, true) and coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then
    return false;
  end if;

  return exists (
    select 1 from public.member_profiles mp where mp.user_id = (select auth.uid())
  );
end;
$$;
revoke all on function private.can_submit_request() from public;
grant execute on function private.can_submit_request() to anon, authenticated;

-- 3. Least-privilege grants (Supabase grants ALL to anon by default) ---------
revoke all on public.tree_meta, public.family_members, public.update_requests,
              public.admins, public.member_profiles from anon, authenticated;

grant select on public.tree_meta, public.family_members to anon, authenticated;
grant insert (request_type, branch_name, target_person, target_node_id,
              new_name, submitter_name, notes, status)
  on public.update_requests to anon, authenticated;
grant select, insert, update on public.member_profiles to authenticated;

-- Admin abilities (still gated row-by-row by the policies below)
grant insert, update, delete on public.tree_meta, public.family_members to authenticated;
grant select, update on public.update_requests to authenticated;
grant select, insert, update, delete on public.admins to authenticated;

-- 4. Admin write policies (enforced directly on tables as well as in RPCs) ---
drop policy if exists family_members_admin_insert on public.family_members;
create policy family_members_admin_insert on public.family_members
  for insert to authenticated
  with check ((select private.can_edit_tree()) and generation >= 2);

drop policy if exists family_members_admin_update on public.family_members;
create policy family_members_admin_update on public.family_members
  for update to authenticated
  using ((select private.can_edit_tree()) and (generation >= 1 or (select private.is_owner())))
  with check ((select private.can_edit_tree()) and (generation >= 1 or (select private.is_owner())));

drop policy if exists family_members_admin_delete on public.family_members;
create policy family_members_admin_delete on public.family_members
  for delete to authenticated
  using (
    (select private.can_edit_tree())
    and generation >= 2
    and not exists (
      select 1 from public.family_members c where c.parent_id = family_members.id
    )
  );

-- Prevent non-owner moderators from bypassing RPC checks via direct REST calls
create or replace function private.guard_family_members_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.generation < 2 then
      raise exception 'member not found or protected';
    end if;
    if exists (select 1 from public.family_members c where c.parent_id = old.id) then
      raise exception 'member has children; remove them first';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and current_user = 'authenticated' and not (select private.is_owner()) then
    if old.generation <= 0 then
      raise exception 'not allowed';
    end if;
    if new.id is distinct from old.id
       or new.parent_id is distinct from old.parent_id
       or new.branch_id is distinct from old.branch_id
       or new.generation is distinct from old.generation then
      raise exception 'not allowed';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.guard_family_members_write() from public, anon, authenticated;

drop trigger if exists trg_guard_family_members_write on public.family_members;
create trigger trg_guard_family_members_write
  before update or delete on public.family_members
  for each row execute function private.guard_family_members_write();

drop policy if exists tree_meta_admin_update on public.tree_meta;
create policy tree_meta_admin_update on public.tree_meta
  for update to authenticated
  using ((select private.can_edit_tree())) with check ((select private.can_edit_tree()));

drop policy if exists update_requests_public_insert on public.update_requests;
drop policy if exists update_requests_member_insert on public.update_requests;
create policy update_requests_member_insert on public.update_requests
  for insert to anon, authenticated
  with check (
    (select private.can_submit_request())
    and status = 'pending'
    and char_length(trim(request_type)) >= 2
    and char_length(trim(branch_name)) >= 1
    and char_length(trim(target_person)) >= 2
    and char_length(trim(new_name)) >= 1
    and char_length(request_type) <= 80
    and char_length(branch_name) <= 80
    and char_length(target_person) <= 200
    and char_length(new_name) <= 200
    and char_length(submitter_name) <= 150
    and char_length(notes) <= 1000
  );

drop policy if exists update_requests_read_own on public.update_requests;
create policy update_requests_read_own on public.update_requests
  for select to authenticated
  using (submitter_user_id = (select auth.uid()));

drop policy if exists update_requests_admin_read on public.update_requests;
create policy update_requests_admin_read on public.update_requests
  for select to authenticated using ((select private.is_admin()));

drop policy if exists update_requests_admin_review on public.update_requests;
create policy update_requests_admin_review on public.update_requests
  for update to authenticated
  using ((select private.can_review_requests())) with check ((select private.can_review_requests()));

-- 5. Audit log --------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text not null default '',
  action     text not null,
  old_data   jsonb,
  new_data   jsonb,
  actor      uuid,
  at         timestamptz not null default now()
);
create index if not exists idx_audit_log_at on public.audit_log (at desc);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated using ((select private.is_admin()));

create or replace function private.log_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_log (table_name, row_id, action, old_data, new_data, actor)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id::text else new.id::text end,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    (select auth.uid())
  );
  return coalesce(new, old);
end;
$$;
revoke all on function private.log_change() from public, anon, authenticated;

drop trigger if exists trg_audit_family_members on public.family_members;
create trigger trg_audit_family_members
  after insert or update or delete on public.family_members
  for each row execute function private.log_change();

drop trigger if exists trg_audit_update_requests on public.update_requests;
create trigger trg_audit_update_requests
  after update or delete on public.update_requests
  for each row execute function private.log_change();

-- 6. Public submissions: force pending + verified member stamp + throttle -
create or replace function private.guard_new_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_prof public.member_profiles;
begin
  new.status              := 'pending';
  new.reviewed_at         := null;
  new.reviewed_by         := null;
  new.review_note         := '';
  new.created_at          := now();
  new.submitter_user_id   := v_uid;
  new.submitter_member_id := null;
  new.submitter_lineage   := '';

  if v_uid is not null then
    select * into v_prof from public.member_profiles where user_id = v_uid;
    if found then
      new.submitter_member_id := v_prof.member_id;
      new.submitter_lineage   := v_prof.member_full_lineage;
      if btrim(coalesce(new.submitter_name, '')) = '' then
        new.submitter_name := v_prof.member_full_lineage;
      end if;
    end if;
    if (select count(*) from public.update_requests
        where submitter_user_id = v_uid
          and created_at > now() - interval '10 minutes') >= 5 then
      raise exception 'too many requests, please try again later';
    end if;
  end if;

  if (select count(*) from public.update_requests
      where created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'too many requests, please try again later';
  end if;
  if (select count(*) from public.update_requests where status = 'pending') >= 500 then
    raise exception 'review queue is full';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_new_request() from public, anon, authenticated;

drop trigger if exists trg_guard_new_request on public.update_requests;
create trigger trg_guard_new_request
  before insert on public.update_requests
  for each row execute function private.guard_new_request();

-- 7. Admin RPCs (SECURITY INVOKER: RLS above still applies) -----------------

-- Recompute full_lineage ("name بن parent_lineage") for a node and its subtree.
create or replace function private.rebuild_lineage(p_id text)
returns void
language sql security invoker set search_path = ''
as $$
  with recursive sub as (
    select m.id, m.name || coalesce(' بن ' || p.full_lineage, '') as lineage
      from public.family_members m
      left join public.family_members p on p.id = m.parent_id
     where m.id = p_id
    union all
    select c.id, c.name || ' بن ' || s.lineage
      from public.family_members c
      join sub s on c.parent_id = s.id
  )
  update public.family_members f
     set full_lineage = sub.lineage, updated_at = now()
    from sub
   where f.id = sub.id and f.full_lineage is distinct from sub.lineage;
$$;

create or replace function private.refresh_meta_counts()
returns void
language sql security invoker set search_path = ''
as $$
  update public.tree_meta t
     set total_nodes      = (select count(*) from public.family_members),
         descendant_count = (select count(*) from public.family_members where generation >= 1),
         ancestor_count   = (select count(*) from public.family_members where generation < 0),
         updated_at       = now()
   where t.id = 1;
$$;
revoke all on function private.rebuild_lineage(text), private.refresh_meta_counts()
  from public, anon;
grant execute on function private.rebuild_lineage(text), private.refresh_meta_counts()
  to authenticated;

create or replace function public.admin_rename_member(p_id text, p_name text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_tier text;
begin
  if not (select private.can_edit_tree()) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.family_members where id = p_id and generation <= 0)
     and not (select private.is_owner()) then
    raise exception 'not allowed';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'invalid name';
  end if;
  update public.family_members
     set name = v_name, raw_name = v_name, updated_at = now()
   where id = p_id
   returning tier into v_tier;
  if not found then raise exception 'member not found'; end if;
  if v_tier = 'tier1_son' then
    update public.family_members
       set branch_name = v_name, updated_at = now()
     where branch_id = p_id and branch_name is distinct from v_name;
  end if;
  perform private.rebuild_lineage(p_id);
end;
$$;

drop function if exists public.admin_set_bio(text, text);
create or replace function public.admin_set_bio(
  p_id text,
  p_bio text,
  p_kunyah text default null,
  p_is_deceased boolean default null,
  p_birth_year text default null,
  p_death_year text default null
)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not (select private.can_edit_tree()) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.family_members where id = p_id and generation <= 0)
     and not (select private.is_owner()) then
    raise exception 'not allowed';
  end if;
  if char_length(coalesce(p_bio, '')) > 1000 then raise exception 'note too long'; end if;
  update public.family_members
     set bio_note    = btrim(coalesce(p_bio, '')),
         kunyah      = case when p_kunyah is not null then left(btrim(p_kunyah), 80) else kunyah end,
         is_deceased = coalesce(p_is_deceased, is_deceased),
         birth_year  = case when p_birth_year is not null then left(btrim(p_birth_year), 20) else birth_year end,
         death_year  = case when p_death_year is not null then left(btrim(p_death_year), 20) else death_year end,
         updated_at  = now()
   where id = p_id;
  if not found then raise exception 'member not found'; end if;
end;
$$;

create or replace function public.admin_add_child(p_parent_id text, p_name text, p_bio text default '')
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_parent public.family_members;
  v_name   text := btrim(coalesce(p_name, ''));
  v_id     text;
  v_leaf_label text;
  v_mid_label  text;
begin
  if not (select private.can_edit_tree()) then raise exception 'not allowed'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'invalid name';
  end if;
  select * into v_parent from public.family_members where id = p_parent_id;
  if not found then raise exception 'parent not found'; end if;
  if v_parent.generation < 1 then raise exception 'cannot add under root or ancestor column'; end if;

  select tier_label into v_leaf_label from public.family_members where tier = 'tier4_leaf' limit 1;
  select tier_label into v_mid_label  from public.family_members where tier = 'tier3_mint' limit 1;

  -- Serialize id generation so two admins can't pick the same id.
  perform pg_advisory_xact_lock(hashtext('dhawi_uwaid_member_id'));
  select 'L' || lpad((coalesce(max(substring(id from 2)::int), 0) + 1)::text, 3, '0')
    into v_id
    from public.family_members where id ~ '^L[0-9]+$';

  insert into public.family_members
    (id, name, raw_name, parent_id, branch_id, branch_name, generation,
     tier, tier_label, sort_order, bio_note, full_lineage)
  values
    (v_id, v_name, v_name, v_parent.id, v_parent.branch_id, v_parent.branch_name,
     v_parent.generation + 1, 'tier4_leaf', coalesce(v_leaf_label, ''),
     coalesce((select max(sort_order) + 1 from public.family_members
               where parent_id = v_parent.id), 0),
     btrim(coalesce(p_bio, '')),
     v_name || ' بن ' || v_parent.full_lineage);

  -- A leaf that just got a son becomes a "father" node.
  if v_parent.tier = 'tier4_leaf' then
    update public.family_members
       set tier = 'tier3_mint', tier_label = coalesce(v_mid_label, tier_label), updated_at = now()
     where id = v_parent.id;
  end if;

  perform private.refresh_meta_counts();
  return v_id;
end;
$$;

create or replace function public.admin_delete_member(p_id text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_parent_id text;
  v_leaf_label text;
begin
  if not (select private.can_edit_tree()) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.family_members where parent_id = p_id) then
    raise exception 'member has children; remove them first';
  end if;
  delete from public.family_members
   where id = p_id and generation >= 2
   returning parent_id into v_parent_id;
  if not found then raise exception 'member not found or protected'; end if;

  -- Parent with no remaining sons goes back to leaf styling.
  if v_parent_id is not null
     and not exists (select 1 from public.family_members where parent_id = v_parent_id) then
    select tier_label into v_leaf_label from public.family_members where tier = 'tier4_leaf' limit 1;
    update public.family_members
       set tier = 'tier4_leaf', tier_label = coalesce(v_leaf_label, tier_label), updated_at = now()
     where id = v_parent_id and tier = 'tier3_mint';
  end if;

  perform private.refresh_meta_counts();
end;
$$;

create or replace function public.review_request(p_id uuid, p_decision text, p_note text default '')
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not (select private.can_review_requests()) then raise exception 'not allowed'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid decision'; end if;
  update public.update_requests
     set status = p_decision, reviewed_at = now(),
         reviewed_by = (select auth.uid()), review_note = left(coalesce(p_note, ''), 500)
   where id = p_id and status = 'pending';
  if not found then raise exception 'request not found or already reviewed'; end if;
end;
$$;

create or replace function public.owner_set_admin_permissions(
  p_user_id uuid,
  p_can_review boolean,
  p_can_edit boolean,
  p_can_brand boolean
)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not (select private.is_owner()) then raise exception 'not allowed'; end if;
  update public.admins
     set can_review_requests = coalesce(p_can_review, false),
         can_edit_tree       = coalesce(p_can_edit, false),
         can_access_brand    = coalesce(p_can_brand, false)
   where user_id = p_user_id and role = 'moderator';
  if not found then raise exception 'member not found or protected'; end if;
end;
$$;

create or replace function public.owner_set_site_settings(
  p_bios_enabled boolean,
  p_require_member_auth boolean,
  p_require_member_mfa boolean
)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not (select private.is_owner()) then raise exception 'not allowed'; end if;
  update public.tree_meta
     set feature_bios_enabled        = coalesce(p_bios_enabled, false),
         feature_require_member_auth = coalesce(p_require_member_auth, true),
         feature_require_member_mfa  = coalesce(p_require_member_mfa, true),
         updated_at                  = now()
   where id = 1;
end;
$$;

create or replace function public.admin_apply_and_approve_request(
  p_request_id uuid,
  p_note text default ''
)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_req    public.update_requests;
  v_res_id text;
begin
  if not ((select private.can_review_requests()) and (select private.can_edit_tree())) then
    raise exception 'not allowed';
  end if;

  select * into v_req from public.update_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'request not found or already reviewed';
  end if;
  if v_req.target_node_id is null then
    raise exception 'target node required';
  end if;

  if v_req.request_type in ('إضافة مولود جديد', 'إضافة ذرية غير مدونة') then
    v_res_id := public.admin_add_child(v_req.target_node_id, v_req.new_name, '');
  elsif v_req.request_type = 'تصحيح تهجئة اسم' then
    perform public.admin_rename_member(v_req.target_node_id, v_req.new_name);
    v_res_id := v_req.target_node_id;
  elsif v_req.request_type = 'إضافة سيرة / توثيق تاريخي' then
    perform public.admin_set_bio(v_req.target_node_id, coalesce(nullif(btrim(v_req.notes), ''), v_req.new_name));
    v_res_id := v_req.target_node_id;
  else
    raise exception 'unsupported request type for auto apply';
  end if;

  perform public.review_request(p_request_id, 'approved', p_note);
  return v_res_id;
end;
$$;

revoke all on function
  public.admin_rename_member(text, text),
  public.admin_set_bio(text, text, text, boolean, text, text),
  public.admin_add_child(text, text, text),
  public.admin_delete_member(text),
  public.review_request(uuid, text, text),
  public.owner_set_admin_permissions(uuid, boolean, boolean, boolean),
  public.owner_set_site_settings(boolean, boolean, boolean),
  public.admin_apply_and_approve_request(uuid, text)
from public, anon;
grant execute on function
  public.admin_rename_member(text, text),
  public.admin_set_bio(text, text, text, boolean, text, text),
  public.admin_add_child(text, text, text),
  public.admin_delete_member(text),
  public.review_request(uuid, text, text),
  public.owner_set_admin_permissions(uuid, boolean, boolean, boolean),
  public.owner_set_site_settings(boolean, boolean, boolean),
  public.admin_apply_and_approve_request(uuid, text)
to authenticated;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- BOOTSTRAP — run once, separately, after creating your user in
-- Authentication > Users. Replace the email.
-- ============================================================================
-- insert into public.admins (user_id, role, display_name, can_review_requests, can_edit_tree, can_access_brand)
-- select id, 'owner', 'فهد', true, true, true from auth.users where email = 'YOUR_EMAIL_HERE'
-- on conflict (user_id) do update
--   set role = 'owner', can_review_requests = true, can_edit_tree = true, can_access_brand = true;
--
-- Add a moderator later (create/invite the user first; starts with all permissions false until enabled by Owner in Admin Panel > المشرفون):
-- insert into public.admins (user_id, role, display_name, can_review_requests, can_edit_tree, can_access_brand)
-- select id, 'moderator', 'الاسم', false, false, false from auth.users where email = 'MODERATOR_EMAIL';
--
-- Remove a moderator (also delete/ban the user in Authentication > Users):
-- delete from public.admins where user_id = (select id from auth.users where email = 'MODERATOR_EMAIL');
