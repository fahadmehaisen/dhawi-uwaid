-- ============================================================================
-- Dhawi Uwaid — Unified Auth Portal, Single System Admin Lock, & Coordinators
-- Project: nmsmbcfnlqvnzfprexbh
--
-- Goals:
--   1. Enforce strictly ONE System Admin ('owner') account in public.admins.
--   2. Add granular per-coordinator feature flags (7 independent toggles):
--        can_review_requests, can_add_members, can_edit_members,
--        can_delete_members, can_access_brand, can_view_audit,
--        can_export_backup.
--   3. Auto-sync member_profiles from auth.users metadata when members sign up.
--   4. Provide Owner RPCs to list all registered members, promote any member
--      to coordinator/supervisor with chosen feature flags, toggle flags ON/OFF,
--      and remove coordinator role cleanly.
-- Idempotent: Safe to run once or re-run in Supabase SQL Editor.
-- ============================================================================

BEGIN;

-- 1. Granular permission columns on public.admins ---------------------------
ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS can_add_members    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_members   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_delete_members boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_audit     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_export_backup  boolean NOT NULL DEFAULT false;

-- Backfill existing rows cleanly
UPDATE public.admins
   SET can_review_requests = true,
       can_edit_tree       = true,
       can_add_members     = true,
       can_edit_members    = true,
       can_delete_members  = true,
       can_access_brand    = true,
       can_view_audit      = true,
       can_export_backup   = true
 WHERE role = 'owner';

UPDATE public.admins
   SET can_add_members  = true,
       can_edit_members = true
 WHERE role = 'moderator'
   AND can_edit_tree = true
   AND can_add_members = false
   AND can_edit_members = false
   AND can_delete_members = false;

-- Enforce strictly ONE System Admin ('owner') account at database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_single_owner
  ON public.admins (role)
  WHERE role = 'owner';

-- Guard trigger on public.admins to protect the sole owner & normalize flags
CREATE OR REPLACE FUNCTION private.guard_admins_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' AND current_user = 'authenticated' THEN
      RAISE EXCEPTION 'owner account is protected';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND (NEW.role IS DISTINCT FROM 'owner' OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
      RAISE EXCEPTION 'owner account is protected';
    END IF;
    IF OLD.role <> 'owner' AND NEW.role = 'owner' THEN
      RAISE EXCEPTION 'only one system admin account is allowed';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'owner' AND EXISTS (SELECT 1 FROM public.admins a WHERE a.role = 'owner') THEN
      RAISE EXCEPTION 'only one system admin account is allowed';
    END IF;
  END IF;

  IF NEW.role = 'owner' THEN
    NEW.can_review_requests := true;
    NEW.can_edit_tree       := true;
    NEW.can_add_members     := true;
    NEW.can_edit_members    := true;
    NEW.can_delete_members  := true;
    NEW.can_access_brand    := true;
    NEW.can_view_audit      := true;
    NEW.can_export_backup   := true;
  ELSE
    NEW.can_review_requests := coalesce(NEW.can_review_requests, false);
    NEW.can_add_members     := coalesce(NEW.can_add_members, false);
    NEW.can_edit_members    := coalesce(NEW.can_edit_members, false);
    NEW.can_delete_members  := coalesce(NEW.can_delete_members, false);
    NEW.can_access_brand    := coalesce(NEW.can_access_brand, false);
    NEW.can_view_audit      := coalesce(NEW.can_view_audit, false);
    NEW.can_export_backup   := coalesce(NEW.can_export_backup, false);
    NEW.can_edit_tree       := (NEW.can_add_members OR NEW.can_edit_members OR NEW.can_delete_members);
  END IF;

  NEW.display_name := left(btrim(coalesce(NEW.display_name, '')), 80);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_admins_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_admins_integrity ON public.admins;
CREATE TRIGGER trg_guard_admins_integrity
  BEFORE INSERT OR UPDATE OR DELETE ON public.admins
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_admins_integrity();

-- Dedicated audit trigger for public.admins (uses user_id PK, NOT id)
CREATE OR REPLACE FUNCTION private.log_admin_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (table_name, row_id, action, old_data, new_data, actor)
  VALUES (
    'admins',
    coalesce(NEW.user_id, OLD.user_id)::text,
    TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    (SELECT auth.uid())
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION private.log_admin_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_admins ON public.admins;
CREATE TRIGGER trg_audit_admins
  AFTER INSERT OR UPDATE OR DELETE ON public.admins
  FOR EACH ROW
  EXECUTE FUNCTION private.log_admin_change();

-- 2. Granular Permission Helper Functions (all require aal2 MFA) -------------
CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = (SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION private.is_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid()) AND a.role = 'owner'
     );
$$;

CREATE OR REPLACE FUNCTION private.can_review_requests()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid())
         AND (a.role = 'owner' OR a.can_review_requests = true)
     );
$$;

CREATE OR REPLACE FUNCTION private.can_add_members()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid())
         AND (a.role = 'owner' OR a.can_add_members = true)
     );
$$;

CREATE OR REPLACE FUNCTION private.can_edit_members()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid())
         AND (a.role = 'owner' OR a.can_edit_members = true)
     );
$$;

CREATE OR REPLACE FUNCTION private.can_delete_members()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid())
         AND (a.role = 'owner' OR a.can_delete_members = true)
     );
$$;

CREATE OR REPLACE FUNCTION private.can_edit_tree()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid())
         AND (
           a.role = 'owner'
           OR a.can_add_members = true
           OR a.can_edit_members = true
           OR a.can_delete_members = true
         )
     );
$$;

CREATE OR REPLACE FUNCTION private.can_access_brand()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid())
         AND (a.role = 'owner' OR a.can_access_brand = true)
     );
$$;

CREATE OR REPLACE FUNCTION private.can_view_audit()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid())
         AND (a.role = 'owner' OR a.can_view_audit = true)
     );
$$;

CREATE OR REPLACE FUNCTION private.can_export_backup()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', '') = 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.admins a
       WHERE a.user_id = (SELECT auth.uid())
         AND (a.role = 'owner' OR a.can_export_backup = true)
     );
$$;

REVOKE ALL ON FUNCTION
  private.is_admin(),
  private.is_owner(),
  private.can_review_requests(),
  private.can_add_members(),
  private.can_edit_members(),
  private.can_delete_members(),
  private.can_edit_tree(),
  private.can_access_brand(),
  private.can_view_audit(),
  private.can_export_backup()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  private.is_admin(),
  private.is_owner(),
  private.can_review_requests(),
  private.can_add_members(),
  private.can_edit_members(),
  private.can_delete_members(),
  private.can_edit_tree(),
  private.can_access_brand(),
  private.can_view_audit(),
  private.can_export_backup()
TO authenticated;

-- 3. Tighten RLS Policies to Match Granular Permissions ---------------------
DROP POLICY IF EXISTS admins_read ON public.admins;
CREATE POLICY admins_read ON public.admins
  FOR SELECT TO authenticated
  USING ((SELECT private.is_owner()));

DROP POLICY IF EXISTS family_members_admin_insert ON public.family_members;
CREATE POLICY family_members_admin_insert ON public.family_members
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can_add_members()) AND generation >= 2);

DROP POLICY IF EXISTS family_members_admin_update ON public.family_members;
CREATE POLICY family_members_admin_update ON public.family_members
  FOR UPDATE TO authenticated
  USING ((SELECT private.can_edit_members()) AND (generation >= 1 OR (SELECT private.is_owner())))
  WITH CHECK ((SELECT private.can_edit_members()) AND (generation >= 1 OR (SELECT private.is_owner())));

DROP POLICY IF EXISTS family_members_admin_delete ON public.family_members;
CREATE POLICY family_members_admin_delete ON public.family_members
  FOR DELETE TO authenticated
  USING (
    (SELECT private.can_delete_members())
    AND generation >= 2
    AND NOT EXISTS (
      SELECT 1 FROM public.family_members c WHERE c.parent_id = family_members.id
    )
  );

DROP POLICY IF EXISTS tree_meta_admin_update ON public.tree_meta;
CREATE POLICY tree_meta_admin_update ON public.tree_meta
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_owner()))
  WITH CHECK ((SELECT private.is_owner()));

DROP POLICY IF EXISTS update_requests_admin_read ON public.update_requests;
CREATE POLICY update_requests_admin_read ON public.update_requests
  FOR SELECT TO authenticated
  USING ((SELECT private.can_review_requests()) OR (SELECT private.can_export_backup()));

DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT TO authenticated
  USING ((SELECT private.can_view_audit()));

DROP POLICY IF EXISTS member_profiles_admin_read ON public.member_profiles;
DROP POLICY IF EXISTS member_profiles_owner_read ON public.member_profiles;
CREATE POLICY member_profiles_owner_read ON public.member_profiles
  FOR SELECT TO authenticated
  USING ((SELECT private.is_owner()) OR user_id = (SELECT auth.uid()));

-- 4. Auto-Link member_profiles from auth.users Metadata & Backfill Emails ----
UPDATE public.member_profiles mp
   SET email = au.email,
       updated_at = now()
  FROM auth.users au
 WHERE au.id = mp.user_id
   AND coalesce(mp.email, '') = ''
   AND coalesce(au.email, '') <> '';

CREATE OR REPLACE FUNCTION private.can_submit_request()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_req_auth boolean := true;
  v_req_mfa  boolean := true;
BEGIN
  SELECT coalesce(feature_require_member_auth, true),
         coalesce(feature_require_member_mfa, true)
    INTO v_req_auth, v_req_mfa
    FROM public.tree_meta
   WHERE id = 1;

  IF NOT coalesce(v_req_auth, true) THEN
    RETURN true;
  END IF;

  IF (SELECT auth.uid()) IS NULL THEN
    RETURN false;
  END IF;

  IF coalesce(v_req_mfa, true) AND coalesce((SELECT auth.jwt()) ->> 'aal', '') <> 'aal2' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.member_profiles mp WHERE mp.user_id = (SELECT auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.admins a WHERE a.user_id = (SELECT auth.uid())
  );
END;
$$;

REVOKE ALL ON FUNCTION private.can_submit_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_submit_request() TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.sync_member_profile_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id text;
  v_phone_raw text;
  v_phone_clean text;
  v_digits text;
  v_email text;
BEGIN
  BEGIN
    v_email := coalesce(NEW.email, '');
    v_member_id := btrim(coalesce(NEW.raw_user_meta_data ->> 'member_id', ''));
    v_phone_raw := coalesce(NEW.raw_user_meta_data ->> 'phone', '');
    v_phone_clean := left(regexp_replace(v_phone_raw, '[^0-9+]', '', 'g'), 24);
    v_digits := regexp_replace(v_phone_clean, '\D', '', 'g');

    IF v_member_id <> ''
       AND length(v_digits) BETWEEN 8 AND 16
       AND EXISTS (
         SELECT 1 FROM public.family_members fm
         WHERE fm.id = v_member_id AND fm.generation >= 1
       ) THEN
      INSERT INTO public.member_profiles (user_id, member_id, phone, email)
      VALUES (NEW.id, v_member_id, v_phone_clean, v_email)
      ON CONFLICT (user_id) DO UPDATE SET
        email = COALESCE(NULLIF(EXCLUDED.email, ''), public.member_profiles.email);
    ELSIF v_email <> '' THEN
      UPDATE public.member_profiles
         SET email = v_email,
             updated_at = now()
       WHERE user_id = NEW.id
         AND coalesce(email, '') IS DISTINCT FROM v_email;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_member_profile_from_auth() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_member_profile_from_auth ON auth.users;
CREATE TRIGGER trg_sync_member_profile_from_auth
  AFTER INSERT OR UPDATE OF raw_user_meta_data, email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_member_profile_from_auth();

-- 5. Update Tree, Request & Invite RPCs for Granular Permissions ------------
CREATE OR REPLACE FUNCTION private.rebuild_lineage(p_id text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  WITH RECURSIVE sub AS (
    SELECT m.id, m.name || coalesce(' بن ' || p.full_lineage, '') AS lineage
      FROM public.family_members m
      LEFT JOIN public.family_members p ON p.id = m.parent_id
     WHERE m.id = p_id
    UNION ALL
    SELECT c.id, c.name || ' بن ' || s.lineage
      FROM public.family_members c
      JOIN sub s ON c.parent_id = s.id
  )
  UPDATE public.family_members f
     SET full_lineage = sub.lineage, updated_at = now()
    FROM sub
   WHERE f.id = sub.id AND f.full_lineage IS DISTINCT FROM sub.lineage;
$$;

CREATE OR REPLACE FUNCTION private.refresh_meta_counts()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.tree_meta t
     SET total_nodes      = (SELECT count(*) FROM public.family_members),
         descendant_count = (SELECT count(*) FROM public.family_members WHERE generation >= 1),
         ancestor_count   = (SELECT count(*) FROM public.family_members WHERE generation < 0),
         updated_at       = now()
   WHERE t.id = 1;
$$;

REVOKE ALL ON FUNCTION private.rebuild_lineage(text), private.refresh_meta_counts()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_rename_member(p_id text, p_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_tier text;
BEGIN
  IF NOT (SELECT private.can_edit_members()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.family_members WHERE id = p_id AND generation <= 0)
     AND NOT (SELECT private.is_owner()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'invalid name';
  END IF;
  UPDATE public.family_members
     SET name = v_name, raw_name = v_name, updated_at = now()
   WHERE id = p_id
   RETURNING tier INTO v_tier;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found'; END IF;
  IF v_tier = 'tier1_son' THEN
    UPDATE public.family_members
       SET branch_name = v_name, updated_at = now()
     WHERE branch_id = p_id AND branch_name IS DISTINCT FROM v_name;
  END IF;
  PERFORM private.rebuild_lineage(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_bio(
  p_id text,
  p_bio text,
  p_kunyah text DEFAULT NULL,
  p_is_deceased boolean DEFAULT NULL,
  p_birth_year text DEFAULT NULL,
  p_death_year text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT private.can_edit_members()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.family_members WHERE id = p_id AND generation <= 0)
     AND NOT (SELECT private.is_owner()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF char_length(coalesce(p_bio, '')) > 1000 THEN RAISE EXCEPTION 'note too long'; END IF;
  UPDATE public.family_members
     SET bio_note    = btrim(coalesce(p_bio, '')),
         kunyah      = CASE WHEN p_kunyah IS NOT NULL THEN left(btrim(p_kunyah), 80) ELSE kunyah END,
         is_deceased = coalesce(p_is_deceased, is_deceased),
         birth_year  = CASE WHEN p_birth_year IS NOT NULL THEN left(btrim(p_birth_year), 20) ELSE birth_year END,
         death_year  = CASE WHEN p_death_year IS NOT NULL THEN left(btrim(p_death_year), 20) ELSE death_year END,
         updated_at  = now()
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_add_child(p_parent_id text, p_name text, p_bio text DEFAULT '')
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_parent public.family_members;
  v_name   text := btrim(coalesce(p_name, ''));
  v_id     text;
  v_leaf_label text;
  v_mid_label  text;
BEGIN
  IF NOT (SELECT private.can_add_members()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 60 THEN
    RAISE EXCEPTION 'invalid name';
  END IF;
  SELECT * INTO v_parent FROM public.family_members WHERE id = p_parent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'parent not found'; END IF;
  IF v_parent.generation < 1 THEN RAISE EXCEPTION 'cannot add under root or ancestor column'; END IF;

  SELECT tier_label INTO v_leaf_label FROM public.family_members WHERE tier = 'tier4_leaf' LIMIT 1;
  SELECT tier_label INTO v_mid_label  FROM public.family_members WHERE tier = 'tier3_mint' LIMIT 1;

  PERFORM pg_advisory_xact_lock(hashtext('dhawi_uwaid_member_id'));
  SELECT 'L' || lpad((coalesce(max(substring(id from 2)::int), 0) + 1)::text, 3, '0')
    INTO v_id
    FROM public.family_members WHERE id ~ '^L[0-9]+$';

  INSERT INTO public.family_members
    (id, name, raw_name, parent_id, branch_id, branch_name, generation,
     tier, tier_label, sort_order, bio_note, full_lineage)
  VALUES
    (v_id, v_name, v_name, v_parent.id, v_parent.branch_id, v_parent.branch_name,
     v_parent.generation + 1, 'tier4_leaf', coalesce(v_leaf_label, ''),
     coalesce((SELECT max(sort_order) + 1 FROM public.family_members
               WHERE parent_id = v_parent.id), 0),
     btrim(coalesce(p_bio, '')),
     v_name || ' بن ' || v_parent.full_lineage);

  IF v_parent.tier = 'tier4_leaf' THEN
    UPDATE public.family_members
       SET tier = 'tier3_mint', tier_label = coalesce(v_mid_label, tier_label), updated_at = now()
     WHERE id = v_parent.id;
  END IF;

  PERFORM private.refresh_meta_counts();
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_member(p_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_parent_id text;
  v_leaf_label text;
BEGIN
  IF NOT (SELECT private.can_delete_members()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF EXISTS (SELECT 1 FROM public.family_members WHERE parent_id = p_id) THEN
    RAISE EXCEPTION 'member has children; remove them first';
  END IF;
  DELETE FROM public.family_members
   WHERE id = p_id AND generation >= 2
   RETURNING parent_id INTO v_parent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found or protected'; END IF;

  IF v_parent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.family_members WHERE parent_id = v_parent_id) THEN
    SELECT tier_label INTO v_leaf_label FROM public.family_members WHERE tier = 'tier4_leaf' LIMIT 1;
    UPDATE public.family_members
       SET tier = 'tier4_leaf', tier_label = coalesce(v_leaf_label, tier_label), updated_at = now()
     WHERE id = v_parent_id AND tier = 'tier3_mint';
  END IF;

  PERFORM private.refresh_meta_counts();
END;
$$;

CREATE OR REPLACE FUNCTION public.review_request(p_id uuid, p_decision text, p_note text DEFAULT '')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT private.can_review_requests()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  UPDATE public.update_requests
     SET status = p_decision, reviewed_at = now(),
         reviewed_by = (SELECT auth.uid()), review_note = left(coalesce(p_note, ''), 500)
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found or already reviewed'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_apply_and_approve_request(
  p_request_id uuid,
  p_note text DEFAULT ''
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_req    public.update_requests;
  v_res_id text;
BEGIN
  IF NOT (SELECT private.can_review_requests()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT * INTO v_req FROM public.update_requests WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found or already reviewed';
  END IF;
  IF v_req.target_node_id IS NULL THEN
    RAISE EXCEPTION 'target node required';
  END IF;

  IF v_req.request_type IN ('إضافة مولود جديد', 'إضافة ذرية غير مدونة') THEN
    IF NOT (SELECT private.can_add_members()) THEN RAISE EXCEPTION 'not allowed'; END IF;
    v_res_id := public.admin_add_child(v_req.target_node_id, v_req.new_name, '');
  ELSIF v_req.request_type = 'تصحيح تهجئة اسم' THEN
    IF NOT (SELECT private.can_edit_members()) THEN RAISE EXCEPTION 'not allowed'; END IF;
    PERFORM public.admin_rename_member(v_req.target_node_id, v_req.new_name);
    v_res_id := v_req.target_node_id;
  ELSIF v_req.request_type = 'إضافة سيرة / توثيق تاريخي' THEN
    IF NOT (SELECT private.can_edit_members()) THEN RAISE EXCEPTION 'not allowed'; END IF;
    PERFORM public.admin_set_bio(v_req.target_node_id, coalesce(nullif(btrim(v_req.notes), ''), v_req.new_name));
    v_res_id := v_req.target_node_id;
  ELSE
    RAISE EXCEPTION 'unsupported request type for auto apply';
  END IF;

  PERFORM public.review_request(p_request_id, 'approved', p_note);
  RETURN v_res_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_member_invite(
  p_temp_password text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_email text := '';
  v_clean_phone text;
  v_digits text;
  v_norm text := private.normalize_invite_code(p_temp_password);
  v_hint text;
  v_inv public.member_invites%ROWTYPE;
  v_rec record;
  v_member_name text;
  v_lineage text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to claim invite';
  END IF;

  v_clean_phone := left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 24);
  v_digits := regexp_replace(v_clean_phone, '\D', '', 'g');
  IF length(v_digits) < 8 OR length(v_digits) > 16 THEN
    RAISE EXCEPTION 'A valid mobile phone number is required';
  END IF;

  IF length(v_norm) <> 10 OR left(v_norm, 2) <> 'DU' THEN
    RAISE EXCEPTION 'Invalid temporary password format';
  END IF;

  v_hint := 'DU-****-' || right(v_norm, 4);

  FOR v_rec IN
    SELECT *
    FROM public.member_invites mi
    WHERE mi.code_hint = v_hint
    ORDER BY mi.created_at DESC
    FOR UPDATE
  LOOP
    IF v_rec.code_hash = encode(pg_catalog.sha256(convert_to(v_rec.code_salt || ':' || v_norm, 'utf8')), 'hex') THEN
      v_inv := v_rec;
      EXIT;
    END IF;
  END LOOP;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Temporary password not found';
  END IF;
  IF v_inv.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Temporary password has already been used';
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Temporary password has been revoked';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'Temporary password has expired';
  END IF;

  SELECT coalesce(au.email, '') INTO v_email FROM auth.users au WHERE au.id = v_uid;

  SELECT fm.name, coalesce(fm.full_lineage, fm.name)
    INTO v_member_name, v_lineage
  FROM public.family_members fm
  WHERE fm.id = v_inv.member_id;

  IF v_member_name IS NULL THEN
    RAISE EXCEPTION 'Target member % no longer exists', v_inv.member_id;
  END IF;

  UPDATE public.member_invites
  SET used_at = now(),
      claimed_by = v_uid
  WHERE id = v_inv.id;

  INSERT INTO public.member_profiles (user_id, member_id, phone, email)
  VALUES (v_uid, v_inv.member_id, v_clean_phone, coalesce(v_email, ''))
  ON CONFLICT (user_id) DO UPDATE SET
    member_id = EXCLUDED.member_id,
    phone = EXCLUDED.phone,
    email = COALESCE(NULLIF(EXCLUDED.email, ''), public.member_profiles.email);

  IF v_inv.target_role = 'moderator' THEN
    INSERT INTO public.admins (
      user_id, role, display_name,
      can_review_requests, can_edit_tree, can_add_members, can_edit_members, can_delete_members,
      can_access_brand, can_view_audit, can_export_backup
    ) VALUES (
      v_uid, 'moderator', left(v_member_name, 80),
      v_inv.can_review_requests, v_inv.can_edit_tree, v_inv.can_edit_tree, v_inv.can_edit_tree, false,
      v_inv.can_access_brand, false, false
    )
    ON CONFLICT (user_id) DO UPDATE SET
      display_name = CASE
        WHEN coalesce(public.admins.display_name, '') = '' THEN EXCLUDED.display_name
        ELSE public.admins.display_name
      END,
      role = CASE
        WHEN public.admins.role = 'owner' THEN 'owner'
        ELSE 'moderator'
      END,
      can_review_requests = CASE
        WHEN public.admins.role = 'owner' THEN true
        ELSE EXCLUDED.can_review_requests
      END,
      can_edit_tree = CASE
        WHEN public.admins.role = 'owner' THEN true
        ELSE EXCLUDED.can_edit_tree
      END,
      can_add_members = CASE
        WHEN public.admins.role = 'owner' THEN true
        ELSE EXCLUDED.can_add_members
      END,
      can_edit_members = CASE
        WHEN public.admins.role = 'owner' THEN true
        ELSE EXCLUDED.can_edit_members
      END,
      can_access_brand = CASE
        WHEN public.admins.role = 'owner' THEN true
        ELSE EXCLUDED.can_access_brand
      END;
  END IF;

  PERFORM private.write_invite_audit(
    v_uid,
    v_email,
    'invite_claimed',
    v_inv.id::text,
    jsonb_build_object(
      'member_id', v_inv.member_id,
      'member_name', v_member_name,
      'target_role', v_inv.target_role,
      'phone', v_clean_phone
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'member_id', v_inv.member_id,
    'member_name', v_member_name,
    'full_lineage', v_lineage,
    'phone', v_clean_phone,
    'target_role', v_inv.target_role,
    'can_review_requests', v_inv.can_review_requests,
    'can_edit_tree', v_inv.can_edit_tree,
    'can_access_brand', v_inv.can_access_brand
  );
END;
$$;

-- 6. Owner Coordinator Management & Audit RPCs ------------------------------
CREATE OR REPLACE FUNCTION public.owner_list_registered_members()
RETURNS TABLE (
  user_id uuid,
  email text,
  email_confirmed boolean,
  member_id text,
  member_name text,
  full_lineage text,
  branch_name text,
  phone text,
  role text,
  display_name text,
  can_review_requests boolean,
  can_add_members boolean,
  can_edit_members boolean,
  can_delete_members boolean,
  can_access_brand boolean,
  can_view_audit boolean,
  can_export_backup boolean,
  admin_since timestamptz,
  registered_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.is_owner() THEN
    RAISE EXCEPTION 'Owner privileges required';
  END IF;

  RETURN QUERY
  SELECT
    au.id AS user_id,
    coalesce(au.email, '') AS email,
    (au.email_confirmed_at IS NOT NULL) AS email_confirmed,
    coalesce(mp.member_id, nullif(au.raw_user_meta_data ->> 'member_id', ''), '') AS member_id,
    coalesce(fm.name, '') AS member_name,
    coalesce(fm.full_lineage, coalesce(fm.name, '')) AS full_lineage,
    coalesce(fm.branch_name, coalesce(mp.branch_name, '')) AS branch_name,
    coalesce(
      nullif(mp.phone, ''),
      left(regexp_replace(coalesce(au.raw_user_meta_data ->> 'phone', ''), '[^0-9+]', '', 'g'), 24),
      ''
    ) AS phone,
    coalesce(a.role, 'member') AS role,
    coalesce(a.display_name, '') AS display_name,
    coalesce(a.can_review_requests, false) AS can_review_requests,
    coalesce(a.can_add_members, false) AS can_add_members,
    coalesce(a.can_edit_members, false) AS can_edit_members,
    coalesce(a.can_delete_members, false) AS can_delete_members,
    coalesce(a.can_access_brand, false) AS can_access_brand,
    coalesce(a.can_view_audit, false) AS can_view_audit,
    coalesce(a.can_export_backup, false) AS can_export_backup,
    a.created_at AS admin_since,
    au.created_at AS registered_at
  FROM auth.users au
  LEFT JOIN public.member_profiles mp ON mp.user_id = au.id
  LEFT JOIN public.family_members fm
    ON fm.id = coalesce(mp.member_id, nullif(au.raw_user_meta_data ->> 'member_id', ''))
  LEFT JOIN public.admins a ON a.user_id = au.id
  ORDER BY
    CASE a.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
    au.created_at DESC
  LIMIT 500;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_promote_member_to_coordinator(
  p_user_id uuid,
  p_display_name text DEFAULT '',
  p_can_review boolean DEFAULT false,
  p_can_add boolean DEFAULT false,
  p_can_edit boolean DEFAULT false,
  p_can_delete boolean DEFAULT false,
  p_can_brand boolean DEFAULT false,
  p_can_audit boolean DEFAULT false,
  p_can_backup boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_role text;
  v_email text;
  v_lineage text;
  v_member_name text;
  v_meta_member_id text;
  v_parts text[];
  v_display text := btrim(coalesce(p_display_name, ''));
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.is_owner() THEN
    RAISE EXCEPTION 'Owner privileges required';
  END IF;

  SELECT au.email, nullif(au.raw_user_meta_data ->> 'member_id', '')
    INTO v_email, v_meta_member_id
    FROM auth.users au
   WHERE au.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  SELECT a.role INTO v_existing_role FROM public.admins a WHERE a.user_id = p_user_id;
  IF v_existing_role = 'owner' THEN
    RAISE EXCEPTION 'owner account is protected';
  END IF;

  IF v_display = '' THEN
    SELECT fm.full_lineage, fm.name
      INTO v_lineage, v_member_name
      FROM public.member_profiles mp
      JOIN public.family_members fm ON fm.id = mp.member_id
     WHERE mp.user_id = p_user_id;

    IF v_lineage IS NULL AND v_meta_member_id IS NOT NULL THEN
      SELECT fm.full_lineage, fm.name
        INTO v_lineage, v_member_name
        FROM public.family_members fm
       WHERE fm.id = v_meta_member_id;
    END IF;

    IF coalesce(v_lineage, '') <> '' THEN
      v_parts := string_to_array(v_lineage, ' بن ');
      IF array_length(v_parts, 1) >= 2 THEN
        v_display := v_parts[1] || ' بن ' || v_parts[2];
      ELSE
        v_display := v_lineage;
      END IF;
    ELSIF coalesce(v_member_name, '') <> '' THEN
      v_display := v_member_name;
    ELSE
      v_display := coalesce(v_email, 'منسّق');
    END IF;
  END IF;

  v_display := left(v_display, 80);

  INSERT INTO public.admins (
    user_id, role, display_name,
    can_review_requests, can_add_members, can_edit_members, can_delete_members,
    can_access_brand, can_view_audit, can_export_backup, can_edit_tree
  ) VALUES (
    p_user_id, 'moderator', v_display,
    coalesce(p_can_review, false),
    coalesce(p_can_add, false),
    coalesce(p_can_edit, false),
    coalesce(p_can_delete, false),
    coalesce(p_can_brand, false),
    coalesce(p_can_audit, false),
    coalesce(p_can_backup, false),
    (coalesce(p_can_add, false) OR coalesce(p_can_edit, false) OR coalesce(p_can_delete, false))
  )
  ON CONFLICT (user_id) DO UPDATE SET
    display_name        = CASE WHEN coalesce(nullif(btrim(p_display_name), ''), '') <> '' THEN EXCLUDED.display_name ELSE public.admins.display_name END,
    can_review_requests = EXCLUDED.can_review_requests,
    can_add_members     = EXCLUDED.can_add_members,
    can_edit_members    = EXCLUDED.can_edit_members,
    can_delete_members  = EXCLUDED.can_delete_members,
    can_access_brand    = EXCLUDED.can_access_brand,
    can_view_audit      = EXCLUDED.can_view_audit,
    can_export_backup   = EXCLUDED.can_export_backup,
    can_edit_tree       = EXCLUDED.can_edit_tree;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'display_name', v_display,
    'role', 'moderator'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_coordinator_permissions(
  p_user_id uuid,
  p_can_review boolean DEFAULT false,
  p_can_add boolean DEFAULT false,
  p_can_edit boolean DEFAULT false,
  p_can_delete boolean DEFAULT false,
  p_can_brand boolean DEFAULT false,
  p_can_audit boolean DEFAULT false,
  p_can_backup boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.is_owner() THEN
    RAISE EXCEPTION 'Owner privileges required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = p_user_id AND a.role = 'owner') THEN
    RAISE EXCEPTION 'owner account is protected';
  END IF;

  UPDATE public.admins
     SET can_review_requests = coalesce(p_can_review, false),
         can_add_members     = coalesce(p_can_add, false),
         can_edit_members    = coalesce(p_can_edit, false),
         can_delete_members  = coalesce(p_can_delete, false),
         can_access_brand    = coalesce(p_can_brand, false),
         can_view_audit      = coalesce(p_can_audit, false),
         can_export_backup   = coalesce(p_can_backup, false),
         can_edit_tree       = (coalesce(p_can_add, false) OR coalesce(p_can_edit, false) OR coalesce(p_can_delete, false))
   WHERE user_id = p_user_id AND role = 'moderator';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found or protected';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_admin_permissions(
  p_user_id uuid,
  p_can_review boolean,
  p_can_edit boolean,
  p_can_brand boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT private.is_owner()) THEN RAISE EXCEPTION 'not allowed'; END IF;
  UPDATE public.admins
     SET can_review_requests = coalesce(p_can_review, false),
         can_edit_tree       = coalesce(p_can_edit, false),
         can_add_members     = coalesce(p_can_edit, false),
         can_edit_members    = coalesce(p_can_edit, false),
         can_access_brand    = coalesce(p_can_brand, false)
   WHERE user_id = p_user_id AND role = 'moderator';
  IF NOT FOUND THEN RAISE EXCEPTION 'member not found or protected'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_remove_coordinator(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.is_owner() THEN
    RAISE EXCEPTION 'Owner privileges required';
  END IF;

  SELECT role INTO v_role FROM public.admins WHERE user_id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'member not found or protected';
  END IF;
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'owner account is protected';
  END IF;

  DELETE FROM public.admins
   WHERE user_id = p_user_id AND role = 'moderator';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found or protected';
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_audit_log(p_limit integer DEFAULT 150)
RETURNS TABLE (
  id bigint,
  table_name text,
  row_id text,
  action text,
  old_data jsonb,
  new_data jsonb,
  actor uuid,
  actor_name text,
  at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lim integer := least(greatest(coalesce(p_limit, 150), 1), 300);
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.can_view_audit() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.table_name,
    al.row_id,
    al.action,
    al.old_data,
    al.new_data,
    al.actor,
    coalesce(
      nullif(a.display_name, ''),
      nullif(mp.member_full_lineage, ''),
      nullif(au.email, ''),
      ''
    ) AS actor_name,
    al.at
  FROM public.audit_log al
  LEFT JOIN public.admins a ON a.user_id = al.actor
  LEFT JOIN public.member_profiles mp ON mp.user_id = al.actor
  LEFT JOIN auth.users au ON au.id = al.actor
  ORDER BY al.at DESC
  LIMIT v_lim;
END;
$$;

-- 7. Execution Grants -------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.admin_rename_member(text, text),
  public.admin_set_bio(text, text, text, boolean, text, text),
  public.admin_add_child(text, text, text),
  public.admin_delete_member(text),
  public.review_request(uuid, text, text),
  public.admin_apply_and_approve_request(uuid, text),
  public.claim_member_invite(text, text),
  public.owner_list_registered_members(),
  public.owner_promote_member_to_coordinator(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean),
  public.owner_set_coordinator_permissions(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean),
  public.owner_set_admin_permissions(uuid, boolean, boolean, boolean),
  public.owner_remove_coordinator(uuid),
  public.admin_list_audit_log(integer)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_rename_member(text, text),
  public.admin_set_bio(text, text, text, boolean, text, text),
  public.admin_add_child(text, text, text),
  public.admin_delete_member(text),
  public.review_request(uuid, text, text),
  public.admin_apply_and_approve_request(uuid, text),
  public.claim_member_invite(text, text),
  public.owner_list_registered_members(),
  public.owner_promote_member_to_coordinator(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean),
  public.owner_set_coordinator_permissions(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean),
  public.owner_set_admin_permissions(uuid, boolean, boolean, boolean),
  public.owner_remove_coordinator(uuid),
  public.admin_list_audit_log(integer)
TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
