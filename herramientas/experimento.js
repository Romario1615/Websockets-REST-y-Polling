// Experimento: mismo escenario (10 cambios externos en 30 s) con REST + Polling a distintos intervalos y con WebSocket.
// Resultados: evidencias/experimento.json (carpeta local, no se sube al repositorio).  Uso: node herramientas/experimento.js
'use strict';
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');

const PUERTO = 3199;
const BASE = `http://127.0.0.1:${PUERTO}`;
const RAIZ = path.join(__dirname, '..');
const IDS = ['A1', 'B3', 'C5', 'A8', 'B10', 'C2', 'A4', 'B6', 'C9', 'A6'];
const TIEMPOS = [2.0, 5.5, 8.5, 11.0, 14.5, 17.0, 20.5, 23.0, 26.0, 28.0]; // segundos desde el inicio de cada ejecución
const DURACION = 30;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (ruta, cuerpo = {}) => fetch(BASE + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).then((r) => r.json());
const resumen = (v) => {
  if (!v.length) return { n: 0, media: null, mediana: null, p95: null, min: null, max: null };
  const s = [...v].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (x) => Math.round(x * 10) / 10;
  return { n: s.length, media: r(v.reduce((a, b) => a + b, 0) / v.length), mediana: r(q(0.5)), p95: r(q(0.95)), min: r(s[0]), max: r(s[s.length - 1]) };
};

/** Tamaño real de las cabeceras HTTP de una consulta GET /api/asientos (petición y respuesta). */
function medirCabeceras() {
  return new Promise((resolver) => {
    const peticion = `GET /api/asientos HTTP/1.1\r\nHost: 127.0.0.1:${PUERTO}\r\nConnection: keep-alive\r\nAccept: application/json\r\nCache-Control: no-store\r\nUser-Agent: Mozilla/5.0\r\nAccept-Encoding: gzip, deflate\r\n\r\n`;
    const s = net.createConnection({ host: '127.0.0.1', port: PUERTO }, () => s.write(peticion));
    let datos = '';
    s.on('data', (d) => {
      datos += d.toString();
      const i = datos.indexOf('\r\n\r\n');
      if (i >= 0) { s.destroy(); resolver({ peticion: Buffer.byteLength(peticion), respuesta: i + 4 }); }
    });
  });
}

async function programarEventos(inicio, eventos, con) {
  if (!con) return;
  for (let i = 0; i < IDS.length; i++) {
    setTimeout(async () => {
      const r = await post('/api/simular/reservar', { id: IDS[i] });
      eventos.push({ id: IDS[i], version: r.version, ts: r.ts, tRelativo: (Date.now() - inicio) / 1000 });
    }, TIEMPOS[i] * 1000);
  }
}

async function ejecutarPolling(intervalo, duracion, conEventos) {
  await post('/api/admin/resetear');
  await post('/api/metricas/reiniciar');
  const eventos = [];
  const detectados = new Map();
  const lat = [];
  const c = { solicitudes: 0, bytes: 0, sinCambios: 0, utiles: 0 };
  let version = -1;
  const inicio = Date.now();
  const consultar = async () => {
    const r = await fetch(BASE + '/api/asientos', { cache: 'no-store' });
    const texto = await r.text();
    const ahora = Date.now();
    const d = JSON.parse(texto);
    c.solicitudes++;
    c.bytes += Buffer.byteLength(texto);
    if (d.version === version) c.sinCambios++; else c.utiles++;
    version = d.version;
    for (const e of eventos) if (!detectados.has(e.version) && e.version <= d.version) { detectados.set(e.version, true); lat.push(ahora - e.ts); }
  };
  await consultar();
  const t = setInterval(consultar, intervalo);
  await programarEventos(inicio, eventos, conEventos);
  await pausa(duracion * 1000);
  clearInterval(t);
  await pausa(300);
  const srv = await (await fetch(BASE + '/api/metricas')).json();
  return { cliente: c, eventos: eventos.length, latencias: lat, servidor: srv };
}

async function ejecutarWs(duracion, conEventos) {
  await post('/api/admin/resetear');
  await post('/api/metricas/reiniciar');
  const eventos = [];
  const detectados = new Map();
  const lat = [];
  const pendientes = [];
  const c = { solicitudes: 0, bytes: 0, sinCambios: 0, utiles: 0 };
  const inicio = Date.now();
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  await new Promise((r) => socket.on('connect', r));
  socket.on('estado', (d) => { c.solicitudes++; c.utiles++; c.bytes += Buffer.byteLength(JSON.stringify(d)) + 6; });
  socket.on('cambio', (m) => {
    const ahora = Date.now();
    c.solicitudes++; c.utiles++;
    c.bytes += Buffer.byteLength(JSON.stringify(m)) + 6; // + prefijo de Socket.IO y cabecera del frame WebSocket
    pendientes.push({ version: m.version, ts: m.ts, ahora });
  });
  await programarEventos(inicio, eventos, conEventos);
  await pausa(duracion * 1000);
  for (const p of pendientes) lat.push(p.ahora - p.ts);
  await pausa(300);
  const srv = await (await fetch(BASE + '/api/metricas')).json();
  socket.close();
  return { cliente: c, eventos: eventos.length, latencias: lat, servidor: srv };
}

/** Escalabilidad: N clientes simultáneos durante unos segundos; se mide lo que hace el servidor. */
async function ejecutarEscala(mecanismo, n, duracion) {
  await post('/api/admin/resetear');
  await post('/api/metricas/reiniciar');
  const antes = (await (await fetch(BASE + '/api/metricas')).json()).cpuMs;
  const cierres = [];
  if (mecanismo === 'polling') {
    for (let i = 0; i < n; i++) { const t = setInterval(() => fetch(BASE + '/api/asientos', { cache: 'no-store' }).then((r) => r.text()).catch(() => {}), 1000 + (i % 10) * 7); cierres.push(() => clearInterval(t)); }
  } else {
    for (let i = 0; i < n; i++) { const s = io(BASE, { transports: ['websocket'], forceNew: true }); cierres.push(() => s.close()); }
    await pausa(1500);
  }
  await post('/api/metricas/reiniciar');
  const cpu0 = (await (await fetch(BASE + '/api/metricas')).json()).cpuMs;
  for (let i = 0; i < 5; i++) setTimeout(() => post('/api/simular/reservar', { id: IDS[i] }), (i + 1) * 2000);
  await pausa(duracion * 1000);
  const m = await (await fetch(BASE + '/api/metricas')).json();
  cierres.forEach((f) => f());
  await pausa(500);
  return { mecanismo, clientes: n, duracion, http: m.http, ws: m.ws, cpuMs: m.cpuMs - cpu0, cpuTotalAntes: antes };
}

(async () => {
  const hijo = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: { ...process.env, PORT: String(PUERTO), RESERVA_MS: '120000' }, stdio: 'ignore' });
  await pausa(1200);
  const salida = { fecha_utc: new Date().toISOString(), node: process.version, duracionS: DURACION, tiemposEventosS: TIEMPOS, ejecuciones: [], escala: [] };
  salida.cabeceras = await medirCabeceras();
  const plan = [
    { nombre: 'Polling 0,5 s', mecanismo: 'polling', intervalo: 500, eventos: true },
    { nombre: 'Polling 1 s', mecanismo: 'polling', intervalo: 1000, eventos: true },
    { nombre: 'Polling 2 s', mecanismo: 'polling', intervalo: 2000, eventos: true },
    { nombre: 'Polling 5 s', mecanismo: 'polling', intervalo: 5000, eventos: true },
    { nombre: 'WebSocket', mecanismo: 'ws', eventos: true },
    { nombre: 'Polling 2 s (sin cambios)', mecanismo: 'polling', intervalo: 2000, eventos: false, duracion: 20 },
    { nombre: 'WebSocket (sin cambios)', mecanismo: 'ws', eventos: false, duracion: 20 },
  ];
  for (const p of plan) {
    const duracion = p.duracion || DURACION;
    console.log('Ejecutando:', p.nombre, duracion + ' s');
    const r = p.mecanismo === 'polling' ? await ejecutarPolling(p.intervalo, duracion, p.eventos) : await ejecutarWs(duracion, p.eventos);
    const extra = p.mecanismo === 'polling' ? salida.cabeceras.peticion + salida.cabeceras.respuesta : 0;
    salida.ejecuciones.push({ nombre: p.nombre, mecanismo: p.mecanismo, intervaloMs: p.intervalo || null, duracionS: duracion, conEventos: p.eventos,
      cliente: { ...r.cliente, bytesConCabeceras: r.cliente.bytes + r.cliente.solicitudes * extra }, eventos: r.eventos, latencias: r.latencias, latencia: resumen(r.latencias), servidor: r.servidor });
  }
  for (const n of [10, 50, 100]) for (const m of ['polling', 'ws']) {
    console.log('Escala:', m, n);
    salida.escala.push(await ejecutarEscala(m, n, 12));
  }
  fs.mkdirSync(path.join(RAIZ, 'evidencias'), { recursive: true });
  fs.writeFileSync(path.join(RAIZ, 'evidencias', 'experimento.json'), JSON.stringify(salida, null, 1));
  hijo.kill();
  for (const e of salida.ejecuciones) console.log(e.nombre.padEnd(28), 'solicitudes', String(e.cliente.solicitudes).padStart(4), 'bytes', String(e.cliente.bytes).padStart(7), 'sin cambios', String(e.cliente.sinCambios).padStart(3), 'lat media', e.latencia.media, 'p95', e.latencia.p95, 'max', e.latencia.max);
  process.exit(0);
})();
