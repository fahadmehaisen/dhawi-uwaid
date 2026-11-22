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
  const IDLE_LIMIT_MS = 30 * 60 * 1000;
  const STORAGE_THEME_KEY = "dhawi_uwaid_theme_v1";
  const PENDING_INVITE_KEY = "dhawi_uwaid_pending_invite";

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
      detectSessionInUrl: false,
      storageKey: "dhawi-uwaid-admin-auth",
    },
  });

  const state = {
    user: null,
    role: null,
    perms: { review: false, edit: false, brand: false },
    members: [],
    byId: new Map(),
    selectedId: null,
    enrollFactorId: null,
    verifyFactorId: null,
    invMemberId: null,
    invMemberName: "",
    lastInvite: null,
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
    "Owner privileges required": "هذا الإجراء مخصّص للمالك فقط.",
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
    if (backupBtn) backupBtn.hidden = viewId !== "view-dash";
  }

  // ---------- Auth flow ----------
  async function tryClaimPendingInvite() {
    let raw = null;
    try { raw = localStorage.getItem(PENDING_INVITE_KEY); } catch (_) {}
    if (!raw) return null;
    try {
      const pending = JSON.parse(raw);
      if (!pending || !pending.code || !pending.phone) return null;
      const { data, error } = await sb.rpc("claim_member_invite", {
        p_temp_password: pending.code,
        p_phone: pending.phone,
      });
      if (!error && data && data.ok) {
        try { localStorage.removeItem(PENDING_INVITE_KEY); } catch (_) {}
        return data;
      }
    } catch (_) {}
    return null;
  }

  async function route() {
    const { data: sess } = await sb.auth.getSession();
    if (!sess.session) {
      state.user = null;
      show("view-login");
      return;
    }
    state.user = sess.session.user;
    $("user-label").textContent = state.user.email || "";

    const claimedPending = await tryClaimPendingInvite();
    if (claimedPending && claimedPending.target_role !== "moderator") {
      status(
        "تم توثيق حسابك باسم «" + (claimedPending.member_name || "") + "» وحفظ رقم جوالك بنجاح! يمكنك التوجه للشجرة العامة لرفع طلبات التعديل.",
        "ok"
      );
    }

    // Check admins table first (admins_read_self policy allows reading own row even at aal1)
    // so non-admin accounts are rejected immediately before MFA QR enrollment.
    const { data: me, error: meErr } = await sb
      .from("admins")
      .select("role, display_name, can_review_requests, can_edit_tree, can_access_brand")
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
    state.perms = {
      review: isOwner || me.can_review_requests === true,
      edit: isOwner || me.can_edit_tree === true,
      brand: isOwner || me.can_access_brand === true,
    };
    const brandTabBtn = $("tab-btn-brand");
    if (brandTabBtn) brandTabBtn.hidden = !state.perms.brand;
    $("user-label").textContent =
      (me.display_name || state.user.email || "") + " — " + (isOwner ? "المالك" : "مشرف");
    show("view-dash");
    await loadMembers();
    await loadRequests();
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

  $("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button");
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: $("login-email").value.trim(),
      password: $("login-password").value,
    });
    btn.disabled = false;
    $("login-password").value = "";
    if (error) {
      status(errText(error), "error");
      return;
    }
    status("");
    await route();
  });

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
    state.members = [];
    state.byId.clear();
    show("view-login");
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
    if (name === "brand" && !state.perms.brand) return;
    for (const t of document.querySelectorAll(".tab")) {
      t.setAttribute("aria-selected", String(t.dataset.tab === name));
    }
    for (const p of ["requests", "members", "brand", "audit", "admins"]) {
      const panel = $("tab-" + p);
      if (panel) panel.hidden = p !== name;
    }
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
    if (r.target_node_id && state.byId.has(r.target_node_id)) {
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
    const autoSupported = ["إضافة مولود جديد", "إضافة ذرية غير مدونة", "تصحيح تهجئة اسم", "إضافة سيرة / توثيق تاريخي"].includes(
      r.request_type
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
      if (autoSupported && r.target_node_id && state.byId.has(r.target_node_id) && state.perms.edit) {
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
          class: autoSupported && r.target_node_id && state.perms.edit ? "btn btn-ghost" : "btn btn-primary",
          text: autoSupported && r.target_node_id && state.perms.edit ? "قبول فقط" : "قبول",
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
    $("rename-form").querySelector("button").disabled = !canEditThisNode;
    $("bio-form").querySelector("button").disabled = !canEditThisNode;
    $("child-form").hidden = !state.perms.edit || m.generation < 1;
    $("delete-btn").disabled = !state.perms.edit || protectedNode || childrenOf(id).length > 0;

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
  };

  async function loadAudit() {
    const [{ data, error }, admins] = await Promise.all([
      sb.from("audit_log").select("*").order("at", { ascending: false }).limit(150),
      sb.from("admins").select("user_id, display_name"),
    ]);
    const names = new Map(((admins && admins.data) || []).map((a) => [a.user_id, a.display_name]));
    const list = $("audit-list");
    clear(list);
    if (error) return list.appendChild(el("p", { class: "muted", text: errText(error) }));
    if (!data.length) return list.appendChild(el("p", { class: "muted empty", text: "السجل فارغ." }));
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
      }
      list.appendChild(
        el("div", { class: "audit-row" }, [
          el("span", { class: "pill " + String(a.action).toLowerCase(), text: ACTION_AR[a.action] || a.action }),
          el("span", { class: "audit-table", text: TABLE_AR[a.table_name] || a.table_name }),
          el("span", { class: "audit-sum", text: summary }),
          el("span", {
            class: "audit-who muted small",
            text: (a.actor ? names.get(a.actor) || "مشرف" : "سكربت المزامنة") + " · " + fmtDate(a.at),
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

  // ---------- Owner Member Invites & Verified Members ----------
  function cleanPhone(raw) {
    return String(raw || "").replace(/[^0-9+]/g, "").slice(0, 24);
  }

  function phoneDigits(raw) {
    return String(raw || "").replace(/\D/g, "");
  }

  async function previewAdminInvite(rawCode) {
    const box = $("adm-inv-preview");
    if (!box) return null;
    const norm = String(rawCode || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (norm.length < 10) {
      box.hidden = true;
      box.textContent = "";
      return null;
    }
    const { data, error } = await sb.rpc("preview_member_invite", { p_temp_password: rawCode });
    if (error || !data || !data.valid) {
      box.hidden = false;
      box.classList.add("is-err");
      const reasonMap = {
        already_used: "هذه الكلمة المؤقتة استُخدمت من قبل.",
        revoked: "هذه الدعوة ملغاة من قِبل المالك.",
        expired: "انتهت صلاحية هذه الدعوة.",
      };
      box.textContent = (data && reasonMap[data.reason]) || "الكلمة المؤقتة غير صحيحة أو لم تعد صالحة.";
      return null;
    }
    box.hidden = false;
    box.classList.remove("is-err");
    const roleLbl = data.target_role === "moderator" ? "مشرف بلوحة الإدارة" : "عضو موثّق بالمنصة";
    box.textContent = "الدعوة باسم: " + (data.full_lineage || data.member_name) + " — الصفة: " + roleLbl;
    return data;
  }

  function bindFirstLoginInviteForm() {
    const toggle = $("admin-invite-toggle");
    const form = $("admin-invite-form");
    const codeInput = $("adm-inv-code");
    if (!toggle || !form || !codeInput) return;

    toggle.addEventListener("click", () => {
      const next = form.hidden;
      form.hidden = !next;
      toggle.setAttribute("aria-expanded", String(next));
      if (next) codeInput.focus();
    });

    let timer = null;
    codeInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => previewAdminInvite(codeInput.value), 260);
    });

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const code = codeInput.value.trim();
      const email = $("adm-inv-email").value.trim();
      const phone = cleanPhone($("adm-inv-phone").value);
      const password = $("adm-inv-password").value;
      const btn = $("adm-inv-submit");

      const preview = await previewAdminInvite(code);
      if (!preview) {
        status("تحقق من صحة الكلمة المؤقتة قبل المتابعة.", "error");
        return;
      }
      if (!email || !email.includes("@")) {
        status("أدخل بريداً إلكترونياً صحيحاً.", "error");
        return;
      }
      if (phoneDigits(phone).length < 8) {
        status("أدخل رقم جوال صحيحاً (إجباري لإتمام التفعيل).", "error");
        return;
      }
      if (!password || password.length < 10) {
        status("كلمة المرور الدائمة يجب أن لا تقل عن ١٠ خانات.", "error");
        return;
      }

      if (btn) btn.disabled = true;
      const { data: signData, error: signErr } = await sb.auth.signUp({
        email,
        password,
        options: { data: { member_id: preview.member_id, phone } },
      });
      $("adm-inv-password").value = "";

      if (signErr) {
        if (btn) btn.disabled = false;
        status(errText(signErr), "error");
        return;
      }

      if (signData && signData.session) {
        const { data: claimData, error: claimErr } = await sb.rpc("claim_member_invite", {
          p_temp_password: code,
          p_phone: phone,
        });
        if (btn) btn.disabled = false;
        if (claimErr) {
          status(errText(claimErr), "error");
          return;
        }
        try { localStorage.removeItem(PENDING_INVITE_KEY); } catch (_) {}
        if (claimData && claimData.target_role !== "moderator") {
          status(
            "تم إعداد حسابك وتوثيق اسمك «" + (claimData.member_name || "") + "» وحفظ رقم جوالك بنجاح! انتقل للشجرة الرئيسية لرفع الطلبات.",
            "ok"
          );
          return;
        }
        status("تم تفعيل حساب الإشراف الخاص بك — أكمل إعداد التحقق الثنائي الآن.", "ok");
        await route();
        return;
      }

      try {
        localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ code, phone, role: preview.target_role }));
      } catch (_) {}
      if (btn) btn.disabled = false;
      form.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      $("login-email").value = email;
      status("تم إنشاء حسابك! افتح بريدك الإلكتروني واضغط رابط التفعيل، ثم سجّل دخولك بكلمة المرور الجديدة لإكمال ربط الحساب والتحقق الثنائي.", "ok");
    });

    const qInvite = new URLSearchParams(window.location.search).get("invite");
    if (qInvite && qInvite.trim()) {
      form.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      codeInput.value = qInvite.trim();
      previewAdminInvite(codeInput.value);
    }
  }

  function inviteShareLink(invite) {
    const base = window.location.origin + window.location.pathname.replace(/admin\.html$/i, "");
    const page = invite.target_role === "moderator" ? "admin.html" : "";
    return base + page + "?invite=" + encodeURIComponent(invite.temp_password);
  }

  function renderInviteSearchDropdown(q) {
    const dd = $("inv-member-dropdown");
    if (!dd) return;
    clear(dd);
    const normQ = normalizeAr(q);
    if (!normQ) {
      dd.hidden = true;
      return;
    }
    const hits = [];
    for (const m of state.members) {
      if (Number(m.generation) < 1) continue;
      const hay = normalizeAr((m.full_lineage || m.name) + " " + (m.branch_name || ""));
      if (hay.includes(normQ)) {
        hits.push(m);
        if (hits.length >= 25) break;
      }
    }
    if (!hits.length) {
      dd.hidden = false;
      dd.appendChild(el("div", { class: "dropdown-item", text: "لا توجد أسماء مطابقة في الشجرة" }));
      return;
    }
    dd.hidden = false;
    for (const m of hits) {
      dd.appendChild(
        el("button", {
          type: "button",
          class: "dropdown-item",
          onclick: () => {
            state.invMemberId = m.id;
            state.invMemberName = m.name;
            $("inv-member-search").value = m.name;
            dd.hidden = true;
            const badge = $("inv-member-selected");
            if (badge) {
              badge.hidden = false;
              badge.textContent = "المختار: " + (m.full_lineage || m.name) + " (" + (m.branch_name || "") + ")";
            }
          },
        }, [
          el("strong", { text: m.name }),
          el("small", { text: m.full_lineage || m.branch_name || "" }),
        ])
      );
    }
  }

  async function copyText(txt, okMsg) {
    try {
      await navigator.clipboard.writeText(txt);
      status(okMsg, "ok");
    } catch (_) {
      status("تعذّر النسخ التلقائي — يمكنك النسخ يدوياً من الصندوق.", "error");
    }
  }

  function bindOwnerInviteControls() {
    const search = $("inv-member-search");
    const roleSel = $("inv-role");
    const permsBox = $("inv-perms-box");
    const createBtn = $("inv-create-btn");
    if (!search || !roleSel || !createBtn) return;

    search.addEventListener("input", async () => {
      if (!state.members.length) {
        const res = await fetchAllMembersAdmin();
        if (res.data) state.members = res.data;
      }
      renderInviteSearchDropdown(search.value);
    });

    document.addEventListener("click", (ev) => {
      const dd = $("inv-member-dropdown");
      if (dd && !ev.target.closest(".inv-search-wrap")) dd.hidden = true;
    });

    roleSel.addEventListener("change", () => {
      if (permsBox) permsBox.hidden = roleSel.value !== "moderator";
    });

    createBtn.addEventListener("click", async () => {
      if (!state.invMemberId) {
        status("اختر اسم العضو من نتائج البحث أولاً.", "error");
        return;
      }
      createBtn.disabled = true;
      const isMod = roleSel.value === "moderator";
      const { data, error } = await sb.rpc("owner_create_member_invite", {
        p_member_id: state.invMemberId,
        p_target_role: roleSel.value,
        p_can_review: isMod ? $("inv-perm-review").checked : false,
        p_can_edit_tree: isMod ? $("inv-perm-tree").checked : false,
        p_can_access_brand: isMod ? $("inv-perm-brand").checked : false,
        p_note: $("inv-note").value.trim(),
        p_expires_days: Number($("inv-expires-days").value || 14),
      });
      createBtn.disabled = false;
      if (error) {
        status(errText(error), "error");
        return;
      }
      state.lastInvite = data;
      const link = inviteShareLink(data);
      $("inv-code-output").textContent = data.temp_password;
      $("inv-link-preview").textContent = link;
      $("inv-result-box").hidden = false;
      $("inv-note").value = "";
      status("تم توليد كلمة المرور المؤقتة للعضو «" + (data.member_name || "") + "».", "ok");
      await loadInvitesAndVerifiedMembers();
    });

    if ($("inv-copy-code-btn")) {
      $("inv-copy-code-btn").addEventListener("click", () => {
        if (state.lastInvite) copyText(state.lastInvite.temp_password, "تم نسخ كلمة المرور المؤقتة.");
      });
    }
    if ($("inv-copy-link-btn")) {
      $("inv-copy-link-btn").addEventListener("click", () => {
        if (state.lastInvite) copyText(inviteShareLink(state.lastInvite), "تم نسخ الرابط المباشر للدعوة.");
      });
    }
    if ($("inv-copy-wa-btn")) {
      $("inv-copy-wa-btn").addEventListener("click", () => {
        if (!state.lastInvite) return;
        const d = state.lastInvite;
        const link = inviteShareLink(d);
        const roleTxt = d.target_role === "moderator" ? "مشرف في منصة شجرة ذوي عويض" : "عضو موثّق في شجرة ذوي عويض";
        const msg =
          "السلام عليكم ورحمة الله وبركاته\n" +
          "أهلاً بك يا " + d.member_name + "\n" +
          "تم إعداد دعوتك الخاصة بصلاحية (" + roleTxt + ").\n\n" +
          "كلمة المرور المؤقتة (لدخول واحد فقط): " + d.temp_password + "\n" +
          "رابط التفعيل المباشر:\n" + link + "\n\n" +
          "عند الدخول سيُطلب منك إجبارياً إدخال بريدك الإلكتروني، ورقم جوالك، وتعيين كلمة مرور خاصة بك.";
        copyText(msg, "تم نسخ رسالة الدعوة للواتساب بنجاح.");
      });
    }
  }

  async function loadInvitesAndVerifiedMembers() {
    const card = $("owner-invite-card");
    if (!card) return;
    if (state.role !== "owner") {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const invList = $("invites-list");
    const verList = $("verified-members-list");
    const [{ data: invites, error: invErr }, { data: verified, error: verErr }] = await Promise.all([
      sb.rpc("owner_list_member_invites"),
      sb.rpc("owner_list_verified_members"),
    ]);

    if (invList) {
      clear(invList);
      if (invErr) invList.appendChild(el("p", { class: "muted", text: errText(invErr) }));
      else if (!invites || !invites.length) invList.appendChild(el("p", { class: "muted empty", text: "لا توجد دعوات صادرة حتى الآن." }));
      else {
        const now = Date.now();
        for (const inv of invites) {
          let stText = "نشطة";
          let stCls = "ok";
          if (inv.used_at) { stText = "مستخدمة"; stCls = "warn"; }
          else if (inv.revoked_at) { stText = "ملغاة"; stCls = "bad"; }
          else if (new Date(inv.expires_at).getTime() <= now) { stText = "منتهية"; stCls = "bad"; }

          const revokeBtn = !inv.used_at && !inv.revoked_at
            ? el("button", {
                type: "button",
                class: "btn btn-danger",
                text: "إلغاء الدعوة",
                onclick: async () => {
                  revokeBtn.disabled = true;
                  const { error: rErr } = await sb.rpc("owner_revoke_member_invite", { p_invite_id: inv.id });
                  revokeBtn.disabled = false;
                  if (rErr) return status(errText(rErr), "error");
                  status("تم إلغاء الدعوة.", "ok");
                  loadInvitesAndVerifiedMembers();
                },
              })
            : null;

          invList.appendChild(
            el("div", { class: "audit-row" }, [
              el("span", { class: "status-badge " + stCls, text: stText }),
              el("strong", { text: inv.full_lineage || inv.member_name }),
              el("span", { class: "pill", text: inv.target_role === "moderator" ? "مشرف" : "عضو" }),
              el("span", { class: "muted small", dir: "ltr", text: inv.code_hint || "" }),
              el("span", { class: "muted small", text: inv.claimed_email ? "فعّلها: " + inv.claimed_email : "تنتهي: " + fmtDate(inv.expires_at) }),
              revokeBtn,
            ])
          );
        }
      }
    }

    if (verList) {
      clear(verList);
      if (verErr) verList.appendChild(el("p", { class: "muted", text: errText(verErr) }));
      else if (!verified || !verified.length) verList.appendChild(el("p", { class: "muted empty", text: "لا يوجد أعضاء موثّقون بعد." }));
      else {
        for (const vm of verified) {
          verList.appendChild(
            el("div", { class: "audit-row" }, [
              el("strong", { text: vm.full_lineage || vm.member_name }),
              el("span", { class: "pill", dir: "ltr", text: vm.phone || "بدون جوال" }),
              el("span", { class: "muted small", dir: "ltr", text: vm.email || "" }),
              el("span", { class: "muted small", text: fmtDate(vm.created_at) }),
            ])
          );
        }
      }
    }
  }

  async function loadAdmins() {
    await loadOwnerSettings();
    await loadInvitesAndVerifiedMembers();
    const { data, error } = await sb.from("admins").select("*").order("created_at");
    const list = $("admins-list");
    clear(list);
    if (error) return list.appendChild(el("p", { class: "muted", text: errText(error) }));
    const isOwner = state.role === "owner";

    for (const a of data) {
      const rowIsOwner = a.role === "owner";
      let permsUi = null;

      if (rowIsOwner || !isOwner) {
        const labels = [];
        if (rowIsOwner || a.can_review_requests === true) labels.push("مراجعة الطلبات");
        if (rowIsOwner || a.can_edit_tree === true) labels.push("تعديل الشجرة");
        if (rowIsOwner || a.can_access_brand === true) labels.push("الهوية والورق الرسمي");
        permsUi = el("div", { class: "perm-wrap" },
          labels.length
            ? labels.map((lbl) => el("span", { class: "pill", text: lbl }))
            : [el("span", { class: "muted small", text: "قراءة فقط" })]
        );
      } else {
        const cbReview = el("input", { type: "checkbox" });
        cbReview.checked = a.can_review_requests === true;
        const cbEdit = el("input", { type: "checkbox" });
        cbEdit.checked = a.can_edit_tree === true;
        const cbBrand = el("input", { type: "checkbox" });
        cbBrand.checked = a.can_access_brand === true;

        const saveBtn = el("button", {
          type: "button",
          class: "btn btn-primary",
          text: "حفظ الصلاحيات",
          onclick: async () => {
            saveBtn.disabled = true;
            const { error: pErr } = await sb.rpc("owner_set_admin_permissions", {
              p_user_id: a.user_id,
              p_can_review: cbReview.checked,
              p_can_edit: cbEdit.checked,
              p_can_brand: cbBrand.checked,
            });
            saveBtn.disabled = false;
            if (pErr) return status(errText(pErr), "error");
            status("تم تحديث صلاحيات المشرف «" + (a.display_name || "") + "».", "ok");
            loadAdmins();
          },
        });

        permsUi = el("div", { class: "perm-wrap" }, [
          el("label", { class: "perm-check" }, [cbReview, "مراجعة الطلبات"]),
          el("label", { class: "perm-check" }, [cbEdit, "تعديل الشجرة"]),
          el("label", { class: "perm-check" }, [cbBrand, "الهوية والورق الرسمي"]),
          saveBtn,
        ]);
      }

      list.appendChild(
        el("div", { class: "audit-row" }, [
          el("span", { class: "pill " + a.role, text: rowIsOwner ? "المالك" : "مشرف" }),
          el("strong", { text: a.display_name || "—" }),
          permsUi,
          el("span", { class: "muted small", text: "منذ " + fmtDate(a.created_at) }),
        ])
      );
    }
  }

  // ---------- Boot ----------
  initAdminTheme();
  bindFirstLoginInviteForm();
  bindOwnerInviteControls();
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") show("view-login");
  });
  route().catch((e) => status(errText(e), "error"));
})();
