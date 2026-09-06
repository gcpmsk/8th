/* SATYAM GOLD — App से customer को WhatsApp message  →  POST /api/wa-send {to, text}
   (Rate Objection का जवाब / कोई भी सूचना)  — env: WA_TOKEN, WA_PHONE_ID */
const J = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
export async function onRequestOptions() { return new Response(null, { status: 204, headers: J }); }
export async function onRequestPost({ request, env }) {
  try {
    const b = await request.json();
    let to = String(b.to || '').replace(/\D/g, ''); if (to.length === 10) to = '91' + to;
    if (!to || !b.text) return new Response(JSON.stringify({ ok: false, error: 'to/text missing' }), { status: 400, headers: J });
    if (!env.WA_TOKEN || !env.WA_PHONE_ID) return new Response(JSON.stringify({ ok: false, error: 'WA_TOKEN / WA_PHONE_ID set नहीं है' }), { status: 500, headers: J });
    const r = await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_ID}/messages`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.WA_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: String(b.text) } })
    });
    const out = await r.json().catch(() => ({}));
    return new Response(JSON.stringify({ ok: r.ok, res: out }), { status: r.ok ? 200 : 502, headers: J });
  } catch (e) { return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500, headers: J }); }
}
