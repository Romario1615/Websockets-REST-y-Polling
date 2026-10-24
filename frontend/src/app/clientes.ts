import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { Asiento, Cambio, Instantanea, LineaRegistro, MetricasCliente, Respuesta } from './modelos';

const METRICAS_VACIAS = (): MetricasCliente => ({ peticiones: 0, bytes: 0, sinCambios: 0, cambios: 0, latencias: [] });
const SIN_CONEXION = 'Sin conexión con el servidor. Inténtalo de nuevo cuando se restablezca.';

/** Estado y reglas comunes a los dos mecanismos. Cada mecanismo solo cambia la forma de hablar con el servidor. */
export abstract class ClienteCine {
  readonly asientos = signal<Asiento[]>([]);
  readonly usuario = signal('');
  readonly conectado = signal(false);
  readonly textoConexion = signal('Conectando…');
  readonly registro = signal<LineaRegistro[]>([]);
  readonly metricas = signal<MetricasCliente>(METRICAS_VACIAS());
  readonly reservaMs = signal(30000);
  /** Ids de asientos que cambiaron por la acción de otro usuario en la última actualización (para resaltarlos). */
  readonly novedades = signal<string[]>([]);
  /** Latencia del último cambio detectado, en milisegundos. */
  readonly ultimaLatencia = signal<number | null>(null);

  readonly latenciaMedia = computed(() => {
    const l = this.metricas().latencias;
    return l.length ? l.reduce((s, x) => s + x, 0) / l.length : null;
  });

  protected version = -1;
  protected desfase = 0;
  private temporizadorNovedades?: ReturnType<typeof setTimeout>;

  abstract iniciar(): void;
  abstract detener(): void;
  abstract registrarUsuario(nombre: string): Promise<Respuesta>;
  abstract reservar(id: string): Promise<Respuesta>;
  abstract liberar(id: string): Promise<Respuesta>;
  abstract comprar(ids: string[]): Promise<Respuesta>;

  ahoraServidor(): number { return Date.now() + this.desfase; }

  reiniciarMetricas(): void { this.metricas.set(METRICAS_VACIAS()); this.ultimaLatencia.set(null); }

  protected contar(bytes: number, extra: Partial<MetricasCliente> = {}): void {
    this.metricas.update((m) => ({ ...m, peticiones: m.peticiones + 1, bytes: m.bytes + bytes, sinCambios: m.sinCambios + (extra.sinCambios ?? 0) }));
  }

  protected registrarLatencia(ms: number): void {
    const valor = Math.max(0, ms);
    this.ultimaLatencia.set(valor);
    this.metricas.update((m) => ({ ...m, cambios: m.cambios + 1, latencias: [...m.latencias, valor] }));
  }

  protected reemplazar(datos: Instantanea, marcarNovedades: boolean): void {
    if (marcarNovedades) {
      const antes = new Map(this.asientos().map((a) => [a.id, a]));
      const cambiados = datos.asientos.filter((a) => { const p = antes.get(a.id); return p && (p.estado !== a.estado || p.usuario !== a.usuario) && a.usuario !== this.usuario(); }).map((a) => a.id);
      this.marcar(cambiados);
    }
    this.asientos.set(datos.asientos);
    this.version = datos.version;
    this.reservaMs.set(datos.reservaMs || this.reservaMs());
    this.desfase = datos.ahora - Date.now();
  }

  protected aplicar(lista: Asiento[], marcarNovedades: boolean): void {
    if (marcarNovedades) this.marcar(lista.filter((a) => a.usuario !== this.usuario()).map((a) => a.id));
    const mapa = new Map(this.asientos().map((a) => [a.id, a]));
    for (const a of lista) mapa.set(a.id, a);
    this.asientos.set([...mapa.values()]);
  }

  private marcar(ids: string[]): void {
    if (!ids.length) return;
    this.novedades.set(ids);
    clearTimeout(this.temporizadorNovedades);
    this.temporizadorNovedades = setTimeout(() => this.novedades.set([]), 1400);
  }

  protected anotar(linea: Omit<LineaRegistro, 'hora'>): void {
    const hora = new Date().toLocaleTimeString('es-EC', { hour12: false });
    this.registro.update((r) => [{ hora, ...linea }, ...r].slice(0, 80));
  }

  protected cambiarConexion(ok: boolean, texto: string): void {
    this.conectado.set(ok);
    this.textoConexion.set(texto);
  }
}

/** REST + Polling: el cliente pregunta periódicamente por el estado completo (HTTP GET). */
export class ClientePolling extends ClienteCine {
  readonly intervalo = signal(2000);
  private temporizador?: ReturnType<typeof setInterval>;
  private consultando = false;

  constructor(private readonly http: HttpClient) { super(); }

  iniciar(): void {
    this.detener();
    void this.consultar();
    this.temporizador = setInterval(() => void this.consultar(), this.intervalo());
  }

  detener(): void { clearInterval(this.temporizador); }

  cambiarIntervalo(ms: number): void {
    this.intervalo.set(ms);
    if (this.temporizador) this.iniciar();
  }

  async consultar(): Promise<void> {
    if (this.consultando) return;
    this.consultando = true;
    const t0 = performance.now();
    try {
      const r = await firstValueFrom(this.http.get('/api/asientos', { responseType: 'text', observe: 'response' }));
      const texto = r.body ?? '';
      const bytes = new Blob([texto]).size;
      const datos = JSON.parse(texto) as Instantanea;
      const primera = this.version === -1;
      const hayCambio = datos.version !== this.version;
      if (hayCambio && !primera) this.registrarLatencia(Date.now() - datos.ts);
      this.contar(bytes, { sinCambios: hayCambio ? 0 : 1 });
      this.reemplazar(datos, !primera);
      this.cambiarConexion(true, 'Polling cada ' + this.intervalo() / 1000 + ' s');
      this.anotar({ sentido: 'GET', texto: '/api/asientos → ' + r.status, bytes, detalle: primera ? 'carga inicial' : hayCambio ? 'con cambios (v' + datos.version + ')' : 'sin cambios', util: hayCambio || primera, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      this.cambiarConexion(false, 'Sin conexión');
      this.anotar({ sentido: 'GET', texto: 'Error de red', bytes: 0, detalle: e instanceof Error ? e.message : 'sin respuesta', util: false });
    } finally {
      this.consultando = false;
    }
  }

  private async llamar(ruta: string, cuerpo: unknown): Promise<Respuesta> {
    const t0 = performance.now();
    try {
      const r = await firstValueFrom(this.http.post<Respuesta>(ruta, cuerpo, { observe: 'response' }));
      return this.procesar(ruta, r.status, r.body ?? { ok: false }, t0);
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.error && typeof e.error === 'object') return this.procesar(ruta, e.status, e.error as Respuesta, t0);
      this.cambiarConexion(false, 'Sin conexión');
      this.anotar({ sentido: 'POST', texto: ruta, bytes: 0, detalle: 'Error de red', util: false });
      return { ok: false, error: SIN_CONEXION };
    }
  }

  private procesar(ruta: string, estado: number, datos: Respuesta, t0: number): Respuesta {
    const bytes = new Blob([JSON.stringify(datos)]).size;
    this.contar(bytes);
    this.anotar({ sentido: 'POST', texto: ruta + ' → ' + estado, bytes, detalle: datos.ok ? 'correcto' : (datos.error ?? 'error'), util: true, ms: Math.round(performance.now() - t0) });
    if (datos.ok && datos.asiento) this.aplicar([datos.asiento], false);
    if (datos.ok && datos.asientos) this.aplicar(datos.asientos, false);
    return datos;
  }

  registrarUsuario(nombre: string): Promise<Respuesta> { this.usuario.set(nombre); return Promise.resolve({ ok: true }); }
  reservar(id: string): Promise<Respuesta> { return this.llamar(`/api/asientos/${id}/reservar`, { usuario: this.usuario() }); }
  liberar(id: string): Promise<Respuesta> { return this.llamar(`/api/asientos/${id}/liberar`, { usuario: this.usuario() }); }
  comprar(ids: string[]): Promise<Respuesta> { return this.llamar('/api/compras', { usuario: this.usuario(), asientos: ids }); }
}

/** WebSocket (Socket.IO): una conexión persistente; el servidor envía los cambios sin que el cliente pregunte. */
export class ClienteWs extends ClienteCine {
  private socket?: Socket;

  iniciar(): void {
    this.socket = io({ transports: ['websocket'] });
    this.socket.on('connect', () => {
      this.cambiarConexion(true, 'WebSocket conectado');
      this.anotar({ sentido: '↔', texto: 'Conexión WebSocket abierta', bytes: 0, detalle: 'id ' + this.socket?.id, util: true });
      if (this.usuario()) void this.registrarUsuario(this.usuario());
    });
    this.socket.on('disconnect', () => this.cambiarConexion(false, 'Sin conexión'));
    this.socket.on('connect_error', () => this.cambiarConexion(false, 'Sin conexión'));
    this.socket.on('estado', (datos: Instantanea) => {
      const bytes = JSON.stringify(datos).length;
      this.contar(bytes);
      this.reemplazar(datos, this.version !== -1);
      this.anotar({ sentido: '←', texto: "evento 'estado' (estado completo)", bytes, detalle: 'al conectarse', util: true });
    });
    this.socket.on('cambio', (c: Cambio) => {
      const bytes = JSON.stringify(c).length;
      this.contar(bytes);
      this.registrarLatencia(Date.now() - c.ts);
      this.aplicar(c.asientos, true);
      this.version = c.version;
      this.anotar({ sentido: '←', texto: "evento 'cambio' · " + c.motivo + ' · ' + c.asientos.map((a) => a.id).join(', '), bytes, detalle: 'v' + c.version, util: true });
    });
  }

  detener(): void { this.socket?.close(); }

  emitir(evento: string, carga?: unknown): Promise<Respuesta> {
    return new Promise((resolver) => {
      if (!this.socket?.connected) return resolver({ ok: false, error: SIN_CONEXION });
      const bytes = JSON.stringify(carga ?? '').length;
      this.anotar({ sentido: '→', texto: `evento '${evento}'` + (carga !== undefined ? ' ' + JSON.stringify(carga) : ''), bytes, detalle: 'enviado', util: true });
      const alResponder = (r: Respuesta) => {
        if (r && !r.ok) this.anotar({ sentido: '←', texto: `respuesta de '${evento}'`, bytes: 0, detalle: r.error ?? '', util: true });
        resolver(r);
      };
      if (carga === undefined) this.socket.emit(evento, alResponder);
      else this.socket.emit(evento, carga, alResponder);
    });
  }

  registrarUsuario(nombre: string): Promise<Respuesta> { this.usuario.set(nombre); return this.emitir('usuario', nombre); }
  reservar(id: string): Promise<Respuesta> { return this.emitir('reserve', id); }
  liberar(id: string): Promise<Respuesta> { return this.emitir('release', id); }
  comprar(ids: string[]): Promise<Respuesta> { return this.emitir('buy', ids); }
}
