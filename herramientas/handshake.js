// Muestra las cabeceras reales del establecimiento de la conexión WebSocket (HTTP Upgrade) y de una consulta REST.
// Uso: node herramientas/handshake.js   (con el servidor en marcha en el puerto 3000)
'use strict';
const net = require('node:net');
const crypto = require('node:crypto');

const PUERTO = Number(process.env.PORT || 3000);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function pedir(texto, terminaEn) {
  return new Promise((resolver) => {
    const s = net.createConnection({ host: '127.0.0.1', port: PUERTO }, () => s.write(texto));
    let datos = '';
    s.on('data', (d) => {
      datos += d.toString('latin1');
      if (datos.includes(terminaEn)) { s.destroy(); resolver(datos); }
    });
  });
}

(async () => {
  const clave = crypto.randomBytes(16).toString('base64');
  const peticion = [
    `GET /socket.io/?EIO=4&transport=websocket HTTP/1.1`, `Host: 127.0.0.1:${PUERTO}`, 'Upgrade: websocket', 'Connection: Upgrade',
    `Sec-WebSocket-Key: ${clave}`, 'Sec-WebSocket-Version: 13', '', '',
  ].join('\r\n');
  const respuesta = (await pedir(peticion, '\r\n\r\n')).split('\r\n\r\n')[0];
  const esperado = crypto.createHash('sha1').update(clave + GUID).digest('base64');
  console.log('=== 1) Petición WebSocket (cliente → servidor) ===\n' + peticion.trim());
  console.log('\n=== 2) Respuesta (servidor → cliente) ===\n' + respuesta);
  const aceptado = /Sec-WebSocket-Accept: (.+)/i.exec(respuesta)?.[1]?.trim();
  console.log(`\nSec-WebSocket-Accept recibido : ${aceptado}\nSHA-1(clave + GUID) calculado : ${esperado}\nCoinciden: ${aceptado === esperado}`);

  const rest = `GET /api/asientos HTTP/1.1\r\nHost: 127.0.0.1:${PUERTO}\r\nAccept: application/json\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n`;
  const r = await pedir(rest, '"asientos"');
  console.log('\n=== 3) Consulta REST (Polling) ===\n' + rest.trim());
  console.log('\n--- respuesta (cabeceras) ---\n' + r.split('\r\n\r\n')[0]);
})();
