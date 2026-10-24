export type EstadoAsiento = 'disponible' | 'reservado' | 'vendido';

export interface Asiento {
  id: string;
  fila: 'A' | 'B' | 'C';
  numero: number;
  precio: number;
  estado: EstadoAsiento;
  usuario: string | null;
  hasta: number | null;
}

export interface Instantanea {
  version: number;
  ts: number;
  ahora: number;
  reservaMs: number;
  precios: Record<string, number>;
  asientos: Asiento[];
}

export interface Cambio {
  motivo: string;
  version: number;
  ts: number;
  asientos: Asiento[];
}

export interface Respuesta {
  ok: boolean;
  error?: string;
  asiento?: Asiento;
  asientos?: Asiento[];
  total?: number;
  liberados?: number;
}

export interface LineaRegistro {
  hora: string;
  sentido: string;
  texto: string;
  bytes: number;
  detalle: string;
  util: boolean;
  ms?: number;
}

export interface MetricasCliente {
  peticiones: number;
  bytes: number;
  sinCambios: number;
  cambios: number;
  latencias: number[];
}

export type Mecanismo = 'ws' | 'polling';
