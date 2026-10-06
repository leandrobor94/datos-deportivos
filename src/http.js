// Peticiones JSON con reintentos, límite de tiempo y concurrencia acotada.
// Node 20+ (fetch global). Sin dependencias.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function json(url, { intentos = 3, timeoutMs = 25000 } = {}) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 404) throw Object.assign(new Error(`404 ${url}`), { final: true });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      ultimo = e;
      if (e.final) break;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
  throw ultimo;
}

// Igual que json() pero devuelve null en vez de lanzar, y anota el fallo.
async function intentar(url, errores, etiqueta) {
  try {
    return await json(url);
  } catch (e) {
    errores.push(`${etiqueta || ''} ${e.message}`.trim());
    return null;
  }
}

// map con como mucho `n` tareas en paralelo, conservando el orden.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(trabajadores);
  return out;
}

// Fecha y hora de Colombia (UTC-5, sin horario de verano).
function fechaColombia(d = new Date()) {
  return new Date(d.getTime() - 5 * 3600e3).toISOString().slice(0, 10);
}
function horaColombia(iso) {
  if (!iso) return null;
  const d = new Date(new Date(iso).getTime() - 5 * 3600e3);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const r2 = (v) => (v === null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

module.exports = { json, intentar, mapLimit, fechaColombia, horaColombia, sumarDias, num, r2, media };
