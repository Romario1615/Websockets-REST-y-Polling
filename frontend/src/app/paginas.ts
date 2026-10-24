import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { ClienteWs } from './clientes';
import { Cine } from './cine';
import { ConfirmarServicio } from './confirmar';
import { Asiento } from './modelos';
import { Sala } from './sala';

@Component({
  selector: 'app-pagina-ws',
  imports: [Cine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="contenedor">
      <h1>Reserva de asientos con WebSockets</h1>
      <p class="intro">Abre esta página en dos navegadores con usuarios distintos: cada reserva aparece en el otro sin recargar. La conexión WebSocket se mantiene abierta y el servidor envía los cambios.</p>
      <app-cine mecanismo="ws" />
    </main>
  `,
})
export class PaginaWs {}

@Component({
  selector: 'app-pagina-polling',
  imports: [Cine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="contenedor">
      <h1>Reserva de asientos con REST + Polling</h1>
      <p class="intro">El navegador consulta <code>GET /api/asientos</code> cada cierto tiempo y actualiza la sala si la versión cambió. Cambia el intervalo y observa cuántas solicitudes se generan.</p>
      <app-cine mecanismo="polling" />
    </main>
  `,
})
export class PaginaPolling {}

@Component({
  selector: 'app-pagina-comparar',
  imports: [Cine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pagina-comparar.html',
})
export class PaginaComparar {
  private readonly confirmar = inject(ConfirmarServicio);
  private readonly polling = viewChild.required<Cine>('cp');
  private readonly ws = viewChild.required<Cine>('cw');
  protected readonly aviso = signal('');
  private cambiosPendientes = 0;

  protected readonly p = computed(() => this.polling().cliente());
  protected readonly w = computed(() => this.ws().cliente());

  protected media(c: { latenciaMedia(): number | null }): string { const m = c.latenciaMedia(); return m === null ? 'sin datos' : Math.round(m) + ' ms'; }
  protected miles(n: number): string { return n.toLocaleString('es-EC'); }

  private async simular(): Promise<void> {
    const r = await fetch('/api/simular/reservar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json() as { ok: boolean; asiento?: Asiento; error?: string };
    this.aviso.set(d.ok ? 'Cambio externo: asiento ' + d.asiento?.id + ' reservado.' : (d.error ?? ''));
  }

  protected uno(): void { void this.simular(); }

  protected cinco(): void {
    this.cambiosPendientes = 5;
    const t = setInterval(() => { void this.simular(); if (--this.cambiosPendientes === 0) clearInterval(t); }, 1000);
  }

  protected reiniciarContadores(): void { this.p().reiniciarMetricas(); this.w().reiniciarMetricas(); this.aviso.set('Contadores reiniciados.'); }

  protected async reiniciarSala(): Promise<void> {
    const r = this.resumen(this.w().asientos());
    const ok = await this.confirmar.pedir('Reiniciar la sala', `Se liberarán los 30 asientos para todos los usuarios conectados (ahora: ${r.reservados} reservas pendientes y ${r.vendidos} compras).`, 'Reiniciar');
    if (!ok) return;
    await fetch('/api/admin/resetear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    this.aviso.set('Sala reiniciada.');
  }

  private resumen(a: Asiento[]): { reservados: number; vendidos: number } {
    return { reservados: a.filter((x) => x.estado === 'reservado').length, vendidos: a.filter((x) => x.estado === 'vendido').length };
  }
}

@Component({
  selector: 'app-pagina-admin',
  imports: [Sala],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pagina-admin.html',
})
export class PaginaAdmin {
  private readonly confirmar = inject(ConfirmarServicio);
  protected readonly cliente = new ClienteWs();
  protected readonly mensaje = signal('');
  protected readonly ocupados = computed(() => this.cliente.asientos().filter((a) => a.estado !== 'disponible'));
  protected readonly cuenta = computed(() => {
    const a = this.cliente.asientos();
    return { disponibles: a.filter((x) => x.estado === 'disponible').length, reservados: a.filter((x) => x.estado === 'reservado').length, vendidos: a.filter((x) => x.estado === 'vendido').length };
  });

  constructor() { this.cliente.iniciar(); }

  protected async liberar(): Promise<void> {
    const c = this.cuenta();
    if (!c.reservados) { this.mensaje.set('No hay reservas para liberar.'); return; }
    if (!await this.confirmar.pedir('Liberar todo', `Se liberarán ${c.reservados} reservas pendientes de todos los usuarios. Las compras no se tocan.`, 'Liberar todo')) return;
    const r = await this.cliente.emitir('admin:liberar-todo');
    this.mensaje.set('Reservas liberadas: ' + (r.liberados ?? 0));
  }

  protected async resetear(): Promise<void> {
    const c = this.cuenta();
    if (!await this.confirmar.pedir('Resetear asientos', `Los 30 asientos volverán a estar disponibles para todos: se perderán ${c.reservados} reservas pendientes y ${c.vendidos} compras.`, 'Resetear')) return;
    await this.cliente.emitir('admin:resetear');
    this.mensaje.set('Asientos reiniciados.');
  }
}
