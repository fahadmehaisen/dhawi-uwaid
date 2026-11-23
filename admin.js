/* ==========================================================================
   Dhawi Uwaid — Admin panel (static, no build step)
   - Email/password sign-in + mandatory TOTP MFA (aal2)
   - Review public update requests (approve / reject)
   - Edit tree: rename, bio note, add son, delete leaf
   - Read audit log and admins list
   All authorization is enforced in Postgres (RLS + private.is_admin()).
   This page only renders what the database allows. Never uses innerHTML.
   ========================================================================== */

(function () {
  "use strict";

  const SUPABASE_URL = "https://nmsmbcfnlqvnzfprexbh.supabase.co";
  const SUPABASE_KEY = "sb_publishable_nM7K9SCmR-MkwEkE0o-Azg_aqwxB8G9";
  const AUTH_STORAGE_KEY = "dhawi-uwaid-auth";
  const LEGACY_AUTH_KEYS = ["dhawi-uwaid-admin-auth", "dhawi-uwaid-member-auth"];
  const IDLE_LIMIT_MS = 30 * 60 * 1000;
  const STORAGE_THEME_KEY = "dhawi_uwaid_theme_v1";

  function migrateLegacyAuthStorage() {
    try {
      if (localStorage.getItem(AUTH_STORAGE_KEY)) return;
      for (const oldKey of LEGACY_AUTH_KEYS) {
        const val = localStorage.getItem(oldKey);
        if (val) {
          localStorage.setItem(AUTH_STORAGE_KEY, val);
          break;
        }
      }
    } catch (_) {}
  }

  migrateLegacyAuthStorage();

  function applyAdminTheme(theme) {
    const clean = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", clean);
    const btn = document.getElementById("adm-theme-toggle");
    if (btn) btn.textContent = clean === "dark" ? "الوضع الفاتح" : "الوضع الداكن";
    return clean;
  }

  function initAdminTheme() {
    let saved = "light";
    try {
      const raw = localStorage.getItem(STORAGE_THEME_KEY);
      if (raw === "dark" || raw === "light") saved = raw;
    } catch (_) {}
    applyAdminTheme(saved);
    const btn = document.getElementById("adm-theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const next = cur === "dark" ? "light" : "dark";
        applyAdminTheme(next);
        try { localStorage.setItem(STORAGE_THEME_KEY, next); } catch (_) {}
      });
    }
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: AUTH_STORAGE_KEY,
    },
  });

  const state = {
    user: null,
    role: null,
    perms: {
      review: false,
      add: false,
      edit: false,
      del: false,
      brand: false,
      audit: false,
      backup: false,
    },
    members: [],
    byId: new Map(),
    selectedId: null,
    enrollFactorId: null,
    verifyFactorId: null,
    registeredMembers: [],
    migrationMissing: false,
  };

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null) continue;
        if (k === "text") node.textContent = v;
        else if (k === "class") node.className = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  let statusTimer = null;
  function status(msg, kind) {
    const box = $("status");
    box.textContent = msg || "";
    box.className = "adm-status" + (msg ? " show " + (kind || "info") : "");
    clearTimeout(statusTimer);
    if (msg && kind !== "error") statusTimer = setTimeout(() => status(""), 4500);
  }

  const ERROR_AR = {
    "not allowed": "ليست لديك صلاحية لهذا الإجراء. تأكد من تسجيل الدخول بالتحقق الثنائي.",
    "invalid name": "الاسم يجب أن يكون بين حرفين و٦٠ حرفاً.",
    "member not found": "الاسم غير موجود، ربما حُذف. حدّث الصفحة.",
    "parent not found": "الأب غير موجود، ربما حُذف. حدّث الصفحة.",
    "member has children; remove them first": "لا يمكن حذف اسم له أبناء مسجّلون.",
    "member not found or protected": "هذا الاسم محمي أو غير موجود.",
    "cannot add under ancestor column": "لا يمكن الإضافة تحت عمود النسب الأعلى.",
    "cannot add under root or ancestor column": "لا يمكن الإضافة مباشرة تحت الجد الجامع أو عمود النسب الأعلى — أضف تحت أحد الفروع الثمانية.",
    "request not found or already reviewed": "هذا الطلب تمت مراجعته مسبقاً.",
    "unsupported request type for auto apply": "هذا النوع من الطلبات يتطلب تنفيذاً يدوياً ثم القبول.",
    "target node required": "الطلب غير مربوط باسم مرجعي في الشجرة، افتح تبويب الأسماء لتنفيذه يدوياً.",
    "note too long": "الملاحظة أطول من المسموح.",
    "Invalid login credentials": "البريد أو كلمة المرور غير صحيحة.",
    "Invalid TOTP code entered": "رمز التحقق غير صحيح.",
    "Owner privileges required": "هذا الإجراء مخصّص لمدير النظام فقط.",
    "owner account is protected": "حساب مدير النظام محمي ولا يمكن تعديله أو إزالته.",
    "only one system admin account is allowed": "لا يُسمح بأكثر من حساب واحد لمدير النظام.",
    "Temporary password": "تحقق من صحة وحالة كلمة المرور المؤقتة.",
    "A valid mobile phone number": "يرجى إدخال رقم جوال صحيح (٨ إلى ١٦ رقماً).",
    "User already registered": "البريد الإلكتروني مسجّل مسبقاً — سجّل دخولك من النموذج أعلاه لإكمال التفعيل.",
    "Only descendants": "يُسمح فقط باختيار أسماء ذرية عويض من الجيل الأول فأدنى.",
  };

  function errText(err) {
    const m = (err && (err.message || err.error_description)) || String(err || "");
    for (const [k, v] of Object.entries(ERROR_AR)) if (m.includes(k)) return v;
    return "حدث خطأ: " + m;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("ar-SA-u-ca-gregory", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (_) {
      return iso;
    }
  }

  function normalizeAr(s) {
    return String(s || "")
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ---------- Views ----------
  const VIEWS = ["view-login", "view-enroll", "view-verify", "view-denied", "view-dash"];
  function show(viewId) {
    for (const v of VIEWS) $(v).hidden = v !== viewId;
    $("user-box").hidden = viewId === "view-login";
    const backupBtn = $("backup-btn");
    if (backupBtn) backupBtn.hidden = viewId !== "view-dash" || !state.perms.backup;
  }

  function computePerms(me) {
    if (!me) {
      return { review: false, add: false, edit: false, del: false, brand: false, audit: false, backup: false };
    }
    const isOwner = me.role === "owner";
    const hasGranular = typeof me.can_add_members === "boolean";
    return {
      review: isOwner || me.can_review_requests === true,
      add: isOwner || (hasGranular ? me.can_add_members === true : me.can_edit_tree === true),
      edit: isOwner || (hasGranular ? me.can_edit_members === true : me.can_edit_tree === true),
      del: isOwner || (hasGranular ? me.can_delete_members === true : me.can_edit_tree === true),
      brand: isOwner || me.can_access_brand === true,
      audit: isOwner || (typeof me.can_view_audit === "boolean" ? me.can_view_audit === true : true),
      backup: isOwner || me.can_export_backup === true,
    };
  }

  function canAccessTab(name) {
    const p = state.perms;
    if (name === "requests") return Boolean(p.review);
    if (name === "members") return Boolean(p.add || p.edit || p.del);
    if (name === "brand") return Boolean(p.brand);
    if (name === "audit") return Boolean(p.audit);
    if (name === "admins") return state.role === "owner";
    return false;
  }

  function syncDashboardTabsVisibility() {
    const tabNames = ["requests", "members", "brand", "audit", "admins"];
    let firstAllowed = null;
    for (const name of tabNames) {
      const ok = canAccessTab(name);
      const btn = $("tab-btn-" + name);
      if (btn) btn.hidden = !ok;
      if (ok && !firstAllowed) firstAllowed = name;
    }
    const noPerms = $("no-perms-notice");
    if (!firstAllowed) {
      for (const name of tabNames) {
        const panel = $("tab-" + name);
        if (panel) panel.hidden = true;
      }
      if (noPerms) noPerms.hidden = false;
      return null;
    }
    if (noPerms) noPerms.hidden = true;
    return firstAllowed;
  }

  function buildUnifiedPortalLoginUrl() {
    return "./?auth=login&next=admin";
  }

  // ---------- Auth flow ----------
  async function route() {
    const { data: sess } = await sb.auth.getSession();
    if (!sess.session) {
      state.user = null;
      state.role = null;
      const portalUrl = buildUnifiedPortalLoginUrl();
      const linkEl = $("goto-unified-portal-link");
      if (linkEl) linkEl.setAttribute("href", portalUrl);
      show("view-login");
      window.location.replace(portalUrl);
      return;
    }
    state.user = sess.session.user;
    $("user-label").textContent = state.user.email || "";

    // Check admins table first (admins_read_self policy allows reading own row even at aal1)
    // so non-admin accounts are rejected immediately before MFA QR enrollment.
    const { data: me, error: meErr } = await sb
      .from("admins")
      .select("*")
      .eq("user_id", state.user.id)
      .maybeSingle();
    if (meErr) {
      status(errText(meErr), "error");
      return;
    }
    if (!me) {
      state.role = null;
      show("view-denied");
      return;
    }

    const { data: aal, error: aalErr } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalErr) {
      status(errText(aalErr), "error");
      return;
    }

    if (aal.currentLevel !== "aal2") {
      const { data: factors } = await sb.auth.mfa.listFactors();
      const totp = (factors && factors.totp) || [];
      const verified = totp.find((f) => f.status === "verified");
      if (verified) {
        state.verifyFactorId = verified.id;
        show("view-verify");
        $("verify-code").focus();
      } else {
        await startEnroll();
      }
      return;
    }

    state.role = me.role;
    const isOwner = me.role === "owner";
    state.perms = computePerms(me);
    $("user-label").textContent =
      (me.display_name || state.user.email || "") + " — " + (isOwner ? "مدير النظام" : "منسّق");
    show("view-dash");

    const firstTab = syncDashboardTabsVisibility();
    const needsMembers =
      isOwner ||
      state.perms.review ||
      state.perms.add ||
      state.perms.edit ||
      state.perms.del ||
      state.perms.backup;
    if (needsMembers) {
      await loadMembers();
    }
    if (firstTab) {
      selectTab(firstTab);
    }
  }

  async function startEnroll() {
    // Clean up abandoned unverified factors so enroll doesn't fail on duplicates.
    const { data: factors } = await sb.auth.mfa.listFactors();
    for (const f of (factors && factors.all) || []) {
      if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Dhawi Uwaid Admin",
    });
    if (error) {
      status(errText(error), "error");
      return;
    }
    state.enrollFactorId = data.id;
    $("enroll-qr").src = data.totp.qr_code;
    $("enroll-secret").textContent = data.totp.secret;
    show("view-enroll");
    $("enroll-code").focus();
  }

  async function verifyCode(factorId, code) {
    const clean = String(code || "").replace(/\D/g, "");
    if (clean.length !== 6) {
      status("الرمز يجب أن يكون ستة أرقام.", "error");
      return false;
    }
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: clean });
    if (error) {
      status(errText(error), "error");
      return false;
    }
    return true;
  }

  $("enroll-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (await verifyCode(state.enrollFactorId, $("enroll-code").value)) {
      $("enroll-code").value = "";
      status("تم تفعيل التحقق الثنائي.", "ok");
      await route();
    }
  });

  $("verify-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (await verifyCode(state.verifyFactorId, $("verify-code").value)) {
      $("verify-code").value = "";
      status("");
      await route();
    }
  });

  async function logout() {
    await sb.auth.signOut();
    state.role = null;
    state.user = null;
    state.members = [];
    state.byId.clear();
    window.location.replace("./?auth=login");
  }
  $("logout-btn").addEventListener("click", logout);

  async function fetchAllMembersAdmin() {
    const pageSize = 1000;
    const rows = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("family_members")
        .select("id,name,parent_id,generation,branch_name,bio_note,kunyah,is_deceased,full_lineage,tier,sort_order")
        .order("generation", { ascending: true })
        .order("sort_order", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) return { data: null, error };
      rows.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return { data: rows, error: null };
  }

  async function exportBackup() {
    const btn = $("backup-btn");
    if (btn) btn.disabled = true;
    try {
      const [mRes, metaRes, reqRes] = await Promise.all([
        fetchAllMembersAdmin(),
        sb.from("tree_meta").select("*"),
        sb.from("update_requests").select("*").order("created_at", { ascending: false }).limit(2000),
      ]);
      if (mRes.error) throw mRes.error;
      if (metaRes.error) throw metaRes.error;
      if (reqRes.error) throw reqRes.error;

      const today = new Date().toISOString().slice(0, 10);
      const payload = {
        exportedAt: new Date().toISOString(),
        project: "dhawi-uwaid",
        totalMembers: (mRes.data || []).length,
        tree_meta: metaRes.data || [],
        family_members: mRes.data || [],
        update_requests: reqRes.data || [],
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = el("a", {
        href: url,
        download: "نسخة_احتياطية_شجرة_ذوي_عويض_" + today + ".json",
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status("تم تحميل النسخة الاحتياطية الكاملة بنجاح.", "ok");
    } catch (e) {
      status(errText(e), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  if ($("backup-btn")) $("backup-btn").addEventListener("click", exportBackup);

  // Idle auto sign-out
  let lastActive = Date.now();
  for (const evName of ["click", "keydown", "pointermove", "touchstart"]) {
    document.addEventListener(evName, () => (lastActive = Date.now()), { passive: true });
  }
  setInterval(() => {
    if (state.user && Date.now() - lastActive > IDLE_LIMIT_MS) {
      logout();
      status("تم تسجيل الخروج تلقائياً بسبب عدم النشاط.", "info");
    }
  }, 60 * 1000);

  // ---------- Tabs ----------
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  }
  function selectTab(name) {
    if (!canAccessTab(name)) return;
    for (const t of document.querySelectorAll(".tab")) {
      t.setAttribute("aria-selected", String(t.dataset.tab === name));
    }
    for (const p of ["requests", "members", "brand", "audit", "admins"]) {
      const panel = $("tab-" + p);
      if (panel) panel.hidden = p !== name;
    }
    if (name === "requests") loadRequests();
    if (name === "audit") loadAudit();
    if (name === "admins") loadAdmins();
  }

  // ---------- Requests ----------
  const STATUS_AR = { pending: "معلّق", approved: "مقبول", rejected: "مرفوض" };

  async function loadRequests() {
    const filter = $("req-filter").value;
    let q = sb
      .from("update_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter !== "all") q = q.eq("status", filter);
    const [{ data, error }, pending] = await Promise.all([
      q,
      sb.from("update_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    $("pending-count").textContent = String(pending.count || 0);
    const list = $("req-list");
    clear(list);
    if (error) {
      list.appendChild(el("p", { class: "muted", text: errText(error) }));
      return;
    }
    if (!data.length) {
      list.appendChild(el("p", { class: "muted empty", text: "لا توجد طلبات." }));
      return;
    }
    for (const r of data) list.appendChild(renderRequest(r));
  }

  function field(label, value) {
    if (!value) return null;
    return el("div", { class: "field" }, [
      el("span", { class: "field-label", text: label }),
      el("span", { class: "field-value", text: value }),
    ]);
  }

  function renderRequest(r) {
    const card = el("article", { class: "card req " + r.status });
    card.appendChild(
      el("header", { class: "req-head" }, [
        el("strong", { text: r.request_type }),
        el("span", { class: "pill " + r.status, text: STATUS_AR[r.status] || r.status }),
      ])
    );
    card.appendChild(
      el("div", { class: "fields" }, [
        field("الفرع", r.branch_name),
        field("الشخص المعني", r.target_person),
        field("الاسم الجديد أو المطلوب", r.new_name),
        field("هوية مقدم الطلب الموثّقة", r.submitter_lineage || r.submitter_name),
        field("ملاحظات", r.notes),
        field("تاريخ الإرسال", fmtDate(r.created_at)),
        r.reviewed_at ? field("تاريخ المراجعة", fmtDate(r.reviewed_at)) : null,
        field("ملاحظة المراجع", r.review_note),
      ])
    );

    const actions = el("div", { class: "req-actions" });
    const canTouchMembers = state.perms.add || state.perms.edit || state.perms.del;
    if (r.target_node_id && state.byId.has(r.target_node_id) && canTouchMembers) {
      actions.appendChild(
        el("button", {
          type: "button",
          class: "btn btn-ghost",
          text: "فتح الاسم في المحرّر",
          onclick: () => {
            selectTab("members");
            selectMember(r.target_node_id);
          },
        })
      );
    }
    const isAddReq = ["إضافة مولود جديد", "إضافة ذرية غير مدونة"].includes(r.request_type);
    const isEditReq = ["تصحيح تهجئة اسم", "إضافة سيرة / توثيق تاريخي"].includes(r.request_type);
    const autoSupported = isAddReq || isEditReq;
    const canAutoApply = Boolean(
      autoSupported &&
      r.target_node_id &&
      state.byId.has(r.target_node_id) &&
      state.perms.review &&
      ((isAddReq && state.perms.add) || (isEditReq && state.perms.edit))
    );
    if (r.status === "pending" && state.perms.review) {
      const note = el("input", { type: "text", maxlength: "500", placeholder: "ملاحظة للمراجعة (اختياري)" });
      const decide = async (decision) => {
        const verb = decision === "approved" ? "قبول" : "رفض";
        if (!window.confirm("تأكيد " + verb + " هذا الطلب؟")) return;
        const { error } = await sb.rpc("review_request", {
          p_id: r.id,
          p_decision: decision,
          p_note: note.value.trim(),
        });
        if (error) return status(errText(error), "error");
        status("تم " + verb + " الطلب.", "ok");
        loadRequests();
      };
      actions.appendChild(note);
      if (canAutoApply) {
        const targetNode = state.byId.get(r.target_node_id);
        actions.appendChild(
          el("button", {
            type: "button",
            class: "btn btn-primary",
            text: "اعتماد وتنفيذ مباشر",
            onclick: async () => {
              const summary =
                r.request_type === "تصحيح تهجئة اسم"
                  ? "تغيير الاسم من «" + targetNode.name + "» إلى «" + r.new_name + "» وتحديث نسب الذرية"
                  : r.request_type === "إضافة سيرة / توثيق تاريخي"
                  ? "حفظ الملاحظة التوثيقية على «" + targetNode.full_lineage + "»"
                  : "إضافة «" + r.new_name + "» ابناً لـ «" + targetNode.full_lineage + "»";
              if (!window.confirm("تأكيد الاعتماد والتنفيذ الفوري:\n" + summary + "؟")) return;
              const { error } = await sb.rpc("admin_apply_and_approve_request", {
                p_request_id: r.id,
                p_note: note.value.trim(),
              });
              if (error) return status(errText(error), "error");
              status("تم اعتماد الطلب وتنفيذه في الشجرة مباشرة.", "ok");
              await loadMembers();
              await loadRequests();
            },
          })
        );
      }
      actions.appendChild(
        el("button", {
          type: "button",
          class: canAutoApply ? "btn btn-ghost" : "btn btn-primary",
          text: canAutoApply ? "قبول فقط" : "قبول",
          onclick: () => decide("approved"),
        })
      );
      actions.appendChild(
        el("button", { type: "button", class: "btn btn-danger", text: "رفض", onclick: () => decide("rejected") })
      );
    }
    card.appendChild(actions);
    return card;
  }

  $("req-filter").addEventListener("change", loadRequests);
  $("req-refresh").addEventListener("click", loadRequests);

  // ---------- Members ----------
  async function loadMembers() {
    const { data, error } = await fetchAllMembersAdmin();
    if (error) {
      status(errText(error), "error");
      return;
    }
    state.members = data;
    state.byId = new Map(data.map((m) => [m.id, m]));
    for (const m of data) m._norm = normalizeAr(m.full_lineage || m.name);
    if (state.selectedId) selectMember(state.selectedId);
    renderSearch();
  }

  function childrenOf(id) {
    return state.members.filter((m) => m.parent_id === id);
  }

  function renderSearch() {
    const box = $("mem-results");
    clear(box);
    const q = normalizeAr($("mem-search").value);
    if (q.length < 2) {
      box.appendChild(el("p", { class: "muted small", text: "اكتب حرفين على الأقل." }));
      return;
    }
    const hits = state.members.filter((m) => m._norm.startsWith(q) || m._norm.includes(" " + q)).slice(0, 40);
    if (!hits.length) {
      box.appendChild(el("p", { class: "muted small", text: "لا توجد نتائج." }));
      return;
    }
    for (const m of hits) {
      box.appendChild(
        el(
          "button",
          {
            type: "button",
            class: "result" + (m.id === state.selectedId ? " active" : ""),
            onclick: () => selectMember(m.id),
          },
          [
            el("span", { class: "result-name", text: shortLineage(m, 4) }),
            el("span", { class: "result-meta", text: m.branch_name + " · الجيل " + m.generation }),
          ]
        )
      );
    }
  }

  function shortLineage(m, depth) {
    const parts = String(m.full_lineage || m.name).split(" بن ");
    const head = parts.slice(0, depth).join(" بن ");
    return parts.length > depth ? head + " …" : head;
  }

  let searchTimer = null;
  $("mem-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 150);
  });

  function selectMember(id) {
    const m = state.byId.get(id);
    if (!m) return;
    state.selectedId = id;
    $("mem-empty").hidden = true;
    $("mem-form").hidden = false;
    $("mem-lineage").textContent = m.full_lineage || m.name;
    $("mem-meta").textContent =
      "الرمز " + m.id + " · " + m.branch_name + " · الجيل " + m.generation;
    $("mem-name").value = m.name;
    $("mem-bio").value = m.bio_note || "";
    if ($("mem-kunyah")) $("mem-kunyah").value = m.kunyah || "";
    if ($("mem-deceased")) $("mem-deceased").checked = Boolean(m.is_deceased);
    $("child-name").value = "";

    const canEditThisNode = state.perms.edit && (m.generation >= 1 || state.role === "owner");
    const protectedNode = m.generation < 2;
    $("rename-form").hidden = !state.perms.edit;
    $("bio-form").hidden = !state.perms.edit;
    $("rename-form").querySelector("button").disabled = !canEditThisNode;
    $("bio-form").querySelector("button").disabled = !canEditThisNode;
    $("child-form").hidden = !state.perms.add || m.generation < 1;
    const dangerZone = $("mem-danger-zone");
    if (dangerZone) dangerZone.hidden = !state.perms.del;
    $("delete-btn").disabled = !state.perms.del || protectedNode || childrenOf(id).length > 0;

    const kids = childrenOf(id);
    const box = $("mem-children");
    clear(box);
    if (m.parent_id && state.byId.has(m.parent_id)) {
      box.appendChild(
        el("button", {
          type: "button",
          class: "chip parent",
          text: "↑ الأب: " + state.byId.get(m.parent_id).name,
          onclick: () => selectMember(m.parent_id),
        })
      );
    }
    for (const k of kids) {
      box.appendChild(
        el("button", { type: "button", class: "chip", text: k.name, onclick: () => selectMember(k.id) })
      );
    }
    renderSearch();
  }

  async function runAdmin(fn, args, okMsg) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      status(errText(error), "error");
      return { ok: false };
    }
    status(okMsg, "ok");
    await loadMembers();
    return { ok: true, data };
  }

  $("rename-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const m = state.byId.get(state.selectedId);
    const name = $("mem-name").value.trim();
    if (!m || name === m.name) return;
    if (!window.confirm("تغيير الاسم من «" + m.name + "» إلى «" + name + "»؟ سيتم تحديث نسب جميع الذرية.")) return;
    await runAdmin("admin_rename_member", { p_id: m.id, p_name: name }, "تم حفظ الاسم وتحديث النسب.");
  });

  $("bio-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = state.selectedId;
    if (!id) return;
    await runAdmin(
      "admin_set_bio",
      {
        p_id: id,
        p_bio: $("mem-bio").value,
        p_kunyah: $("mem-kunyah") ? $("mem-kunyah").value : "",
        p_is_deceased: $("mem-deceased") ? $("mem-deceased").checked : false,
      },
      "تم حفظ السيرة واللقب."
    );
  });

  $("child-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const parent = state.byId.get(state.selectedId);
    const name = $("child-name").value.trim();
    if (!parent || !name) return;
    if (!window.confirm("إضافة «" + name + "» ابناً لـ «" + parent.name + "»؟")) return;
    const res = await runAdmin(
      "admin_add_child",
      { p_parent_id: parent.id, p_name: name, p_bio: "" },
      "تمت إضافة الاسم."
    );
    if (res.ok && res.data) selectMember(res.data);
  });

  $("delete-btn").addEventListener("click", async () => {
    const m = state.byId.get(state.selectedId);
    if (!m) return;
    const typed = window.prompt(
      "سيتم حذف «" + (m.full_lineage || m.name) + "».\nيبقى نسخة منه في سجل التعديلات.\nللتأكيد اكتب الاسم: " + m.name
    );
    if (typed == null) return;
    if (typed.trim() !== m.name) return status("الاسم المكتوب غير مطابق، لم يتم الحذف.", "error");
    const parentId = m.parent_id;
    const res = await runAdmin("admin_delete_member", { p_id: m.id }, "تم حذف الاسم.");
    if (res.ok) {
      state.selectedId = null;
      if (parentId) selectMember(parentId);
      else {
        $("mem-form").hidden = true;
        $("mem-empty").hidden = false;
      }
    }
  });

  // ---------- Audit ----------
  const ACTION_AR = { INSERT: "إضافة", UPDATE: "تعديل", DELETE: "حذف" };
  const TABLE_AR = {
    family_members: "الأسماء",
    update_requests: "الطلبات",
    member_invites: "دعوات التفعيل",
    admins: "إدارة المنسّقين",
  };

  async function loadAudit() {
    const list = $("audit-list");
    clear(list);

    let data = null;
    let error = null;
    let names = new Map();

    const rpcRes = await sb.rpc("admin_list_audit_log", { p_limit: 150 });
    if (!rpcRes.error && Array.isArray(rpcRes.data)) {
      data = rpcRes.data;
    } else {
      const [logRes, admRes] = await Promise.all([
        sb.from("audit_log").select("*").order("at", { ascending: false }).limit(150),
        sb.from("admins").select("user_id, display_name"),
      ]);
      data = logRes.data || [];
      error = logRes.error;
      names = new Map(((admRes && admRes.data) || []).map((a) => [a.user_id, a.display_name]));
    }

    if (error) return list.appendChild(el("p", { class: "muted", text: errText(error) }));
    if (!data || !data.length) return list.appendChild(el("p", { class: "muted empty", text: "السجل فارغ." }));
    for (const a of data) {
      const o = a.old_data || {};
      const n = a.new_data || {};
      let summary = "";
      if (a.table_name === "family_members") {
        if (a.action === "INSERT") summary = n.full_lineage || n.name;
        else if (a.action === "DELETE") summary = o.full_lineage || o.name;
        else {
          const changes = [];
          if (o.name !== n.name) changes.push("الاسم: " + o.name + " ← " + n.name);
          if ((o.bio_note || "") !== (n.bio_note || "")) changes.push("الملاحظة عُدّلت");
          if (o.tier !== n.tier) changes.push("نوع العقدة تغيّر");
          if (!changes.length && o.full_lineage !== n.full_lineage) changes.push("تحديث النسب");
          summary = (n.name || "") + (changes.length ? " — " + changes.join("، ") : "");
        }
      } else if (a.table_name === "update_requests") {
        summary = (n.request_type || o.request_type || "") + " ← " + (STATUS_AR[n.status] || n.status || "");
      } else if (a.table_name === "member_invites") {
        const evName = n.event === "invite_created" ? "دعوة جديدة" : n.event === "invite_claimed" ? "تم تفعيل الدعوة" : "إلغاء دعوة";
        summary = evName + (n.member_name ? " — " + n.member_name : "") + (n.code_hint ? " (" + n.code_hint + ")" : "");
      } else if (a.table_name === "admins") {
        if (a.action === "INSERT") summary = "تعيين منسّق جديد: " + (n.display_name || a.row_id);
        else if (a.action === "DELETE") summary = "إزالة صلاحية الإشراف عن: " + (o.display_name || a.row_id);
        else summary = "تحديث صلاحيات منسّق: " + (n.display_name || o.display_name || a.row_id);
      }
      const actorLabel = a.actor_name || (a.actor ? names.get(a.actor) || "مشرف" : "سكربت المزامنة");
      list.appendChild(
        el("div", { class: "audit-row" }, [
          el("span", { class: "pill " + String(a.action).toLowerCase(), text: ACTION_AR[a.action] || a.action }),
          el("span", { class: "audit-table", text: TABLE_AR[a.table_name] || a.table_name }),
          el("span", { class: "audit-sum", text: summary }),
          el("span", {
            class: "audit-who muted small",
            text: actorLabel + " · " + fmtDate(a.at),
          }),
        ])
      );
    }
  }
  $("audit-refresh").addEventListener("click", loadAudit);

  // ---------- Admins & Owner Feature Settings ----------
  async function loadOwnerSettings() {
    const card = $("owner-settings-card");
    if (!card) return;
    if (state.role !== "owner") {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const { data, error } = await sb
      .from("tree_meta")
      .select("feature_bios_enabled, feature_require_member_auth, feature_require_member_mfa")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return;
    $("set-bios-enabled").checked = Boolean(data.feature_bios_enabled);
    $("set-req-auth").checked = data.feature_require_member_auth !== false;
    $("set-req-mfa").checked = data.feature_require_member_mfa !== false;
  }

  if ($("save-site-settings-btn")) {
    $("save-site-settings-btn").addEventListener("click", async () => {
      const btn = $("save-site-settings-btn");
      btn.disabled = true;
      const { error } = await sb.rpc("owner_set_site_settings", {
        p_bios_enabled: $("set-bios-enabled").checked,
        p_require_member_auth: $("set-req-auth").checked,
        p_require_member_mfa: $("set-req-mfa").checked,
      });
      btn.disabled = false;
      if (error) return status(errText(error), "error");
      status("تم حفظ إعدادات المنصة وتطبيقها فوراً على الموقع العام.", "ok");
    });
  }

  // ---------- Coordinator Permissions & Registered Members Directory ----------
  const COORD_PERMS = [
    { key: "can_review_requests", arg: "p_can_review", label: "مراجعة واعتماد الطلبات" },
    { key: "can_add_members", arg: "p_can_add", label: "إضافة أسماء وأبناء للشجرة" },
    { key: "can_edit_members", arg: "p_can_edit", label: "تعديل الأسماء والسير" },
    { key: "can_delete_members", arg: "p_can_delete", label: "حذف أسماء من الشجرة" },
    { key: "can_access_brand", arg: "p_can_brand", label: "الهوية والورق الرسمي" },
    { key: "can_view_audit", arg: "p_can_audit", label: "الاطلاع على سجل التعديلات" },
    { key: "can_export_backup", arg: "p_can_backup", label: "تصدير النسخة الاحتياطية" },
  ];

  function makeToggleSwitch(permDef, initialChecked, onChangeCb) {
    const input = el("input", { type: "checkbox" });
    input.checked = Boolean(initialChecked);
    if (onChangeCb) {
      input.addEventListener("change", () => onChangeCb(input));
    }
    const label = el("label", { class: "perm-switch" }, [
      input,
      el("span", { class: "switch-track", "aria-hidden": "true" }),
      el("span", { class: "switch-label", text: permDef.label }),
    ]);
    return { label, input };
  }

  function renderCoordinatorsList() {
    const list = $("admins-list");
    if (!list) return;
    clear(list);

    const rows = state.registeredMembers.filter((m) => m.role === "owner" || m.role === "moderator");
    if (!rows.length) {
      list.appendChild(el("p", { class: "muted empty", text: "لا توجد بيانات مشرفين." }));
      return;
    }

    for (const m of rows) {
      const rowIsOwner = m.role === "owner";
      const displayName = m.display_name || m.member_name || m.email || "—";
      const subParts = [];
      if (m.full_lineage) subParts.push(m.full_lineage);
      if (m.branch_name) subParts.push("فرع " + m.branch_name);
      if (m.phone) subParts.push(m.phone);
      if (m.email) subParts.push(m.email);

      if (rowIsOwner) {
        list.appendChild(
          el("article", { class: "card coord-card is-owner", id: "coord-card-" + m.user_id }, [
            el("div", { class: "coord-head" }, [
              el("div", null, [
                el("div", { class: "coord-title-row" }, [
                  el("span", { class: "pill owner", text: "مدير النظام (حساب وحيد)" }),
                  el("strong", { text: displayName }),
                ]),
                subParts.length ? el("p", { class: "muted small coord-meta", text: subParts.join(" · ") }) : null,
              ]),
              el("span", { class: "muted small", text: m.admin_since ? "منذ " + fmtDate(m.admin_since) : "" }),
            ]),
            el("p", {
              class: "muted small",
              text: "حساب محمي بجميع الصلاحيات الكاملة لإضافة الأسماء وتعديلها وحذفها، واعتماد الطلبات، وإدارة المنسّقين.",
            }),
          ])
        );
        continue;
      }

      const switchesMap = {};
      const grid = el("div", { class: "perm-switch-grid" });

      const saveCurrentSwitches = async (changedPermKey, changedInput) => {
        const prevVal = Boolean(m[changedPermKey]);
        const args = { p_user_id: m.user_id };
        for (const p of COORD_PERMS) {
          switchesMap[p.key].disabled = true;
          args[p.arg] = switchesMap[p.key].checked;
        }
        const fn = state.migrationMissing ? "owner_set_admin_permissions" : "owner_set_coordinator_permissions";
        const payload = state.migrationMissing
          ? {
              p_user_id: m.user_id,
              p_can_review: switchesMap.can_review_requests.checked,
              p_can_edit: switchesMap.can_add_members.checked || switchesMap.can_edit_members.checked,
              p_can_brand: switchesMap.can_access_brand.checked,
            }
          : args;

        const { error: pErr } = await sb.rpc(fn, payload);
        for (const p of COORD_PERMS) {
          switchesMap[p.key].disabled = false;
        }
        if (pErr) {
          changedInput.checked = prevVal;
          status(errText(pErr), "error");
          return;
        }
        for (const p of COORD_PERMS) {
          m[p.key] = switchesMap[p.key].checked;
        }
        status("تم تحديث صلاحية «" + displayName + "» فوراً.", "ok");
      };

      for (const p of COORD_PERMS) {
        const sw = makeToggleSwitch(p, m[p.key] === true, (inp) => saveCurrentSwitches(p.key, inp));
        switchesMap[p.key] = sw.input;
        if (state.migrationMissing && !["can_review_requests", "can_add_members", "can_edit_members", "can_access_brand"].includes(p.key)) {
          sw.input.disabled = true;
        }
        grid.appendChild(sw.label);
      }

      const removeBtn = el("button", {
        type: "button",
        class: "btn btn-ghost btn-danger-outline",
        text: "إزالة الإشراف",
        disabled: state.migrationMissing ? "disabled" : null,
        onclick: async () => {
          if (!window.confirm("إزالة صفة المنسّق عن «" + displayName + "»؟ سيبقى حسابه كعضو عادي في الشجرة.")) return;
          removeBtn.disabled = true;
          const { error: rErr } = await sb.rpc("owner_remove_coordinator", { p_user_id: m.user_id });
          removeBtn.disabled = false;
          if (rErr) return status(errText(rErr), "error");
          status("تمت إزالة صلاحية الإشراف عن «" + displayName + "».", "ok");
          await loadAdmins();
        },
      });

      list.appendChild(
        el("article", { class: "card coord-card", id: "coord-card-" + m.user_id }, [
          el("div", { class: "coord-head" }, [
            el("div", null, [
              el("div", { class: "coord-title-row" }, [
                el("span", { class: "pill", text: "منسّق" }),
                el("strong", { text: displayName }),
              ]),
              subParts.length ? el("p", { class: "muted small coord-meta", text: subParts.join(" · ") }) : null,
            ]),
            el("div", { class: "coord-head-actions" }, [
              el("span", { class: "muted small", text: m.admin_since ? "منذ " + fmtDate(m.admin_since) : "" }),
              removeBtn,
            ]),
          ]),
          grid,
        ])
      );
    }
  }

  function renderRegisteredMembers() {
    const card = $("promote-member-card");
    const list = $("registered-members-list");
    const countEl = $("reg-members-count");
    if (!card || !list) return;

    if (state.role !== "owner") {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    clear(list);

    const q = normalizeAr($("reg-member-search") ? $("reg-member-search").value : "");
    const filterVal = $("reg-member-filter") ? $("reg-member-filter").value : "all";

    const filtered = state.registeredMembers.filter((m) => {
      if (filterVal === "member" && m.role !== "member") return false;
      if (filterVal === "moderator" && m.role !== "moderator") return false;
      if (!q) return true;
      const hay = normalizeAr(
        [m.member_name, m.full_lineage, m.branch_name, m.display_name, m.phone, m.email].filter(Boolean).join(" ")
      );
      return hay.includes(q);
    });

    if (countEl) countEl.textContent = String(filtered.length);

    if (!filtered.length) {
      list.appendChild(el("p", { class: "muted empty", text: "لا يوجد أعضاء مطابقون لبحثك." }));
      return;
    }

    for (const m of filtered) {
      const displayName = m.full_lineage || m.member_name || m.display_name || m.email || "عضو مسجّل";
      const metaBits = [];
      if (m.branch_name) metaBits.push("فرع " + m.branch_name);
      if (m.phone) metaBits.push(m.phone);
      if (m.email) metaBits.push(m.email);
      if (m.registered_at) metaBits.push("سجّل: " + fmtDate(m.registered_at));

      if (m.role === "owner") {
        list.appendChild(
          el("div", { class: "reg-row" }, [
            el("div", { class: "reg-info" }, [
              el("strong", { text: displayName }),
              el("div", { class: "muted small", text: metaBits.join(" · ") }),
            ]),
            el("div", { class: "reg-actions" }, [
              el("span", { class: "pill owner", text: "مدير النظام (حساب وحيد)" }),
            ]),
          ])
        );
        continue;
      }

      if (m.role === "moderator") {
        list.appendChild(
          el("div", { class: "reg-row" }, [
            el("div", { class: "reg-info" }, [
              el("strong", { text: displayName }),
              el("div", { class: "muted small", text: metaBits.join(" · ") }),
            ]),
            el("div", { class: "reg-actions" }, [
              el("span", { class: "pill", text: "منسّق حالياً" }),
              el("button", {
                type: "button",
                class: "btn btn-ghost",
                text: "إدارة الصلاحيات ↑",
                onclick: () => {
                  const targetCard = $("coord-card-" + m.user_id);
                  if (targetCard) targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
                },
              }),
            ]),
          ])
        );
        continue;
      }

      const drawer = el("div", { class: "promote-drawer", hidden: "" });
      const drawerInputs = {};
      const drawerGrid = el("div", { class: "perm-switch-grid" });
      for (const p of COORD_PERMS) {
        const sw = makeToggleSwitch(p, p.key === "can_review_requests");
        drawerInputs[p.key] = sw.input;
        drawerGrid.appendChild(sw.label);
      }
      const confirmBtn = el("button", {
        type: "button",
        class: "btn btn-primary",
        text: "تأكيد التعيين كمنسّق",
        onclick: async () => {
          confirmBtn.disabled = true;
          const shortDisplay = m.full_lineage
            ? m.full_lineage.split(" بن ").slice(0, 2).join(" بن ")
            : (m.member_name || m.email || "");
          const { error: prErr } = await sb.rpc("owner_promote_member_to_coordinator", {
            p_user_id: m.user_id,
            p_display_name: shortDisplay,
            p_can_review: drawerInputs.can_review_requests.checked,
            p_can_add: drawerInputs.can_add_members.checked,
            p_can_edit: drawerInputs.can_edit_members.checked,
            p_can_delete: drawerInputs.can_delete_members.checked,
            p_can_brand: drawerInputs.can_access_brand.checked,
            p_can_audit: drawerInputs.can_view_audit.checked,
            p_can_backup: drawerInputs.can_export_backup.checked,
          });
          confirmBtn.disabled = false;
          if (prErr) return status(errText(prErr), "error");
          status("تم تعيين «" + (m.member_name || shortDisplay) + "» كمنسّق وتفعيل صلاحياته المختارة.", "ok");
          await loadAdmins();
        },
      });
      const cancelBtn = el("button", {
        type: "button",
        class: "btn btn-ghost",
        text: "إلغاء",
        onclick: () => { drawer.hidden = true; },
      });
      drawer.appendChild(el("p", { class: "muted small", text: "اختر المزايا التي تريد تشغيلها لهذا المنسّق:" }));
      drawer.appendChild(drawerGrid);
      drawer.appendChild(el("div", { class: "row-actions inv-actions-row" }, [confirmBtn, cancelBtn]));

      const promoteBtn = el("button", {
        type: "button",
        class: "btn btn-primary",
        text: "تعيين كمنسّق / مشرف",
        disabled: state.migrationMissing ? "disabled" : null,
        onclick: () => {
          drawer.hidden = !drawer.hidden;
        },
      });

      list.appendChild(
        el("div", { class: "reg-row-wrap" }, [
          el("div", { class: "reg-row" }, [
            el("div", { class: "reg-info" }, [
              el("strong", { text: displayName }),
              el("div", { class: "muted small", text: metaBits.join(" · ") }),
            ]),
            el("div", { class: "reg-actions" }, [
              el("span", { class: "pill member", text: "عضو مسجّل" }),
              promoteBtn,
            ]),
          ]),
          drawer,
        ])
      );
    }
  }

  function bindOwnerMemberDirectoryControls() {
    const searchEl = $("reg-member-search");
    const filterEl = $("reg-member-filter");
    if (searchEl) searchEl.addEventListener("input", renderRegisteredMembers);
    if (filterEl) filterEl.addEventListener("change", renderRegisteredMembers);
  }

  async function loadAdmins() {
    if (state.role !== "owner") return;
    await loadOwnerSettings();

    const warnBox = $("migration-warning");
    const { data: regData, error: regErr } = await sb.rpc("owner_list_registered_members");

    if (!regErr && Array.isArray(regData)) {
      state.migrationMissing = false;
      if (warnBox) warnBox.hidden = true;
      state.registeredMembers = regData;
      renderCoordinatorsList();
      renderRegisteredMembers();
      return;
    }

    // Graceful fallback if migration 4 has not been executed yet in Supabase
    const isMissingRpc =
      regErr && (regErr.code === "PGRST202" || /Could not find|does not exist/i.test(regErr.message || ""));
    state.migrationMissing = Boolean(isMissingRpc);
    if (warnBox) warnBox.hidden = !state.migrationMissing;
    if (regErr && !isMissingRpc) {
      status(errText(regErr), "error");
    }

    const [{ data: admData }, { data: verData }] = await Promise.all([
      sb.from("admins").select("*").order("created_at"),
      sb.rpc("owner_list_verified_members"),
    ]);

    const combined = [];
    const seen = new Set();
    for (const a of admData || []) {
      seen.add(a.user_id);
      combined.push({
        user_id: a.user_id,
        role: a.role,
        display_name: a.display_name,
        can_review_requests: a.can_review_requests === true,
        can_add_members: a.can_edit_tree === true,
        can_edit_members: a.can_edit_tree === true,
        can_delete_members: a.can_edit_tree === true,
        can_access_brand: a.can_access_brand === true,
        can_view_audit: true,
        can_export_backup: a.role === "owner",
        admin_since: a.created_at,
      });
    }
    for (const v of verData || []) {
      if (seen.has(v.user_id)) continue;
      combined.push({
        user_id: v.user_id,
        role: "member",
        member_id: v.member_id,
        member_name: v.member_name,
        full_lineage: v.full_lineage,
        phone: v.phone,
        email: v.email,
        registered_at: v.created_at,
      });
    }
    state.registeredMembers = combined;
    renderCoordinatorsList();
    renderRegisteredMembers();
  }

  // ---------- Boot ----------
  initAdminTheme();
  bindOwnerMemberDirectoryControls();
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      window.location.replace("./?auth=login");
    }
  });
  route().catch((e) => status(errText(e), "error"));
})();
