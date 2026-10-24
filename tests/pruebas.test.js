// Pruebas automáticas: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: conectar } = require('socket.io-client');
const { crearServidor } = require('../server');

async function iniciar(reservaMs = 30000) {
  const s = crearServidor({ reservaMs });
  await new Promise((r) => s.servidorHttp.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.servidorHttp.address().port;
  const post = (ruta, cuerpo = {}) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const cliente = () => new Promise((resolver, rechazar) => {
    const c = conectar(base, { transports: ['websocket'], forceNew: true });
    c.estadoInicial = new Promise((r) => c.once('estado', r));
    c.on('connect', () => resolver(c));
    c.on('connect_error', rechazar);
  });
  const emitir = (c, evento, carga) => new Promise((r) => c.emit(evento, carga, r));
  const esperar = (c, evento) => new Promise((r) => c.once(evento, r));
  return { s, base, post, cliente, emitir, esperar, cerrar: () => s.cerrar().then(() => new Promise((r) => s.servidorHttp.close(r))) };
}

test('REST: la sala tiene 30 asientos con precios por fila', async () => {
  const t = await iniciar();
  const d = await (await fetch(t.base + '/api/asientos')).json();
  assert.equal(d.asientos.length, 30);
  assert.deepEqual(d.precios, { A: 6, B: 5, C: 4 });
  assert.ok(d.asientos.every((a) => a.estado === 'disponible'));
  await t.cerrar();
});

test('REST: reservar, impedir doble reserva, liberar y comprar', async () => {
  const t = await iniciar();
  assert.equal((await t.post('/api/asientos/A1/reservar', { usuario: 'Ana' })).status, 200);
  const choque = await t.post('/api/asientos/A1/reservar', { usuario: 'Luis' });
  assert.equal(choque.status, 409);
  assert.match((await choque.json()).error, /reservado por Ana/);
  assert.equal((await t.post('/api/asientos/A1/liberar', { usuario: 'Luis' })).status, 409);
  assert.equal((await t.post('/api/asientos/A1/liberar', { usuario: 'Ana' })).status, 200);
  await t.post('/api/asientos/B2/reservar', { usuario: 'Ana' });
  await t.post('/api/asientos/C3/reservar', { usuario: 'Ana' });
  const compra = await t.post('/api/compras', { usuario: 'Ana', asientos: ['B2', 'C3'] });
  assert.equal(compra.status, 201);
  assert.equal((await compra.json()).total, 9);
  assert.equal((await t.post('/api/asientos/B2/reservar', { usuario: 'Luis' })).status, 409);
  await t.cerrar();
});

test('REST: rechaza nombres no válidos y asientos inexistentes', async () => {
  const t = await iniciar();
  assert.equal((await t.post('/api/asientos/A1/reservar', { usuario: '<b>' })).status, 400);
  assert.equal((await t.post('/api/asientos/A1/reservar', {})).status, 400);
  assert.equal((await t.post('/api/asientos/Z9/reservar', { usuario: 'Ana' })).status, 409);
  await t.cerrar();
});

test('REST + Polling: otro cliente ve el cambio solo al consultar de nuevo', async () => {
  const t = await iniciar();
  const antes = await (await fetch(t.base + '/api/asientos')).json();
  await t.post('/api/asientos/A5/reservar', { usuario: 'Ana' });
  const despues = await (await fetch(t.base + '/api/asientos')).json();
  assert.equal(despues.version, antes.version + 1);
  assert.equal(despues.asientos.find((a) => a.id === 'A5').usuario, 'Ana');
  await t.cerrar();
});

test('WebSocket: el servidor envía el cambio sin que el cliente consulte', async () => {
  const t = await iniciar();
  const a = await t.cliente();
  const b = await t.cliente();
  await t.emitir(a, 'usuario', 'Ana');
  const recibido = t.esperar(b, 'cambio');
  const r = await t.emitir(a, 'reserve', 'B4');
  assert.equal(r.ok, true);
  const cambio = await recibido;
  assert.equal(cambio.motivo, 'reservar');
  assert.equal(cambio.asientos[0].id, 'B4');
  assert.equal(cambio.asientos[0].usuario, 'Ana');
  a.close(); b.close();
  await t.cerrar();
});

test('WebSocket: el nuevo cliente recibe el estado actual al conectarse', async () => {
  const t = await iniciar();
  await t.post('/api/asientos/C1/reservar', { usuario: 'Luis' });
  const c = await t.cliente();
  const estado = await c.estadoInicial;
  assert.equal(estado.asientos.find((a) => a.id === 'C1').usuario, 'Luis');
  c.close();
  await t.cerrar();
});

test('WebSocket: reserve, release y buy con confirmación', async () => {
  const t = await iniciar();
  const a = await t.cliente();
  assert.equal((await t.emitir(a, 'reserve', 'A1')).ok, false);
  await t.emitir(a, 'usuario', 'Ana');
  assert.equal((await t.emitir(a, 'reserve', 'A1')).ok, true);
  assert.equal((await t.emitir(a, 'release', 'A1')).ok, true);
  await t.emitir(a, 'reserve', 'A2');
  await t.emitir(a, 'reserve', 'B2');
  const compra = await t.emitir(a, 'buy', ['A2', 'B2']);
  assert.equal(compra.total, 11);
  a.close();
  await t.cerrar();
});

test('La reserva vence y el asiento vuelve a estar disponible', async () => {
  const t = await iniciar(300);
  await t.post('/api/asientos/A9/reservar', { usuario: 'Ana' });
  await new Promise((r) => setTimeout(r, 1200));
  const d = await (await fetch(t.base + '/api/asientos')).json();
  assert.equal(d.asientos.find((x) => x.id === 'A9').estado, 'disponible');
  await t.cerrar();
});

test('Al desconectarse, el cliente libera sus reservas pendientes', async () => {
  const t = await iniciar();
  const a = await t.cliente();
  await t.emitir(a, 'usuario', 'Ana');
  await t.emitir(a, 'reserve', 'C7');
  a.close();
  await new Promise((r) => setTimeout(r, 400));
  const d = await (await fetch(t.base + '/api/asientos')).json();
  assert.equal(d.asientos.find((x) => x.id === 'C7').estado, 'disponible');
  await t.cerrar();
});

test('Administrador: liberar todo y resetear', async () => {
  const t = await iniciar();
  await t.post('/api/asientos/A1/reservar', { usuario: 'Ana' });
  await t.post('/api/asientos/A2/reservar', { usuario: 'Ana' });
  await t.post('/api/compras', { usuario: 'Ana', asientos: ['A2'] });
  const l = await (await t.post('/api/admin/liberar-todo')).json();
  assert.equal(l.liberados, 1);
  await t.post('/api/admin/resetear');
  const d = await (await fetch(t.base + '/api/asientos')).json();
  assert.ok(d.asientos.every((a) => a.estado === 'disponible'));
  await t.cerrar();
});

test('Métricas: cuentan solicitudes HTTP y mensajes WebSocket por separado', async () => {
  const t = await iniciar();
  await t.post('/api/metricas/reiniciar');
  for (let i = 0; i < 5; i++) await fetch(t.base + '/api/asientos');
  const m = await (await fetch(t.base + '/api/metricas')).json();
  assert.equal(m.http.consultasEstado, 5);
  assert.equal(m.ws.mensajesEnviados, 0);
  await t.cerrar();
});

test('Seguridad: las operaciones POST exigen JSON y el mismo origen', async () => {
  const t = await iniciar();
  const sinJson = await fetch(t.base + '/api/admin/resetear', { method: 'POST' });
  assert.equal(sinJson.status, 415);
  const otroOrigen = await fetch(t.base + '/api/admin/resetear', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://sitio-malicioso.example' }, body: '{}' });
  assert.equal(otroOrigen.status, 403);
  const mismo = await fetch(t.base + '/api/admin/resetear', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: t.base }, body: '{}' });
  assert.equal(mismo.status, 200);
  await t.cerrar();
});

test('Seguridad: se rechaza la conexión WebSocket desde otro origen', async () => {
  const t = await iniciar();
  const resultado = await new Promise((resolver) => {
    const c = conectar(t.base, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { Origin: 'http://sitio-malicioso.example' } });
    c.on('connect', () => { c.close(); resolver('conectó'); });
    c.on('connect_error', () => { c.close(); resolver('rechazada'); });
  });
  assert.equal(resultado, 'rechazada');
  await t.cerrar();
});
