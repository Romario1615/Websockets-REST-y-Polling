import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClienteCine, ClientePolling, ClienteWs } from './clientes';
import { Asiento, Mecanismo } from './modelos';
import { Sala, descripcion } from './sala';

/** Reserva de asientos. Es la misma interfaz con los dos mecanismos: solo cambia el cliente que habla con el servidor. */
@Component({
  selector: 'app-cine',
  imports: [FormsModule, Sala],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cine.html',
})
export class Cine implements OnInit {
  readonly mecanismo = input.required<Mecanismo>();
  readonly metricas = input(false);

  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dlgFactura = viewChild.required<ElementRef<HTMLDialogElement>>('dlgFactura');

  /** El cliente se crea cuando se conoce el mecanismo; la página de comparación lo lee para mostrar las medidas. */
  readonly cliente = computed<ClienteCine>(() => (this.mecanismo() === 'ws' ? new ClienteWs() : new ClientePolling(this.http)));
  protected readonly polling = computed(() => { const c = this.cliente(); return c instanceof ClientePolling ? c : null; });

  protected readonly nombre = signal('');
  protected readonly mensaje = signal({ texto: '', error: false });
  protected readonly detalle = signal('Pasa el mouse, enfoca o toca un asiento para ver quién lo tiene.');
  protected readonly ahora = signal(Date.now());

  protected readonly asientos = computed(() => this.cliente().asientos());
  protected readonly entro = computed(() => this.cliente().usuario() !== '');
  protected readonly bloqueados = computed(() => !this.entro() || !this.cliente().conectado());
  protected readonly mios = computed<Asiento[]>(() => { const yo = this.cliente().usuario(); return yo ? this.asientos().filter((a) => a.estado === 'reservado' && a.usuario === yo) : []; });
  protected readonly total = computed(() => this.mios().reduce((s, a) => s + a.precio, 0));
  protected readonly restante = computed(() => {
    const m = this.mios();
    if (!m.length) return 0;
    return Math.max(0, Math.min(...m.map((a) => a.hasta ?? 0)) - (this.ahora() + (this.cliente().ahoraServidor() - Date.now())));
  });
  protected readonly lecturaMedia = computed(() => { const m = this.cliente().latenciaMedia(); return m === null ? 'sin datos' : Math.round(m) + ' ms'; });

  private reservasPrevias = new Set<string>();
  private liberadasPorMi = new Set<string>();
  private avisoDiez = false;

  constructor() {
    const reloj = setInterval(() => this.ahora.set(Date.now()), 250);
    this.destroyRef.onDestroy(() => { clearInterval(reloj); this.cliente().detener(); });

    // Aviso cuando una reserva propia vence sin que el usuario la haya liberado ni comprado.
    effect(() => {
      const actuales = new Set(this.mios().map((a) => a.id));
      const todos = this.asientos();
      const vencidas = [...this.reservasPrevias].filter((id) => !actuales.has(id) && !this.liberadasPorMi.has(id) && todos.find((a) => a.id === id)?.estado === 'disponible');
      if (vencidas.length) this.avisar('Tu reserva de ' + vencidas.join(', ') + ' venció. El asiento volvió a estar disponible.', true);
      this.reservasPrevias = actuales;
    });
    effect(() => {
      const s = this.restante();
      if (!this.mios().length) { this.avisoDiez = false; return; }
      if (s <= 10000 && !this.avisoDiez) { this.avisoDiez = true; this.avisar('Quedan 10 segundos para pagar tu reserva.', true); }
    });
  }

  ngOnInit(): void { this.cliente().iniciar(); }

  protected avisar(texto: string, error = false): void { this.mensaje.set({ texto, error }); }
  protected mostrar(a: Asiento): void { this.detalle.set(descripcion(a)); }
  protected segundos(ms: number): number { return Math.ceil(ms / 1000); }
  protected dinero(n: number): string { return '$' + n.toFixed(2); }
  protected dineroEs(n: number): string { return n.toLocaleString('es-EC'); }

  protected async entrar(): Promise<void> {
    const nombre = this.nombre().trim();
    if (!nombre) { this.avisar('Escribe tu nombre para entrar.', true); return; }
    const r = await this.cliente().registrarUsuario(nombre);
    if (!r.ok) { this.cliente().usuario.set(''); this.avisar(r.error ?? 'No se pudo entrar.', true); return; }
    this.avisar('Sesión iniciada como ' + nombre + '. Elige tus asientos.');
  }

  protected async pulsar(evento: { id: string; libre: boolean }): Promise<void> {
    const c = this.cliente();
    if (!c.usuario()) return this.avisar('Escribe tu nombre y pulsa Entrar para elegir asientos.', true);
    if (!c.conectado()) return this.avisar('Sin conexión con el servidor: no se pueden enviar cambios.', true);
    const a = c.asientos().find((x) => x.id === evento.id);
    if (!a) return;
    if (!evento.libre) return this.avisar(descripcion(a) + '. No se puede reservar.', true);
    const liberar = a.estado === 'reservado' && a.usuario === c.usuario();
    if (liberar) this.liberadasPorMi.add(a.id); else this.liberadasPorMi.delete(a.id);
    const r = liberar ? await c.liberar(a.id) : await c.reservar(a.id);
    this.avisar(r.ok ? (liberar ? 'Liberaste el asiento ' + a.id + '.' : 'Reservaste ' + a.id + '. Tienes ' + Math.round(c.reservaMs() / 1000) + ' s para pagar.') : (r.error ?? 'Error'), !r.ok);
  }

  protected abrirFactura(): void { this.dlgFactura().nativeElement.showModal(); }
  protected cerrarFactura(): void { this.dlgFactura().nativeElement.close(); }

  protected async confirmarCompra(): Promise<void> {
    const ids = this.mios().map((a) => a.id);
    this.cerrarFactura();
    const r = await this.cliente().comprar(ids);
    this.avisar(r.ok ? `Compra confirmada: ${ids.join(', ')} · ${this.dinero(r.total ?? 0)}` : (r.error ?? 'Error'), !r.ok);
  }

  protected cambiarIntervalo(valor: string): void { this.polling()?.cambiarIntervalo(Number(valor)); }
}
