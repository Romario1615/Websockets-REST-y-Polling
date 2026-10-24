import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Confirmar } from './confirmar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Confirmar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App {
  protected readonly enlaces = [
    { ruta: '/', texto: 'WebSockets', exacto: true },
    { ruta: '/polling', texto: 'REST + Polling', exacto: false },
    { ruta: '/comparar', texto: 'Comparación', exacto: false },
    { ruta: '/admin', texto: 'Administrador', exacto: false },
  ];
}
