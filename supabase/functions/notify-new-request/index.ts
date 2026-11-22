// Free instant Telegram notification Edge Function for Dhawi Uwaid
// Reads TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and optional WEBHOOK_SECRET from Deno.env.
// NEVER hardcode secrets in this file.

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
  if (expectedSecret) {
    const provided = req.headers.get("x-webhook-secret") || "";
    if (provided !== expectedSecret) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) {
    return new Response(JSON.stringify({ ok: false, error: "missing_telegram_env" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const rec = body && (body.record || body);
    const msg = [
      "🌿 *طلب تحديث جديد — شجرة ذوي عويض*",
      `• النوع: ${rec.request_type || "-"}`,
      `• الفرع: ${rec.branch_name || "-"}`,
      `• المعني: ${rec.target_person || "-"}`,
      `• الاسم المطلوب: ${rec.new_name || "-"}`,
      `• مقدم الطلب: ${rec.submitter_lineage || rec.submitter_name || "-"}`,
      rec.notes ? `• ملاحظة: ${rec.notes}` : null,
      "https://fahadmehaisen.github.io/dhawi-uwaid/admin.html",
    ]
      .filter(Boolean)
      .join("\n");

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });

    return new Response(JSON.stringify({ ok: tgRes.ok }), {
      status: tgRes.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});
