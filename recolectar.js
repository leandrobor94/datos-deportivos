// Recolecta los datos del día (hora de Colombia) y los guarda en
// data/<fecha>/<deporte>.json y data/ultimo/<deporte>.json.
// Uso: node recolectar.js [AAAA-MM-DD] [futbol|beisbol|baloncesto ...]

const fs = require('fs');
const path = require('path');
const { fechaColombia } = require('./src/http');

const DEPORTES = {
  futbol: require('./src/futbol'),
  beisbol: require('./src/beisbol'),
  baloncesto: require('./src/baloncesto'),
};
const DIAS_A_GUARDAR = 10;

async function main() {
  const args = process.argv.slice(2);
  const fecha = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || fechaColombia();
  const elegidos = args.filter((a) => DEPORTES[a]);
  const lista = elegidos.length ? elegidos : Object.keys(DEPORTES);

  const raiz = path.join(__dirname, 'data');
  const dirDia = path.join(raiz, fecha);
  const dirUlt = path.join(raiz, 'ultimo');
  fs.mkdirSync(dirDia, { recursive: true });
  fs.mkdirSync(dirUlt, { recursive: true });

  const estadoPath = path.join(raiz, 'estado.json');
  const estado = fs.existsSync(estadoPath) ? JSON.parse(fs.readFileSync(estadoPath, 'utf8')) : {};

  for (const d of lista) {
    const t0 = Date.now();
    let res;
    try {
      res = await DEPORTES[d].recolectar(fecha);
    } catch (e) {
      res = { fecha, partidos: [], errores: [`fallo general: ${e.message}`] };
    }
    res.generado_utc = new Date().toISOString();
    const texto = JSON.stringify(res, null, 1);
    fs.writeFileSync(path.join(dirDia, `${d}.json`), texto);
    fs.writeFileSync(path.join(dirUlt, `${d}.json`), texto);
    estado[d] = {
      fecha,
      generado_utc: res.generado_utc,
      partidos: res.partidos.length,
      errores: res.errores.length,
      primeros_errores: res.errores.slice(0, 5),
      segundos: Math.round((Date.now() - t0) / 1000),
    };
    console.log(`${d}: ${res.partidos.length} partidos, ${res.errores.length} errores, ${estado[d].segundos}s`);
  }
  fs.writeFileSync(estadoPath, JSON.stringify(estado, null, 1));

  // Rotación: solo los últimos DIAS_A_GUARDAR días.
  const dias = fs.readdirSync(raiz).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  for (const viejo of dias.slice(0, Math.max(0, dias.length - DIAS_A_GUARDAR))) {
    fs.rmSync(path.join(raiz, viejo), { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
