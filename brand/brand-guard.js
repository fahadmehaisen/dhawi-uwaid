/* ==========================================================================
   Dhawi Uwaid — Brand Studio & Official Letterhead Access Guard
   Allows access ONLY to signed-in admins (aal2 MFA) who have:
     role = 'owner' OR can_access_brand = true
   Public visitors are directed to the Admin Login or back to the public tree.
   ========================================================================== */

(function () {
  "use strict";

  const SUPABASE_URL = "https://nmsmbcfnlqvnzfprexbh.supabase.co";
  const SUPABASE_KEY = "sb_publishable_nM7K9SCmR-MkwEkE0o-Azg_aqwxB8G9";
  const STORAGE_KEY = "dhawi-uwaid-auth";
  const LEGACY_STORAGE_KEY = "dhawi-uwaid-admin-auth";

  document.documentElement.style.visibility = "hidden";

  function parseJwtPayload(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) return null;
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function renderDenied() {
    const showBlock = () => {
      while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
      }
      document.body.style.cssText =
        "margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:#F7F0DF;color:#1C1B18;font-family:'Tajawal',sans-serif;direction:rtl;text-align:center;";

      const card = document.createElement("div");
      card.style.cssText =
        "max-width:460px;width:100%;background:#FFFDF8;border:1.5px solid #C59B43;border-radius:16px;padding:28px 24px;box-shadow:0 12px 34px rgba(18,55,42,0.12);";

      const title = document.createElement("h1");
      title.textContent = "مخصّص للمشرفين المخوّلين فقط";
      title.style.cssText =
        "font-family:'Amiri',serif;color:#12372A;font-size:1.6rem;margin:0 0 10px;";

      const desc = document.createElement("p");
      desc.textContent =
        "استوديو الهوية البصرية والورق الرسمي متاح فقط لمالك المنصة وللمشرفين المخوّلين بصلاحية الهوية والورق الرسمي بعد تسجيل الدخول بالتحقق الثنائي.";
      desc.style.cssText = "color:#5A554C;line-height:1.75;margin:0 0 20px;font-size:0.96rem;";

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:10px;justify-content:center;flex-wrap:wrap;";

      const loginLink = document.createElement("a");
      loginLink.href = "../index.html?auth=login&next=admin";
      loginLink.textContent = "بوابة الدخول الموحّدة";
      loginLink.style.cssText =
        "background:#12372A;color:#F8F4EC;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:10px;";

      const homeLink = document.createElement("a");
      homeLink.href = "../index.html";
      homeLink.textContent = "العودة للشجرة العامة";
      homeLink.style.cssText =
        "background:transparent;color:#12372A;border:1px solid rgba(18,55,42,0.3);text-decoration:none;font-weight:700;padding:10px 18px;border-radius:10px;";

      actions.appendChild(loginLink);
      actions.appendChild(homeLink);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(actions);
      document.body.appendChild(card);
      document.documentElement.style.visibility = "visible";
    };

    if (document.body) showBlock();
    else document.addEventListener("DOMContentLoaded", showBlock, { once: true });
  }

  async function verifyAccess() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return renderDenied();
      const parsed = JSON.parse(raw);
      const token = parsed && (parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token));
      if (!token) return renderDenied();

      const claims = parseJwtPayload(token);
      if (!claims || claims.aal !== "aal2" || !claims.sub) return renderDenied();
      if (claims.exp && claims.exp * 1000 < Date.now()) return renderDenied();

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/admins?user_id=eq.${encodeURIComponent(claims.sub)}&select=role,can_access_brand&limit=1`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: "Bearer " + token,
          },
        }
      );
      if (!res.ok) return renderDenied();
      const rows = await res.json();
      const me = Array.isArray(rows) && rows[0];
      if (!me || (me.role !== "owner" && me.can_access_brand !== true)) {
        return renderDenied();
      }

      document.documentElement.style.visibility = "visible";
    } catch (_) {
      renderDenied();
    }
  }

  verifyAccess();
})();
