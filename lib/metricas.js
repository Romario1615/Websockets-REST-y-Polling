// Contadores para comparar los dos mecanismos con datos observados.
'use strict';

class Metricas {
  constructor() { this.reiniciar(); }

  reiniciar() {
    this.desde = Date.now();
    this.http = { solicitudes: 0, bytes: 0, consultasEstado: 0, escrituras: 0 };
    this.ws = { mensajesEnviados: 0, mensajesRecibidos: 0, bytesEnviados: 0, conexiones: 0 };
  }

  registrarHttp(metodo, ruta, bytes) {
    this.http.solicitudes++;
    this.http.bytes += bytes;
    if (metodo === 'GET' && ruta === '/api/asientos') this.http.consultasEstado++;
    else if (metodo !== 'GET') this.http.escrituras++;
  }

  registrarWsEnviado(bytes, destinatarios = 1) {
    this.ws.mensajesEnviados += destinatarios;
    this.ws.bytesEnviados += bytes * destinatarios;
  }

  registrarWsRecibido() { this.ws.mensajesRecibidos++; }

  instantanea(clientesWs) {
    const cpu = process.cpuUsage();
    return { cpuMs: Math.round((cpu.user + cpu.system) / 1000), desde: this.desde, segundos: Math.round((Date.now() - this.desde) / 100) / 10, http: { ...this.http }, ws: { ...this.ws, clientesConectados: clientesWs } };
  }
}

module.exports = { Metricas };
