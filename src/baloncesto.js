// Baloncesto desde ESPN (NBA y WNBA): partidos del día, lesiones, últimos
// partidos, serie de la temporada y, por jugador de rotación, promedios en
// los últimos 5/10/20 y en la temporada con minutos. Sin cuotas.

const { intentar, mapLimit, horaColombia, num, r2, media } = require('./http');

const LIGAS = ['nba', 'wnba'];
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball';
const STATS = ['minutes', 'points', 'totalRebounds', 'assists', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'steals', 'blocks'];
const CORTO = { minutes: 'min', points: 'pts', totalRebounds: 'reb', assists: 'ast', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted': 'triples', steals: 'rob', blocks: 'tap' };

function valor(nombre, v) {
  if (v === undefined || v === null || v === '') return null;
  if (nombre.includes('-')) return num(String(v).split('-')[0]);
  return num(v);
}

// Partidos del jugador en orden cronológico, con temporada regular y playoffs.
function partidosJugador(g) {
  const nombres = g.names || [];
  const idx = Object.fromEntries(STATS.map((s) => [s, nombres.indexOf(s)]));
  const out = [];
  for (const st of g.seasonTypes || []) {
    for (const cat of st.categories || []) {
      for (const ev of cat.events || []) {
        const meta = (g.events || {})[ev.eventId] || {};
        const fila = { fecha: (meta.gameDate || '').slice(0, 10), rival: meta.opponent && meta.opponent.abbreviation, tipo: st.displayName };
        for (const s of STATS) fila[CORTO[s]] = idx[s] >= 0 ? valor(s, ev.stats[idx[s]]) : null;
        out.push(fila);
      }
    }
  }
  const vistos = new Set();
  return out
    .filter((f) => (vistos.has(f.fecha + f.rival) ? false : vistos.add(f.fecha + f.rival)))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function promedios(partidos) {
  const o = {};
  for (const [n, sl] of [['ult5', -5], ['ult10', -10], ['ult20', -20], ['temporada', 0]]) {
    const xs = sl ? partidos.slice(sl) : partidos;
    o[n] = { pj: xs.length };
    for (const k of ['min', 'pts', 'reb', 'ast', 'triples']) o[n][k] = r2(media(xs.map((x) => x[k]).filter((v) => v !== null)));
  }
  return o;
}

async function rotacion(liga, teamId, errores) {
  const ros = await intentar(`${SITE}/${liga}/teams/${teamId}/roster`, errores, 'roster');
  const atletas = ((ros && ros.athletes) || []).flatMap((a) => (a.items ? a.items : [a]));
  const jugadores = await mapLimit(atletas, 5, async (a) => {
    const g = await intentar(`${WEB}/${liga}/athletes/${a.id}/gamelog`, errores, `gamelog ${a.displayName}`);
    if (!g) return null;
    const ps = partidosJugador(g);
    if (!ps.length) return null;
    return {
      jugador: a.displayName,
      posicion: a.position && a.position.abbreviation,
      lesion: (a.injuries && a.injuries[0] && a.injuries[0].status) || null,
      promedios: promedios(ps),
      ultimos_10: ps.slice(-10).map((x) => `${x.fecha} vs ${x.rival}: ${x.min}min ${x.pts}p ${x.reb}r ${x.ast}a ${x.triples}t`),
    };
  });
  return jugadores
    .filter(Boolean)
    .filter((j) => (j.promedios.ult10.min || 0) >= 12)
    .sort((a, b) => (b.promedios.ult10.min || 0) - (a.promedios.ult10.min || 0))
    .slice(0, 10);
}

async function recolectarLiga(liga, fecha, errores) {
  const ymd = fecha.replace(/-/g, '');
  const sb = await intentar(`${SITE}/${liga}/scoreboard?dates=${ymd}`, errores, `${liga} calendario`);
  const eventos = ((sb && sb.events) || []);
  return mapLimit(eventos, 2, async (e) => {
    const c = e.competitions[0];
    const lado = (k) => c.competitors.find((x) => x.homeAway === k);
    const sm = await intentar(`${SITE}/${liga}/summary?event=${e.id}`, errores, `${liga} resumen`);
    const equipo = async (k) => {
      const t = lado(k);
      const lesiones = (((sm && sm.injuries) || []).find((x) => x.team && x.team.id === t.team.id) || {}).injuries || [];
      const ult5 = (((sm && sm.lastFiveGames) || []).find((x) => x.team && x.team.id === t.team.id) || {}).events || [];
      return {
        nombre: t.team.displayName,
        record: (t.records || []).map((r) => `${r.name || r.type}: ${r.summary}`),
        lesiones: lesiones.map((i) => `${i.athlete && i.athlete.displayName}: ${i.status}${i.details && i.details.type ? ' (' + i.details.type + ')' : ''}`),
        ultimos_5: ult5.map((x) => `${(x.gameDate || '').slice(0, 10)} ${x.atVs || ''} ${x.opponent && x.opponent.abbreviation} ${x.gameResult || ''} ${x.score || ''}`),
        rotacion: await rotacion(liga, t.team.id, errores),
      };
    };
    return {
      liga: liga.toUpperCase(),
      id: e.id,
      nombre: e.name,
      nota: (c.notes && c.notes[0] && c.notes[0].headline) || (e.season && e.season.slug) || null,
      inicio_utc: e.date,
      inicio_colombia: horaColombia(e.date),
      estado: e.status && e.status.type && e.status.type.description,
      estadio: c.venue && c.venue.fullName,
      serie_temporada: ((sm && sm.seasonseries) || []).map((s) => s.summary || s.description).filter(Boolean),
      visitante: await equipo('away'),
      local: await equipo('home'),
    };
  });
}

async function recolectar(fecha) {
  const errores = [];
  const partidos = [];
  for (const liga of LIGAS) partidos.push(...(await recolectarLiga(liga, fecha, errores)));
  return { fuente: 'ESPN (site.api.espn.com)', fecha, partidos, errores };
}

module.exports = { recolectar };
