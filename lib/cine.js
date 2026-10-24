// Dominio de la práctica: sala de cine con 30 asientos (filas A, B y C).
// Tanto la interfaz REST + Polling como la de WebSockets leen y modifican este mismo estado.
'use strict';
const { EventEmitter } = require('node:events');

const FILAS = ['A', 'B', 'C'];
const POR_FILA = 10;
const PRECIOS = { A: 6, B: 5, C: 4 };

class Cine extends EventEmitter {
  constructor({ reservaMs = 30000, reloj = Date.now } = {}) {
    super();
    this.reservaMs = reservaMs;
    this.reloj = reloj;
    this.resetear(false);
  }

  /** Vuelve al estado inicial: 30 asientos disponibles. */
  resetear(avisar = true) {
    this.asientos = new Map();
    for (const fila of FILAS) {
      for (let n = 1; n <= POR_FILA; n++) {
        this.asientos.set(fila + n, { id: fila + n, fila, numero: n, precio: PRECIOS[fila], estado: 'disponible', usuario: null, hasta: null });
      }
    }
    this.version = 0;
    this.ultimoCambio = this.reloj();
    if (avisar) this._cambio('reset', [...this.asientos.values()]);
  }

  /** Copia del estado completo. `ts` es el instante del último cambio (sirve para medir la latencia). */
  instantanea() {
    return { version: this.version, ts: this.ultimoCambio, ahora: this.reloj(), reservaMs: this.reservaMs, precios: PRECIOS, asientos: [...this.asientos.values()].map((a) => ({ ...a })) };
  }

  resumen() {
    const r = { disponibles: 0, reservados: 0, vendidos: 0 };
    for (const a of this.asientos.values()) r[a.estado === 'disponible' ? 'disponibles' : a.estado === 'reservado' ? 'reservados' : 'vendidos']++;
    return r;
  }

  reservar(id, usuario) {
    const a = this.asientos.get(id);
    if (!a) return { ok: false, error: 'El asiento no existe.' };
    if (!usuario) return { ok: false, error: 'Indica tu nombre de usuario.' };
    if (a.estado === 'vendido') return { ok: false, error: 'El asiento ya fue vendido.' };
    if (a.estado === 'reservado' && a.usuario !== usuario) return { ok: false, error: 'El asiento está reservado por ' + a.usuario + '.' };
    a.estado = 'reservado';
    a.usuario = usuario;
    a.hasta = this.reloj() + this.reservaMs;
    this._cambio('reservar', [a]);
    return { ok: true, asiento: { ...a } };
  }

  liberar(id, usuario) {
    const a = this.asientos.get(id);
    if (!a) return { ok: false, error: 'El asiento no existe.' };
    if (a.estado !== 'reservado') return { ok: false, error: 'El asiento no está reservado.' };
    if (a.usuario !== usuario) return { ok: false, error: 'Solo ' + a.usuario + ' puede liberar este asiento.' };
    this._liberar(a);
    this._cambio('liberar', [a]);
    return { ok: true, asiento: { ...a } };
  }

  /** Confirma la compra de uno o más asientos reservados por el mismo usuario. */
  comprar(ids, usuario) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 30) return { ok: false, error: 'Selecciona al menos un asiento.' };
    const lista = [];
    for (const id of ids) {
      const a = this.asientos.get(id);
      if (!a || a.estado !== 'reservado' || a.usuario !== usuario) return { ok: false, error: 'El asiento ' + id + ' no está reservado por ti.' };
      lista.push(a);
    }
    let total = 0;
    for (const a of lista) {
      a.estado = 'vendido';
      a.hasta = null;
      total += a.precio;
    }
    this._cambio('comprar', lista);
    return { ok: true, total, asientos: lista.map((a) => ({ ...a })) };
  }

  liberarTodo() {
    const afectados = [];
    for (const a of this.asientos.values()) {
      if (a.estado === 'reservado') { this._liberar(a); afectados.push(a); }
    }
    if (afectados.length) this._cambio('liberar-todo', afectados);
    return { ok: true, liberados: afectados.length };
  }

  /** Libera las reservas vencidas. Se invoca periódicamente desde el servidor. */
  expirar() {
    const ahora = this.reloj();
    const vencidos = [];
    for (const a of this.asientos.values()) {
      if (a.estado === 'reservado' && a.hasta !== null && a.hasta <= ahora) { this._liberar(a); vencidos.push(a); }
    }
    if (vencidos.length) this._cambio('expirar', vencidos);
    return vencidos.length;
  }

  _liberar(a) {
    a.estado = 'disponible';
    a.usuario = null;
    a.hasta = null;
  }

  _cambio(motivo, afectados) {
    this.version++;
    this.ultimoCambio = this.reloj();
    this.emit('cambio', { motivo, version: this.version, ts: this.ultimoCambio, asientos: afectados.map((a) => ({ ...a })) });
  }
}

module.exports = { Cine, FILAS, POR_FILA, PRECIOS };
