# datos-deportivos

Datos prepartido del día (hora de Colombia) para las rutinas de análisis de fútbol,
béisbol y baloncesto que corren en la nube de Claude. GitHub Actions los recolecta
4 veces al día y los deja aquí; las rutinas los leen desde `raw.githubusercontent.com`,
que su red permite aunque bloquee las webs deportivas.

**No incluye cuotas a propósito**: el análisis se hace sin anclarse al mercado.

| Archivo | Fuente | Contenido |
|---|---|---|
| `data/ultimo/futbol.json` | FotMob | Hasta 30 partidos de las ligas principales: tabla general y local/visitante, xG a favor y en contra, estadísticas de equipo (remates a puerta, corners, faltas, tarjetas, posesión), forma, bajas, alineación probable, árbitro con sus promedios, clima, H2H |
| `data/ultimo/beisbol.json` | MLB Stats API | Abridores probables (FIP, K%, BB%, últimas 5 aperturas con lanzamientos), ofensiva contra zurdos y derechos, abridores frente a bullpen, lanzamientos de cada relevista en los últimos 3 días, alineaciones, clima, serie |
| `data/ultimo/baloncesto.json` | ESPN | NBA y WNBA: lesiones, últimos 5, serie de la temporada y rotación de cada equipo con promedios de los últimos 5/10/20 partidos y temporada (min, pts, reb, ast, triples) y los últimos 10 partidos |
| `data/estado.json` | — | Hora de la última recolección y errores por deporte |

`data/AAAA-MM-DD/` guarda los últimos 10 días.

Ejecutar a mano: `node recolectar.js [AAAA-MM-DD] [futbol|beisbol|baloncesto]` (Node 20+, sin dependencias),
o **Actions → Recolectar datos del día → Run workflow**.
