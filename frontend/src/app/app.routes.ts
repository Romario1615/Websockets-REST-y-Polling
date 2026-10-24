import { Routes } from '@angular/router';
import { PaginaAdmin, PaginaComparar, PaginaPolling, PaginaWs } from './paginas';

export const routes: Routes = [
  { path: '', component: PaginaWs, title: 'Reserva con WebSockets · ESPE' },
  { path: 'polling', component: PaginaPolling, title: 'Reserva con REST + Polling · ESPE' },
  { path: 'comparar', component: PaginaComparar, title: 'Comparación REST + Polling y WebSockets · ESPE' },
  { path: 'admin', component: PaginaAdmin, title: 'Administrador · ESPE' },
  { path: '**', redirectTo: '' },
];
