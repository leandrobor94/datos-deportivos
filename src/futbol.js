// Fútbol desde FotMob: partidos del día de las competiciones relevantes, con
// tabla (general, local/visitante, xG), forma, bajas, alineación probable,
// árbitro, clima, H2H y estadísticas de equipo de la liga. Sin cuotas.

const { intentar, mapLimit, horaColombia, r2 } = require('./http');

const FM = 'https://www.fotmob.com/api/data';

// primaryId de FotMob, en orden de prioridad.
const LIGAS = [
  42, 73, 10216, // Champions, Europa League, Conference
  47, 87, 55, 54, 53, // Premier, LaLiga, Serie A, Bundesliga, Ligue 1
  9806, 9807, 9808, 9809, // Nations League A-D
  45, 299, // Libertadores, Sudamericana
  274, // Primera A Colombia
  112, 268, 230, 130, // Argentina, Brasil, Liga MX, MLS
  57, 61, 48, 64, 40, // Eredivisie, Portugal, Championship, Escocia, Bélgica
];
// Selecciones: eliminatorias, amistosos y torneos internacionales (ccode INT).
const INT_RE = /World Cup|Qualif|Nations|Copa Am|Euro|Gold Cup|Friendl/i;
const MAX_PARTIDOS = 30;

// Estadísticas de equipo de la liga (ficheros de data.fotmob.com).
const STATS_EQUIPO = {
  expected_goals_team: 'xg_total',
  expected_goals_conceded_team: 'xg_concedido_total',
  goals_team_match: 'goles_partido',
  goals_conceded_team_match: 'goles_concedidos_partido',
  ontarget_scoring_att_team: 'remates_puerta_partido',
  big_chance_team: 'grandes_ocasiones_total',
  corner_taken_team: 'corners_total',
  possession_percentage_team: 'posesion',
  fk_foul_lost_team: 'faltas_partido',
  total_yel_card_team: 'amarillas_total',
  touches_in_opp_box_team: 'toques_area_rival',
  clean_sheet_team: 'porterias_cero',
};

function textoInsight(ins) {
  let t = ins.defaultText || ins.text || '';
  (ins.statValues || []).forEach((s, i) => { t = t.replace(`{${i}}`, s.value); });
  return t;
}

function filaTabla(filas, teamId) {
  const f = (filas || []).find((x) => (x.id || x.teamId) === teamId);
  if (!f) return null;
  const o = {
    pos: f.idx || f.position || null, pj: f.played, g: f.wins, e: f.draws, p: f.losses,
    goles: f.scoresStr, pts: f.pts,
  };
  if (f.xg !== undefined) {
    Object.assign(o, {
      xg: r2(f.xg), xg_concedido: r2(f.xgConceded), xpts: r2(f.xPoints),
      xg_por_partido: f.played ? r2(f.xg / f.played) : null,
      xg_concedido_por_partido: f.played ? r2(f.xgConceded / f.played) : null,
    });
    delete o.pos; delete o.g; delete o.e; delete o.p; delete o.goles; delete o.pts;
  }
  return o;
}

async function tablaLiga(leagueId, errores) {
  const d = await intentar(`${FM}/leagues?id=${leagueId}`, errores, 'liga');
  if (!d) return null;
  const tablas = [];
  for (const t of d.table || []) {
    const data = t.data || {};
    if (data.table) tablas.push(data.table);
    for (const sub of data.tables || []) if (sub.table) tablas.push(sub.table);
  }
  // Estadísticas de equipo de la temporada.
  const stats = {};
  const lista = (d.stats && d.stats.teams) || [];
  await mapLimit(lista, 4, async (s) => {
    const url = s.fetchAllUrl || '';
    const clave = Object.keys(STATS_EQUIPO).find((k) => url.endsWith(`/${k}.json`));
    if (!clave) return;
    const f = await intentar(url, errores, 'stat');
    const filas = ((f && f.TopLists && f.TopLists[0] && f.TopLists[0].StatList) || []);
    for (const x of filas) {
      const id = x.TeamId || x.ParticiantId || x.ParticipantId;
      if (!id) continue;
      (stats[id] = stats[id] || {})[STATS_EQUIPO[clave]] = r2(x.StatValue);
      if (x.MatchesPlayed) stats[id].pj_stats = x.MatchesPlayed;
    }
  });
  return { tablas, stats };
}

function equipo(lado, teamId, nombre, md, liga) {
  const c = md.content || {};
  const lu = (c.lineup || {})[lado === 'local' ? 'homeTeam' : 'awayTeam'] || {};
  const formaRaw = ((c.matchFacts || {}).teamForm || [])[lado === 'local' ? 0 : 1] || [];
  const o = {
    id: teamId,
    nombre,
    forma_ult5: formaRaw.map((f) => `${f.resultString} ${f.score || ''} ${(f.tooltipText && (f.tooltipText.homeTeam + '-' + f.tooltipText.awayTeam)) || ''}`.trim()),
    bajas: (lu.unavailable || []).map((p) => ({
      jugador: p.name,
      tipo: p.unavailability && p.unavailability.type,
      regreso: p.unavailability && p.unavailability.expectedReturn,
    })),
    alineacion: lu.starters
      ? { tipo: (c.lineup || {}).lineupType, formacion: lu.formation, titulares: lu.starters.map((p) => p.name) }
      : null,
  };
  if (liga) {
    const [tGen] = liga.tablas;
    if (tGen) {
      o.tabla = filaTabla(tGen.all, teamId);
      o.tabla_como_local_o_visitante = filaTabla(lado === 'local' ? tGen.home : tGen.away, teamId);
      o.xg_temporada = filaTabla(tGen.xg, teamId);
    }
    o.stats_temporada = liga.stats[teamId] || null;
  }
  return o;
}

async function recolectar(fecha) {
  const errores = [];
  const ymd = fecha.replace(/-/g, '');
  // FotMob agrupa por fecha UTC; pedimos hoy y mañana y filtramos por la fecha de Colombia.
  const dias = await Promise.all([ymd, ymdMas(fecha)].map((d) => intentar(`${FM}/matches?date=${d}`, errores, 'calendario')));
  const candidatos = [];
  for (const dia of dias) {
    for (const l of (dia && dia.leagues) || []) {
      const prio = LIGAS.indexOf(l.primaryId);
      const esInt = l.ccode === 'INT' && INT_RE.test(l.name);
      if (prio < 0 && !esInt) continue;
      for (const m of l.matches || []) {
        const utc = m.status && m.status.utcTime;
        if (!utc || horaColombia(utc).slice(0, 10) !== fecha) continue;
        if (m.status.cancelled) continue;
        candidatos.push({ m, l, prio: prio < 0 ? 50 : prio });
      }
    }
  }
  const vistos = new Set();
  const elegidos = candidatos
    .filter(({ m }) => (vistos.has(m.id) ? false : vistos.add(m.id)))
    .sort((a, b) => a.prio - b.prio)
    .slice(0, MAX_PARTIDOS);

  const ligas = {};
  const partidos = await mapLimit(elegidos, 4, async ({ m, l }) => {
    const md = await intentar(`${FM}/matchDetails?matchId=${m.id}`, errores, `partido ${m.id}`);
    const base = {
      id: m.id,
      competicion: `${l.name} (${l.ccode})`,
      inicio_utc: m.status.utcTime,
      inicio_colombia: horaColombia(m.status.utcTime),
      ya_empezo: !!m.status.started,
      local: m.home.longName || m.home.name,
      visitante: m.away.longName || m.away.name,
    };
    if (!md) return base;
    const c = md.content || {};
    const mf = c.matchFacts || {};
    const ib = mf.infoBox || {};
    const leagueId = l.primaryId;
    if (!(leagueId in ligas)) ligas[leagueId] = tablaLiga(leagueId, errores);
    const liga = await ligas[leagueId];
    const h2h = c.h2h || {};
    return {
      ...base,
      ronda: (ib.Tournament && ib.Tournament.roundName) || null,
      estadio: ib.Stadium ? `${ib.Stadium.name}, ${ib.Stadium.city} (${ib.Stadium.surface || '?'})` : null,
      arbitro: ib.Referee
        ? { nombre: ib.Referee.text, stats: Object.fromEntries((ib.Referee.stats || []).map((s) => [s.type, s.value])) }
        : null,
      clima: c.weather
        ? { temp_c: c.weather.temperature, viento_kmh: c.weather.windSpeed, lluvia_prob: c.weather.precipChance, cielo: c.weather.description }
        : null,
      equipos: {
        local: equipo('local', m.home.id, base.local, md, liga),
        visitante: equipo('visitante', m.away.id, base.visitante, md, liga),
      },
      h2h: {
        resumen_local_empates_visitante: h2h.summary || null,
        ultimos: (h2h.matches || [])
          .filter((x) => x.status && x.status.finished)
          .slice(0, 6)
          .map((x) => `${(x.time && x.time.utcTime || '').slice(0, 10)} ${x.home && x.home.name} ${x.status.scoreStr} ${x.away && x.away.name}`),
      },
      datos_curiosos: (mf.insights || []).slice(0, 8).map(textoInsight),
    };
  });

  return { fuente: 'FotMob (fotmob.com)', fecha, partidos, errores };
}

function ymdMas(fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

module.exports = { recolectar };
