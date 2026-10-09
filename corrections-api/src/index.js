const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const END_ID_RE = /^[A-Z0-9][A-Z0-9._\/-]{1,79}$/;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  if (!allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function normalizeEndId(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, maxLength);
}

function validateCorrection(endId, body) {
  const normalized = normalizeEndId(endId);
  if (!END_ID_RE.test(normalized)) return { error: 'END_ID inválido.' };
  const region = cleanText(body?.regiao, 80);
  const subarea = cleanText(body?.subarea, 120);
  const reason = cleanText(body?.motivo, 240);
  if (!region || !subarea) return { error: 'Região e subárea são obrigatórias.' };
  return { value: { endId: normalized, region, subarea, reason } };
}

async function checkWriteLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const windowStart = Math.floor(Date.now() / 600000) * 600000;
  const limit = Math.max(1, Number(env.MAX_WRITES_PER_10_MINUTES) || 30);
  await env.DB.prepare(`
    INSERT INTO write_limits (client_key, window_start, write_count)
    VALUES (?, ?, 1)
    ON CONFLICT(client_key, window_start)
    DO UPDATE SET write_count = write_count + 1
  `).bind(ip, windowStart).run();
  const row = await env.DB.prepare(
    'SELECT write_count FROM write_limits WHERE client_key = ? AND window_start = ?'
  ).bind(ip, windowStart).first();
  return Number(row?.write_count || 0) <= limit;
}

async function listCorrections(env, headers) {
  const result = await env.DB.prepare(
    'SELECT end_id, region, subarea, reason, updated_at FROM corrections ORDER BY end_id'
  ).all();
  return json({ corrections: result.results || [] }, 200, headers);
}

async function upsertCorrection(request, env, endId, headers) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 4096) return json({ error: 'Conteúdo muito grande.' }, 413, headers);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Conteúdo JSON inválido.' }, 400, headers);
  }
  const checked = validateCorrection(endId, body);
  if (checked.error) return json({ error: checked.error }, 400, headers);
  if (!(await checkWriteLimit(request, env))) {
    return json({ error: 'Muitas alterações em pouco tempo. Aguarde alguns minutos.' }, 429, headers);
  }

  const { endId: id, region, subarea, reason } = checked.value;
  const previous = await env.DB.prepare(
    'SELECT region, subarea FROM corrections WHERE end_id = ?'
  ).bind(id).first();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO corrections (end_id, region, subarea, reason, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(end_id) DO UPDATE SET
        region = excluded.region,
        subarea = excluded.subarea,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `).bind(id, region, subarea, reason, now),
    env.DB.prepare(`
      INSERT INTO correction_history
        (end_id, action, old_region, old_subarea, new_region, new_subarea, reason, created_at)
      VALUES (?, 'UPSERT', ?, ?, ?, ?, ?, ?)
    `).bind(id, previous?.region || null, previous?.subarea || null, region, subarea, reason, now)
  ]);
  return json({ ok: true, correction: { end_id: id, region, subarea, reason, updated_at: now } }, 200, headers);
}

async function deleteCorrection(request, env, endId, headers) {
  const id = normalizeEndId(endId);
  if (!END_ID_RE.test(id)) return json({ error: 'END_ID inválido.' }, 400, headers);
  if (!(await checkWriteLimit(request, env))) {
    return json({ error: 'Muitas alterações em pouco tempo. Aguarde alguns minutos.' }, 429, headers);
  }
  const previous = await env.DB.prepare(
    'SELECT region, subarea, reason FROM corrections WHERE end_id = ?'
  ).bind(id).first();
  if (previous) {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM corrections WHERE end_id = ?').bind(id),
      env.DB.prepare(`
        INSERT INTO correction_history
          (end_id, action, old_region, old_subarea, new_region, new_subarea, reason, created_at)
        VALUES (?, 'DELETE', ?, ?, NULL, NULL, ?, ?)
      `).bind(id, previous.region, previous.subarea, previous.reason || '', now)
    ]);
  }
  return json({ ok: true }, 200, headers);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    const origin = request.headers.get('Origin') || '';
    const originAllowed = allowedOrigins(env).includes(origin);

    if (request.method === 'OPTIONS') {
      return originAllowed ? new Response(null, { status: 204, headers }) : json({ error: 'Origem não permitida.' }, 403);
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, service: 'cci-correcoes' }, 200, headers);
    }
    if (url.pathname === '/api/corrections' && request.method === 'GET') {
      return listCorrections(env, headers);
    }

    const match = url.pathname.match(/^\/api\/corrections\/([^/]+)$/);
    if (match && (request.method === 'PUT' || request.method === 'DELETE')) {
      if (!originAllowed) return json({ error: 'Origem não permitida.' }, 403);
      const endId = decodeURIComponent(match[1]);
      if (request.method === 'PUT') return upsertCorrection(request, env, endId, headers);
      return deleteCorrection(request, env, endId, headers);
    }
    return json({ error: 'Rota não encontrada.' }, 404, headers);
  }
};

export { normalizeEndId, validateCorrection };
