import { ChangeDetectionStrategy, Component, ElementRef, Injectable, effect, inject, signal, viewChild } from '@angular/core';

export interface SolicitudConfirmar { titulo: string; texto: string; aceptar: string; resolver: (valor: boolean) => void }

/** Pide confirmación antes de acciones que afectan a todos los usuarios. */
@Injectable({ providedIn: 'root' })
export class ConfirmarServicio {
  readonly solicitud = signal<SolicitudConfirmar | null>(null);

  pedir(titulo: string, texto: string, aceptar = 'Confirmar'): Promise<boolean> {
    return new Promise((resolver) => this.solicitud.set({ titulo, texto, aceptar, resolver }));
  }
}

@Component({
  selector: 'app-confirmar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="factura" (cancel)="responder(false)">
      @if (servicio.solicitud(); as s) {
        <h2>{{ s.titulo }}</h2>
        <p>{{ s.texto }}</p>
        <div class="acciones">
          <button type="button" class="boton" (click)="responder(false)">Cancelar</button>
          <button type="button" class="boton peligro" (click)="responder(true)">{{ s.aceptar }}</button>
        </div>
      }
    </dialog>
  `,
})
export class Confirmar {
  protected readonly servicio = inject(ConfirmarServicio);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const d = this.dlg().nativeElement;
      if (this.servicio.solicitud() && !d.open) d.showModal();
    });
  }

  protected responder(valor: boolean): void {
    const s = this.servicio.solicitud();
    this.servicio.solicitud.set(null);
    const d = this.dlg().nativeElement;
    if (d.open) d.close();
    s?.resolver(valor);
  }
}
