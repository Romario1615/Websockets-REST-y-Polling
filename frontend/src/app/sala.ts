import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Asiento } from './modelos';

export const FILAS: Asiento['fila'][] = ['A', 'B', 'C'];

export function descripcion(a: Asiento): string {
  const estado = a.estado === 'vendido' ? 'comprado por ' + a.usuario : a.estado === 'reservado' ? 'reservado por ' + a.usuario : 'disponible';
  return `${a.id} · $${a.precio} · ${estado}`;
}

/** Sala de cine: 30 asientos en tres filas con un pasillo central. Los ocupados se pueden enfocar para ver quién los tiene. */
@Component({
  selector: 'app-sala',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sala" [class.bloqueada]="bloqueados()">
      @for (f of filas; track f) {
        <div class="fila">
          <span class="fila-letra">{{ f }}</span>
          @for (a of porFila()[f]; track a.id) {
            <button type="button" [class]="clase(a)" [attr.data-info]="texto(a)" [attr.aria-label]="texto(a)"
              [attr.aria-disabled]="libreParaMi(a) ? null : 'true'" (click)="pulsar(a)" (focus)="detalle.emit(a)" (mouseenter)="detalle.emit(a)">{{ a.numero }}</button>
            @if (a.numero === 5) { <span class="pasillo" aria-hidden="true"></span> }
          }
          <span class="fila-precio">\${{ precioFila(f) }}</span>
        </div>
      }
    </div>
  `,
})
export class Sala {
  readonly asientos = input.required<Asiento[]>();
  readonly yo = input('');
  readonly bloqueados = input(false);
  readonly novedades = input<string[]>([]);
  readonly pulsado = output<{ id: string; libre: boolean }>();
  readonly detalle = output<Asiento>();

  protected readonly filas = FILAS;
  protected readonly porFila = computed(() => {
    const r: Record<string, Asiento[]> = { A: [], B: [], C: [] };
    for (const a of [...this.asientos()].sort((p, q) => p.numero - q.numero)) r[a.fila].push(a);
    return r;
  });

  protected texto = descripcion;
  protected precioFila(f: string): number | string { return this.porFila()[f][0]?.precio ?? ''; }

  protected reservadoPorMi(a: Asiento): boolean { return a.estado === 'reservado' && this.yo() !== '' && a.usuario === this.yo(); }
  protected libreParaMi(a: Asiento): boolean { return !this.bloqueados() && (a.estado === 'disponible' || this.reservadoPorMi(a)); }

  protected clase(a: Asiento): string {
    const mio = this.reservadoPorMi(a);
    const comprado = a.estado === 'vendido' && this.yo() !== '' && a.usuario === this.yo();
    return 'asiento ' + (mio ? 'mio' : comprado ? 'comprado' : a.estado)
      + (a.numero <= 2 ? ' tip-izq' : a.numero >= 9 ? ' tip-der' : '')
      + (this.novedades().includes(a.id) ? ' nuevo' : '');
  }

  protected pulsar(a: Asiento): void {
    this.detalle.emit(a);
    this.pulsado.emit({ id: a.id, libre: this.libreParaMi(a) });
  }
}
