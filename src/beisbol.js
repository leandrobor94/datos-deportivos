// Béisbol desde la API oficial de MLB (statsapi.mlb.com): partidos del día,
// abridores con FIP/K%/BB% y últimas salidas, ofensiva contra zurdos y
// derechos, abridores frente a relevistas, carga del bullpen en los últimos
// 3 días, alineaciones y clima. Sin cuotas.

const { json, intentar, mapLimit, horaColombia, sumarDias, num, r2 } = require('./http');

const API = 'https://statsapi.mlb.com/api/v1';
const C_FIP = 3.15; // constante FIP aproximada (la real varía ~3.0-3.2 por temporada)

function entradas(ip) {
  if (ip === undefined || ip === null) return 0;
  const [e, t = '0'] = String(ip).split('.');
  return Number(e) + Number(t) / 3;
}

function derivadas(s) {
  const ip = entradas(s.inningsPitched);
  const bf = num(s.battersFaced);
  const k = num(s.strikeOuts) || 0, bb = num(s.baseOnBalls) || 0, hbp = num(s.hitByPitch) || 0, hr = num(s.homeRuns) || 0;
  return {
    era: num(s.era), whip: num(s.whip), entradas: r2(ip),
    fip: ip ? r2((13 * hr + 3 * (bb + hbp) - 2 * k) / ip + C_FIP) : null,
    k_pct: bf ? r2((100 * k) / bf) : null,
    bb_pct: bf ? r2((100 * bb) / bf) : null,
    k_menos_bb_pct: bf ? r2((100 * (k - bb)) / bf) : null,
    hr_por_9: ip ? r2((9 * hr) / ip) : null,
    bateadores: bf,
  };
}

async function abridor(p, temporada, errores) {
  if (!p) return null;
  const [persona, st] = await Promise.all([
    intentar(`${API}/people/${p.id}`, errores, 'pitcher'),
    intentar(`${API}/people/${p.id}/stats?stats=season,gameLog&group=pitching&season=${temporada}`, errores, 'pitcher stats'),
  ]);
  const tipo = (n) => ((st && st.stats) || []).find((x) => x.type && x.type.displayName === n);
  const temp = tipo('season');
  const log = tipo('gameLog');
  const ultimas = ((log && log.splits) || [])
    .filter((x) => num(x.stat.gamesStarted) > 0)
    .slice(-5)
    .map((x) => ({
      fecha: x.date, rival: x.opponent && x.opponent.name,
      ip: x.stat.inningsPitched, carreras_limpias: num(x.stat.earnedRuns), k: num(x.stat.strikeOuts),
      bb: num(x.stat.baseOnBalls), hr: num(x.stat.homeRuns), lanzamientos: num(x.stat.numberOfPitches),
    }));
  const s = temp && temp.splits[0] ? temp.splits[0].stat : null;
  return {
    nombre: p.fullName,
    mano: persona && persona.people && persona.people[0].pitchHand ? persona.people[0].pitchHand.code : null,
    temporada: s ? { aperturas: num(s.gamesStarted), juegos: num(s.gamesPlayed), ...derivadas(s) } : null,
    ultimas_aperturas: ultimas,
  };
}

async function equipoStats(teamId, temporada, errores) {
  const [bat, pit, tot] = await Promise.all([
    intentar(`${API}/teams/${teamId}/stats?stats=statSplits&group=hitting&season=${temporada}&sitCodes=vl,vr`, errores, 'bateo'),
    intentar(`${API}/teams/${teamId}/stats?stats=statSplits&group=pitching&season=${temporada}&sitCodes=sp,rp`, errores, 'pitcheo'),
    intentar(`${API}/teams/${teamId}/stats?stats=season&group=hitting,pitching&season=${temporada}`, errores, 'temporada'),
  ]);
  const ofensiva = {};
  for (const sp of (bat && bat.stats && bat.stats[0] && bat.stats[0].splits) || []) {
    const s = sp.stat, pa = num(s.plateAppearances);
    ofensiva[sp.split.code === 'vl' ? 'contra_zurdos' : 'contra_derechos'] = {
      ops: num(s.ops), obp: num(s.obp), slg: num(s.slg), avg: num(s.avg), pa,
      k_pct: pa ? r2((100 * num(s.strikeOuts)) / pa) : null,
      bb_pct: pa ? r2((100 * num(s.baseOnBalls)) / pa) : null,
      hr: num(s.homeRuns),
    };
  }
  const pitcheo = {};
  for (const sp of (pit && pit.stats && pit.stats[0] && pit.stats[0].splits) || []) {
    pitcheo[sp.split.code === 'sp' ? 'abridores' : 'bullpen'] = derivadas(sp.stat);
  }
  const temporadaEq = {};
  for (const g of (tot && tot.stats) || []) {
    const s = g.splits && g.splits[0] && g.splits[0].stat;
    if (!s) continue;
    if (g.group.displayName === 'hitting') {
      temporadaEq.carreras_anotadas_por_juego = num(s.gamesPlayed) ? r2(num(s.runs) / num(s.gamesPlayed)) : null;
      temporadaEq.ops = num(s.ops);
    } else {
      temporadaEq.carreras_permitidas_por_juego = num(s.gamesPlayed) ? r2(num(s.runs) / num(s.gamesPlayed)) : null;
      temporadaEq.era_equipo = num(s.era);
    }
  }
  return { temporada: temporadaEq, ofensiva, pitcheo };
}

// Lanzamientos de cada relevista en los 3 días anteriores.
async function cargaBullpen(teamId, fecha, errores) {
  const desde = sumarDias(fecha, -3), hasta = sumarDias(fecha, -1);
  const cal = await intentar(`${API}/schedule?sportId=1&teamId=${teamId}&startDate=${desde}&endDate=${hasta}`, errores, 'bullpen cal');
  const juegos = [];
  for (const d of (cal && cal.dates) || []) for (const g of d.games) if (g.status.abstractGameState === 'Final') juegos.push({ pk: g.gamePk, fecha: d.date });
  const uso = {};
  for (const j of juegos) {
    const bx = await intentar(`${API}/game/${j.pk}/boxscore`, errores, 'boxscore');
    if (!bx) continue;
    const lado = bx.teams.home.team.id === teamId ? bx.teams.home : bx.teams.away;
    lado.pitchers.slice(1).forEach((id) => {
      const pl = lado.players[`ID${id}`];
      const n = pl && pl.stats && pl.stats.pitching && num(pl.stats.pitching.numberOfPitches);
      const nombre = pl ? pl.person.fullName : String(id);
      (uso[nombre] = uso[nombre] || []).push(`${j.fecha}: ${n} lanz.`);
    });
  }
  return { dias: `${desde} a ${hasta}`, juegos: juegos.length, relevistas: uso };
}

async function recolectar(fecha) {
  const errores = [];
  const temporada = fecha.slice(0, 4);
  const cal = await json(`${API}/schedule?sportId=1&date=${fecha}&hydrate=probablePitcher,lineups,weather,venue,team,seriesStatus`);
  const juegos = ((cal.dates && cal.dates[0] && cal.dates[0].games) || []);
  const equiposCache = {};
  const bullpenCache = {};
  const partidos = await mapLimit(juegos, 3, async (g) => {
    const lado = async (k) => {
      const t = g.teams[k];
      const id = t.team.id;
      equiposCache[id] = equiposCache[id] || equipoStats(id, temporada, errores);
      bullpenCache[id] = bullpenCache[id] || cargaBullpen(id, fecha, errores);
      const lineup = (g.lineups && g.lineups[k === 'home' ? 'homePlayers' : 'awayPlayers']) || [];
      return {
        equipo: t.team.name,
        record: t.leagueRecord ? `${t.leagueRecord.wins}-${t.leagueRecord.losses}` : null,
        abridor_probable: await abridor(t.probablePitcher, temporada, errores),
        alineacion_confirmada: lineup.length ? lineup.map((p) => p.fullName) : null,
        stats: await equiposCache[id],
        bullpen_ultimos_3_dias: await bullpenCache[id],
      };
    };
    return {
      id: g.gamePk,
      tipo: g.gameType, // R regular, F/D/L/W postemporada
      serie: g.seriesStatus ? g.seriesStatus.description || g.seriesStatus.result : null,
      inicio_utc: g.gameDate,
      inicio_colombia: horaColombia(g.gameDate),
      estado: g.status.detailedState,
      estadio: g.venue && g.venue.name,
      clima: g.weather && Object.keys(g.weather).length ? g.weather : null,
      visitante: await lado('away'),
      local: await lado('home'),
    };
  });
  return {
    fuente: 'MLB Stats API (statsapi.mlb.com)',
    fecha,
    nota: `FIP calculado con constante aproximada ${C_FIP}. Factores de estadio y umpire no vienen en esta API.`,
    partidos,
    errores,
  };
}

module.exports = { recolectar };
