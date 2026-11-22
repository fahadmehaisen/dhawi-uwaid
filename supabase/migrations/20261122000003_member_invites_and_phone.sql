-- ============================================================================
-- Dhawi Uwaid Family Tree — Owner-Managed Invites & Required Member Phones
-- Target Project: https://nmsmbcfnlqvnzfprexbh.supabase.co
-- Idempotent migration: safe to run on existing live database.
-- ============================================================================

BEGIN;

-- 1. Add required phone column to verified member_profiles & Owner read access
ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';

DROP POLICY IF EXISTS member_profiles_owner_read ON public.member_profiles;
CREATE POLICY member_profiles_owner_read ON public.member_profiles
  FOR SELECT TO authenticated
  USING (private.is_owner() OR user_id = (SELECT auth.uid()));

-- Companion BEFORE trigger to sanitize and validate mobile phone without altering existing guard logic
CREATE OR REPLACE FUNCTION private.guard_member_profile_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clean text;
  v_digits text;
BEGIN
  v_clean := left(regexp_replace(coalesce(NEW.phone, ''), '[^0-9+]', '', 'g'), 24);
  NEW.phone := v_clean;

  IF NEW.member_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.family_members fm WHERE fm.id = NEW.member_id
  ) THEN
    RAISE EXCEPTION 'Invalid family tree member_id';
  END IF;

  IF TG_OP = 'INSERT' OR (NEW.phone IS DISTINCT FROM OLD.phone) THEN
    v_digits := regexp_replace(v_clean, '\D', '', 'g');
    IF length(v_digits) < 8 OR length(v_digits) > 16 THEN
      RAISE EXCEPTION 'A valid mobile phone number (8-16 digits) is required';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aa_member_profile_phone ON public.member_profiles;
CREATE TRIGGER trg_aa_member_profile_phone
  BEFORE INSERT OR UPDATE ON public.member_profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_member_profile_phone();

-- 2. Direct audit helper matching exact public.audit_log columns
CREATE OR REPLACE FUNCTION private.write_invite_audit(
  p_actor_id uuid,
  p_actor_email text,
  p_action text,
  p_target_id text,
  p_details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (table_name, row_id, action, new_data, actor)
  VALUES (
    'member_invites',
    coalesce(p_target_id, ''),
    CASE WHEN p_action = 'invite_created' THEN 'INSERT' ELSE 'UPDATE' END,
    coalesce(p_details, '{}'::jsonb) || jsonb_build_object('event', p_action, 'actor_email', coalesce(p_actor_email, '')),
    p_actor_id
  );
END;
$$;

-- 3. Member invites table (hashes only, never plain passwords stored)
CREATE TABLE IF NOT EXISTS public.member_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id text NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  target_role text NOT NULL DEFAULT 'member' CHECK (target_role IN ('member', 'moderator')),
  can_review_requests boolean NOT NULL DEFAULT false,
  can_edit_tree boolean NOT NULL DEFAULT false,
  can_access_brand boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  code_hint text NOT NULL DEFAULT '',
  code_salt text NOT NULL,
  code_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  revoked_at timestamptz,
  used_at timestamptz,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_member_invites_member_created
  ON public.member_invites(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_invites_active_hint
  ON public.member_invites(code_hint)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.member_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_invites_owner_read ON public.member_invites;
CREATE POLICY member_invites_owner_read ON public.member_invites
  FOR SELECT TO authenticated
  USING (private.is_owner());

REVOKE ALL ON public.member_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, member_id, target_role, can_review_requests, can_edit_tree, can_access_brand,
  note, code_hint, created_by, created_at, expires_at, revoked_at, used_at, claimed_by
) ON public.member_invites TO authenticated;

-- 4. Code normalization helper
CREATE OR REPLACE FUNCTION private.normalize_invite_code(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT regexp_replace(upper(btrim(coalesce(p_raw, ''))), '[^A-Z0-9]', '', 'g');
$$;

-- 5. Owner creates one-time temporary password invite
CREATE OR REPLACE FUNCTION public.owner_create_member_invite(
  p_member_id text,
  p_target_role text DEFAULT 'member',
  p_can_review boolean DEFAULT false,
  p_can_edit_tree boolean DEFAULT false,
  p_can_access_brand boolean DEFAULT false,
  p_note text DEFAULT '',
  p_expires_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_actor_email text := '';
  v_member_name text;
  v_lineage text;
  v_role text := lower(btrim(coalesce(p_target_role, 'member')));
  v_days integer := least(greatest(coalesce(p_expires_days, 14), 1), 90);
  v_rev boolean := false;
  v_edit boolean := false;
  v_brand boolean := false;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_raw_hex text;
  v_i integer;
  v_idx integer;
  v_part1 text := '';
  v_part2 text := '';
  v_display_code text;
  v_norm_code text;
  v_hint text;
  v_salt text;
  v_hash text;
  v_invite_id uuid;
  v_expires_at timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT private.is_owner() THEN
    RAISE EXCEPTION 'Owner privileges required to create invites';
  END IF;

  IF v_role NOT IN ('member', 'moderator') THEN
    RAISE EXCEPTION 'Invalid target_role';
  END IF;

  IF v_role = 'moderator' THEN
    v_rev := coalesce(p_can_review, false);
    v_edit := coalesce(p_can_edit_tree, false);
    v_brand := coalesce(p_can_access_brand, false);
  END IF;

  SELECT fm.name, coalesce(fm.full_lineage, fm.name)
    INTO v_member_name, v_lineage
  FROM public.family_members fm
  WHERE fm.id = p_member_id
    AND fm.generation >= 1;

  IF v_member_name IS NULL THEN
    RAISE EXCEPTION 'Only descendants (generation >= 1) can be invited';
  END IF;

  SELECT coalesce(au.email, '') INTO v_actor_email FROM auth.users au WHERE au.id = v_uid;

  -- Generate DU-XXXX-XXXX using CSPRNG gen_random_uuid() without requiring pgcrypto
  v_raw_hex := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  FOR v_i IN 1..4 LOOP
    v_idx := (('x' || substr(v_raw_hex, (v_i - 1) * 2 + 1, 2))::bit(8)::int % 32) + 1;
    v_part1 := v_part1 || substr(v_alphabet, v_idx, 1);
    v_idx := (('x' || substr(v_raw_hex, (v_i + 3) * 2 + 1, 2))::bit(8)::int % 32) + 1;
    v_part2 := v_part2 || substr(v_alphabet, v_idx, 1);
  END LOOP;

  v_display_code := 'DU-' || v_part1 || '-' || v_part2;
  v_norm_code := private.normalize_invite_code(v_display_code);
  v_hint := 'DU-****-' || v_part2;
  v_salt := gen_random_uuid()::text;
  v_hash := encode(pg_catalog.sha256(convert_to(v_salt || ':' || v_norm_code, 'utf8')), 'hex');
  v_expires_at := now() + make_interval(days => v_days);

  INSERT INTO public.member_invites (
    member_id, target_role, can_review_requests, can_edit_tree, can_access_brand,
    note, code_hint, code_salt, code_hash, created_by, expires_at
  ) VALUES (
    p_member_id, v_role, v_rev, v_edit, v_brand,
    left(btrim(coalesce(p_note, '')), 250), v_hint, v_salt, v_hash, v_uid, v_expires_at
  )
  RETURNING id INTO v_invite_id;

  PERFORM private.write_invite_audit(
    v_uid,
    v_actor_email,
    'invite_created',
    v_invite_id::text,
    jsonb_build_object(
      'member_id', p_member_id,
      'member_name', v_member_name,
      'target_role', v_role,
      'can_review_requests', v_rev,
      'can_edit_tree', v_edit,
      'can_access_brand', v_brand,
      'code_hint', v_hint,
      'expires_at', v_expires_at
    )
  );

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'member_id', p_member_id,
    'member_name', v_member_name,
    'full_lineage', v_lineage,
    'target_role', v_role,
    'can_review_requests', v_rev,
    'can_edit_tree', v_edit,
    'can_access_brand', v_brand,
    'expires_at', v_expires_at,
    'code_hint', v_hint,
    'temp_password', v_display_code
  );
END;
$$;

-- 6. Owner revokes an active invite
CREATE OR REPLACE FUNCTION public.owner_revoke_member_invite(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_actor_email text := '';
  v_inv public.member_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT private.is_owner() THEN
    RAISE EXCEPTION 'Owner privileges required';
  END IF;

  UPDATE public.member_invites
  SET revoked_at = now()
  WHERE id = p_invite_id
    AND used_at IS NULL
    AND revoked_at IS NULL
  RETURNING * INTO v_inv;

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Active invite not found or already used/revoked';
  END IF;

  SELECT coalesce(au.email, '') INTO v_actor_email FROM auth.users au WHERE au.id = v_uid;

  PERFORM private.write_invite_audit(
    v_uid,
    v_actor_email,
    'invite_revoked',
    v_inv.id::text,
    jsonb_build_object('member_id', v_inv.member_id, 'code_hint', v_inv.code_hint)
  );

  RETURN jsonb_build_object('ok', true, 'invite_id', v_inv.id, 'revoked_at', v_inv.revoked_at);
END;
$$;

-- 7. Preview invite (safe minimal fields for login/signup UI before claiming)
CREATE OR REPLACE FUNCTION public.preview_member_invite(p_temp_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_norm text := private.normalize_invite_code(p_temp_password);
  v_hint text;
  v_inv public.member_invites%ROWTYPE;
  v_rec record;
  v_name text;
  v_lineage text;
BEGIN
  IF length(v_norm) <> 10 OR left(v_norm, 2) <> 'DU' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_format');
  END IF;

  v_hint := 'DU-****-' || right(v_norm, 4);

  FOR v_rec IN
    SELECT *
    FROM public.member_invites mi
    WHERE mi.code_hint = v_hint
    ORDER BY mi.created_at DESC
  LOOP
    IF v_rec.code_hash = encode(pg_catalog.sha256(convert_to(v_rec.code_salt || ':' || v_norm, 'utf8')), 'hex') THEN
      v_inv := v_rec;
      EXIT;
    END IF;
  END LOOP;

  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;
  IF v_inv.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'already_used');
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'revoked');
  END IF;
  IF v_inv.expires_at <= now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  SELECT fm.name, coalesce(fm.full_lineage, fm.name)
    INTO v_name, v_lineage
  FROM public.family_members fm
  WHERE fm.id = v_inv.member_id;

  RETURN jsonb_build_object(
    'valid', true,
    'member_id', v_inv.member_id,
    'member_name', coalesce(v_name, ''),
    'full_lineage', coalesce(v_lineage, ''),
    'target_role', v_inv.target_role,
    'expires_at', v_inv.expires_at
  );
END;
$$;

-- 8. Authenticated user claims one-time invite + saves mandatory mobile phone
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

  -- Invalidate invite immediately (single-use)
  UPDATE public.member_invites
  SET used_at = now(),
      claimed_by = v_uid
  WHERE id = v_inv.id;

  -- Upsert verified tree profile & mobile number
  INSERT INTO public.member_profiles (user_id, member_id, phone, email)
  VALUES (v_uid, v_inv.member_id, v_clean_phone, coalesce(v_email, ''))
  ON CONFLICT (user_id) DO UPDATE SET
    member_id = EXCLUDED.member_id,
    phone = EXCLUDED.phone,
    email = COALESCE(NULLIF(EXCLUDED.email, ''), public.member_profiles.email);

  -- Grant moderator role & scoped permissions if invite targets moderator (never downgrade owner)
  IF v_inv.target_role = 'moderator' THEN
    INSERT INTO public.admins (
      user_id, role, display_name,
      can_review_requests, can_edit_tree, can_access_brand
    ) VALUES (
      v_uid, 'moderator', left(v_member_name, 80),
      v_inv.can_review_requests, v_inv.can_edit_tree, v_inv.can_access_brand
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

-- 9. Owner directory RPCs for #tab-admins (invites + verified members with phone & email)
CREATE OR REPLACE FUNCTION public.owner_list_member_invites()
RETURNS TABLE (
  id uuid,
  member_id text,
  member_name text,
  full_lineage text,
  target_role text,
  can_review_requests boolean,
  can_edit_tree boolean,
  can_access_brand boolean,
  note text,
  code_hint text,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  used_at timestamptz,
  claimed_by uuid,
  claimed_email text
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
    mi.id,
    mi.member_id,
    coalesce(fm.name, ''),
    coalesce(fm.full_lineage, coalesce(fm.name, '')),
    mi.target_role,
    mi.can_review_requests,
    mi.can_edit_tree,
    mi.can_access_brand,
    mi.note,
    mi.code_hint,
    mi.created_at,
    mi.expires_at,
    mi.revoked_at,
    mi.used_at,
    mi.claimed_by,
    coalesce(au.email, '')
  FROM public.member_invites mi
  LEFT JOIN public.family_members fm ON fm.id = mi.member_id
  LEFT JOIN auth.users au ON au.id = mi.claimed_by
  ORDER BY mi.created_at DESC
  LIMIT 150;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_verified_members()
RETURNS TABLE (
  user_id uuid,
  member_id text,
  member_name text,
  full_lineage text,
  phone text,
  email text,
  created_at timestamptz
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
    mp.user_id,
    mp.member_id,
    coalesce(fm.name, ''),
    coalesce(fm.full_lineage, coalesce(fm.name, '')),
    coalesce(mp.phone, ''),
    coalesce(au.email, ''),
    mp.created_at
  FROM public.member_profiles mp
  LEFT JOIN public.family_members fm ON fm.id = mp.member_id
  LEFT JOIN auth.users au ON au.id = mp.user_id
  ORDER BY mp.created_at DESC
  LIMIT 300;
END;
$$;

-- 10. Function execution grants
REVOKE ALL ON FUNCTION public.owner_create_member_invite(text, text, boolean, boolean, boolean, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_create_member_invite(text, text, boolean, boolean, boolean, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_revoke_member_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_revoke_member_invite(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.preview_member_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_member_invite(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_member_invite(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_member_invite(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_list_member_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_member_invites() TO authenticated;

REVOKE ALL ON FUNCTION public.owner_list_verified_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_verified_members() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
