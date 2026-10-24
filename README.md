# REST + Polling frente a WebSockets: reserva de asientos de cine

Práctica 2 de **Aplicaciones Distribuidas** (ESPE, NRC 37869). Docente: Ing. Luis Alberto Castillo Salinas, Mgtr.

Una sola aplicación de reserva de 30 asientos implementada con dos mecanismos de comunicación sobre el **mismo estado y la misma información**, para compararlos con mediciones reales:

Servidor **Node.js + Express + Socket.IO** e interfaz **Angular + TypeScript** (componentes standalone, signals, HttpClient y Router).

| Versión | Tecnología | Ruta |
|---|---|---|
| WebSockets | Socket.IO (solo transporte `websocket`) | `/` |
| REST + Polling | API REST + `setInterval` con `HttpClient` | `/polling` |
| Comparación en vivo | Las dos versiones lado a lado con contadores | `/comparar` |
| Administrador | Estado global, liberar todo y resetear | `/admin` |

## Ejecutar

```bash
npm run instalar     # dependencias del servidor y de la interfaz Angular
npm run build        # compila la interfaz (frontend/dist)
npm start            # http://127.0.0.1:3000  (también: node app.js)
npm test             # 11 pruebas automáticas
npm run experimento  # compara Polling (0,5/1/2/5 s) con WebSocket → evidencias/experimento.json (se crea al ejecutar)
node herramientas/handshake.js   # cabeceras reales del handshake WebSocket y de una consulta REST
```

Variables opcionales: `PORT`, `HOST`, `RESERVA_MS` (duración de la reserva; 30000 por defecto) y `ALLOWED_HOSTS` (nombres de host extra aceptados; por defecto solo `localhost` y `127.0.0.1`). Cada usuario puede tener hasta 8 asientos reservados a la vez.

## Reglas del escenario

- Sala de 30 asientos (filas A, B y C de diez, con pasillo central). Precios: A $6, B $5, C $4.
- El usuario escribe su nombre y pulsa **Entrar** antes de elegir asientos.
- Una reserva dura 30 s; si no se paga, el asiento se libera y se avisa. Al comprar se muestra una factura.
- El tooltip y la línea inferior muestran quién tiene cada asiento. El administrador puede liberar todo o resetear, con confirmación.

## Estructura

```
server.js · app.js        Servidor Express + Socket.IO (REST y WebSocket en el puerto 3000)
lib/cine.js               Dominio: asientos, reglas, versión y expiración (estado compartido)
lib/metricas.js           Contadores de solicitudes HTTP, mensajes WebSocket y CPU
frontend/                 Interfaz Angular: clientes (REST + Polling y WebSocket), sala, reserva y páginas
tests/pruebas.test.js     Pruebas con node:test y socket.io-client
herramientas/             experimento.js, handshake.js
```

## Resultados del experimento (10 cambios en 30 s, misma máquina)

| Configuración | Solicitudes / mensajes | Sin cambios | Latencia media |
|---|---|---|---|
| Polling 0,5 s | 60 | 49 | 194 ms |
| Polling 1 s | 30 | 19 | 297 ms |
| Polling 2 s | 15 | 4 | 851 ms |
| Polling 5 s | 6 | 0 | 2.889 ms |
| WebSocket | 11 | 0 | ≈ 1 ms |

Con 100 clientes durante 12 s: 1.105 solicitudes HTTP (Polling a 1 s) frente a 500 mensajes (WebSocket). Cada configuración se ejecutó una vez; los valores son indicativos. 
