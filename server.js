// Servidor de la práctica 2: reserva de asientos de cine.
//  - API REST (Express) para el modelo petición-respuesta y el Polling.
//  - WebSockets (Socket.IO) para la comunicación bidireccional en tiempo real.
// Ambos mecanismos usan el mismo estado (lib/cine.js).
'use strict';
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');
const { Cine } = require('./lib/cine');
const { Metricas } = require('./lib/metricas');

function crearServidor({ reservaMs = Number(process.env.RESERVA_MS || 30000) } = {}) {
  const cine = new Cine({ reservaMs });
  const metricas = new Metricas();
  const app = express();
  const servidorHttp = http.createServer(app);
  // Solo se aceptan conexiones WebSocket del mismo origen (evita el secuestro entre sitios). Los clientes sin Origin (pruebas, herramientas) se permiten.
  const mismoOrigen = (origen, host) => { try { return new URL(origen).host === host; } catch { return false; } };
  const io = new Server(servidorHttp, {
    transports: ['websocket'],
    allowRequest: (req, aceptar) => aceptar(null, !req.headers.origin || mismoOrigen(req.headers.origin, req.headers.host)),
  });

  const usuarioValido = (u) => typeof u === 'string' && u.trim().length >= 1 && u.trim().length <= 30 && !/[<>"'&]/.test(u);
  const limpiar = (u) => String(u).trim();

  // ---- Conteo de solicitudes HTTP y bytes transferidos (para la comparación) ----
  app.use((req, res, next) => {
    let bytes = 0;
    const escribir = res.write.bind(res);
    const terminar = res.end.bind(res);
    res.write = (chunk, ...resto) => { if (chunk) bytes += Buffer.byteLength(chunk); return escribir(chunk, ...resto); };
    res.end = (chunk, ...resto) => { if (chunk && typeof chunk !== 'function') bytes += Buffer.byteLength(chunk); return terminar(chunk, ...resto); };
    res.on('finish', () => { if (req.path.startsWith('/api/') && !req.path.startsWith('/api/metricas')) metricas.registrarHttp(req.method, req.path, bytes); });
    next();
  });
  // Las operaciones que cambian el estado exigen JSON (fuerza la comprobación previa del navegador) y el mismo origen.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next();
    if (req.headers.origin && !mismoOrigen(req.headers.origin, req.headers.host)) return res.status(403).json({ ok: false, error: 'Origen no permitido.' });
    if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Se requiere Content-Type: application/json.' });
    next();
  });
  app.use(express.json({ limit: '2kb' }));
  // Interfaz Angular compilada (frontend/dist). Las rutas de la aplicación devuelven index.html.
  const dirInterfaz = path.join(__dirname, 'frontend', 'dist', 'frontend', 'browser');
  app.use(express.static(dirInterfaz));

  // ---- REST ----
  app.get('/api/asientos', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(cine.instantanea());
  });

  app.post('/api/asientos/:id/reservar', (req, res) => {
    if (!usuarioValido(req.body.usuario)) return res.status(400).json({ ok: false, error: 'Nombre de usuario no válido.' });
    const r = cine.reservar(req.params.id, limpiar(req.body.usuario));
    res.status(r.ok ? 200 : 409).json(r);
  });

  app.post('/api/asientos/:id/liberar', (req, res) => {
    if (!usuarioValido(req.body.usuario)) return res.status(400).json({ ok: false, error: 'Nombre de usuario no válido.' });
    const r = cine.liberar(req.params.id, limpiar(req.body.usuario));
    res.status(r.ok ? 200 : 409).json(r);
  });

  app.post('/api/compras', (req, res) => {
    if (!usuarioValido(req.body.usuario)) return res.status(400).json({ ok: false, error: 'Nombre de usuario no válido.' });
    const r = cine.comprar(req.body.asientos, limpiar(req.body.usuario));
    res.status(r.ok ? 201 : 409).json(r);
  });

  app.post('/api/admin/liberar-todo', (req, res) => res.json(cine.liberarTodo()));
  app.post('/api/admin/resetear', (req, res) => { cine.resetear(); res.json({ ok: true }); });

  // Genera un cambio externo (como si otro usuario reservara): sirve para medir la latencia de actualización.
  app.post('/api/simular/reservar', (req, res) => {
    const libres = [...cine.asientos.values()].filter((a) => a.estado === 'disponible');
    if (!libres.length) return res.status(409).json({ ok: false, error: 'No hay asientos disponibles.' });
    const elegido = typeof req.body.id === 'string' && cine.asientos.get(req.body.id)?.estado === 'disponible' ? cine.asientos.get(req.body.id) : libres[Math.floor(Math.random() * libres.length)];
    const r = cine.reservar(elegido.id, 'Cliente externo');
    res.json({ ...r, version: cine.version, ts: cine.ultimoCambio });
  });

  app.get('/api/metricas', (req, res) => res.json({ ...metricas.instantanea(io.engine.clientsCount), resumen: cine.resumen(), version: cine.version }));
  app.post('/api/metricas/reiniciar', (req, res) => { metricas.reiniciar(); res.json({ ok: true }); });

  // ---- WebSockets (Socket.IO) ----
  const emitirATodos = (evento, carga) => {
    metricas.registrarWsEnviado(Buffer.byteLength(JSON.stringify(carga)), io.engine.clientsCount);
    io.emit(evento, carga);
  };
  cine.on('cambio', (c) => emitirATodos('cambio', c));

  io.on('connection', (socket) => {
    metricas.ws.conexiones++;
    let usuario = null;
    const misReservas = new Set(); // asientos reservados desde esta conexión
    const instantanea = cine.instantanea();
    metricas.registrarWsEnviado(Buffer.byteLength(JSON.stringify(instantanea)));
    socket.emit('estado', instantanea);

    const responder = (ack, r) => { if (typeof ack === 'function') ack(r); };
    socket.use((paquete, siguiente) => { metricas.registrarWsRecibido(); siguiente(); });

    socket.on('usuario', (nombre, ack) => {
      if (!usuarioValido(nombre)) return responder(ack, { ok: false, error: 'Nombre de usuario no válido.' });
      usuario = limpiar(nombre);
      responder(ack, { ok: true, usuario });
    });
    socket.on('reserve', (id, ack) => {
      const r = usuario ? cine.reservar(id, usuario) : { ok: false, error: 'Indica tu nombre de usuario.' };
      if (r.ok) misReservas.add(id);
      responder(ack, r);
    });
    socket.on('release', (id, ack) => {
      const r = usuario ? cine.liberar(id, usuario) : { ok: false, error: 'Indica tu nombre de usuario.' };
      if (r.ok) misReservas.delete(id);
      responder(ack, r);
    });
    socket.on('buy', (ids, ack) => {
      const r = usuario ? cine.comprar(ids, usuario) : { ok: false, error: 'Indica tu nombre de usuario.' };
      if (r.ok && Array.isArray(ids)) ids.forEach((id) => misReservas.delete(id));
      responder(ack, r);
    });
    socket.on('admin:liberar-todo', (ack) => responder(ack, cine.liberarTodo()));
    socket.on('admin:resetear', (ack) => { cine.resetear(); responder(ack, { ok: true }); });
    // Al desconectarse, solo se liberan las reservas que esta conexión hizo y que siguen vigentes.
    socket.on('disconnect', () => {
      if (!usuario) return;
      for (const id of misReservas) cine.liberar(id, usuario);
    });
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    res.sendFile(path.join(dirInterfaz, 'index.html'), (error) => { if (error) res.status(404).send('Falta compilar la interfaz: ejecuta npm run build.'); });
  });

  const temporizador = setInterval(() => cine.expirar(), 500);
  temporizador.unref();

  return { app, servidorHttp, io, cine, metricas, cerrar: () => new Promise((r) => { clearInterval(temporizador); io.close(() => r()); }) };
}

function iniciar() {
  const PUERTO = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || '127.0.0.1';
  const servidor = crearServidor();
  servidor.servidorHttp.listen(PUERTO, HOST, () => {
    console.log(`Cine en tiempo real: http://${HOST}:${PUERTO}`);
    console.log('  WebSockets (Socket.IO):  /                REST + Polling:  /polling.html');
    console.log('  Comparación:             /comparar.html   Administrador:   /admin.html');
  });
  return servidor;
}

module.exports = { crearServidor, iniciar };

if (require.main === module) iniciar();
