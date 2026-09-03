# Consumir el Vendedor IA desde Axon Logic

Guía para conectar el flujo de WhatsApp de **Axon Logic** con el webservice del
**Vendedor IA** de Vidaurri. La idea del flujo es simple:

```
Mensaje entrante de WhatsApp
        │
        ▼
[Nodo HTTP Request]  ──POST──►  /api/whatsapp/vendedor   (este sistema)
        │                          responde { respuesta, fotos[] }
        ▼
[Enviar mensaje de texto]  ← respuesta
[Enviar imagen(es)]        ← fotos[].url   (si vienen)
```

El webservice recibe el mensaje del cliente y devuelve la respuesta del
vendedor **ya redactada en estilo WhatsApp** (corta, con `*negritas*` y emojis)
más las fotos de los productos sugeridos. Axon Logic solo tiene que reenviar
eso al chat.

---

## 1. Configuración del nodo HTTP Request

| Campo | Valor |
|---|---|
| **Método** | `POST` |
| **URL** | `http://vidaurri.hlsistemas.com/api/whatsapp/vendedor` |
| **Header 1** | `Content-Type: application/json` |
| **Header 2** | `X-API-Key: TU_API_KEY` |
| **Timeout** | `120000` ms (120 s) — ver nota abajo |
| **Body** | JSON (raw), ver payload |

- `TU_API_KEY`: el valor real de `WHATSAPP_API_KEY` del `.env` del servidor
  (no se versiona aquí a propósito: este repositorio es público). También se
  acepta como `Authorization: Bearer TU_API_KEY`.
- **Timeout**: el agente consulta el catálogo con IA y puede tardar
  **10–60 segundos**. Configura el timeout del nodo en 90–120 s; con el timeout
  por defecto de muchas plataformas (10–30 s) el flujo cortará respuestas válidas.

## 2. Payload de la petición (request body)

```json
{
  "telefono": "{{contacto.telefono}}",
  "mensaje": "{{mensaje.texto}}",
  "reiniciar": false
}
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `telefono` | string | No (recomendado) | Número del cliente en cualquier formato (`5218112345678`, `+52 81 1234 5678`). **Identifica la conversación**: con él, el agente recuerda el contexto 30 minutos (hasta 12 mensajes). Si falta, todos los mensajes anónimos comparten una sola conversación. |
| `mensaje` | string | **Sí** | El texto que escribió el cliente, tal cual (máx. 2000 caracteres). |
| `reiniciar` | boolean | No | `true` borra la memoria de ese teléfono y empieza conversación nueva. Útil para un comando tipo "menú" o "empezar de nuevo" en tu flujo. |

Sustituye `{{contacto.telefono}}` y `{{mensaje.texto}}` por las variables que
use tu flujo de Axon Logic para el número del contacto y el texto entrante.

## 3. Respuesta del webservice (response body)

**Éxito (HTTP 200):**

```json
{
  "ok": true,
  "respuesta": "¡Sí tengo! 👍\n*Puerta Del. Derecha Eléctrica* (2007-2010) — *$4,408.00* usada\n¿De qué año es tu Journey?",
  "fotos": [
    {
      "codigo": "PTA-25-599-DDE08-R2-F78",
      "url": "https://vidaurri.hlsistemas.com/api/whatsapp/foto/msxovbmiez/usadas/1686_1.jpg"
    }
  ]
}
```

| Campo | Tipo | Cómo usarlo en el flujo |
|---|---|---|
| `ok` | boolean | `true` = hay respuesta válida. Valídalo antes de enviar. |
| `respuesta` | string | **Envíalo como mensaje de texto** al cliente. Ya viene con formato WhatsApp (`*negritas*`, saltos `\n`, emojis). No lo proceses ni recortes. |
| `fotos` | array | 0 a 3 fotos de los productos sugeridos. Por cada elemento, **envía un mensaje de imagen** usando `fotos[n].url` como URL del medio (son URLs públicas, directas, formato JPG). `codigo` sirve como pie de foto opcional. Si el array viene vacío, no envíes nada extra. |

**Error (HTTP 4xx/5xx):**

```json
{ "ok": false, "error": "No autorizado" }
```

| HTTP | Significado | Qué hacer en el flujo |
|---|---|---|
| `400` | Falta `mensaje` o el JSON está mal formado | Revisar el mapeo de variables del body |
| `401` | API key ausente o incorrecta | Revisar el header `X-API-Key` |
| `429` | Más de 20 mensajes/minuto de ese teléfono | Esperar; opcional responder "dame un momento 🙏" |
| `502` | El servicio de IA no pudo responder | Reintentar 1 vez; si persiste, mensaje de disculpa |

Sugerencia de manejo: si `ok !== true`, responde al cliente algo neutro como
*"Dame un momento, ahorita te atiendo 🙏"* y registra el error, en lugar de
mostrar el mensaje técnico.

## 4. Ejemplo completo (probar antes de conectar)

```bash
curl -X POST http://TU_SERVIDOR:3038/api/whatsapp/vendedor \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_API_KEY" \
  -d '{
    "telefono": "5218112345678",
    "mensaje": "tienes puertas usadas para journey?"
  }'
```

Health check (sin API key, para verificar conectividad desde Axon Logic):

```
GET http://TU_SERVIDOR:3038/api/whatsapp/vendedor
→ { "ok": true, "servicio": "vendedor-ia-whatsapp" }
```

## 5. Diseño recomendado del flujo en Axon Logic

1. **Trigger**: mensaje entrante de WhatsApp.
2. *(Opcional)* Si el texto es "menú"/"reiniciar", llama al webservice con
   `"reiniciar": true` además del mensaje.
3. **HTTP Request** al webservice (config de la sección 1, timeout 120 s).
4. **Condición** `ok == true`:
   - Sí → **Enviar texto** con `respuesta` → si `fotos` tiene elementos,
     **enviar imagen** por cada `fotos[n].url` (máx. 3).
   - No → enviar mensaje de disculpa y notificar al administrador.
5. Nada más: la memoria de conversación (contexto de 30 min por teléfono) la
   maneja el webservice; Axon Logic **no** necesita guardar historial.

## 6. Problema conocido: llega la foto del producto anterior

**Síntoma:** el cliente pide un producto, luego pide otro, y la segunda imagen
que llega por WhatsApp es la del producto anterior — aunque el texto y el pie de
foto sí correspondan al producto nuevo.

**Causa:** no es el webservice (se verificó que devuelve la URL correcta en cada
turno). Ocurre cuando la imagen se reenvía desde una copia cacheada: la pasarela
o WhatsApp reutiliza el medio anterior, o la variable del nodo "enviar imagen"
no se refresca entre ejecuciones mientras el texto sí.

**Solución ya aplicada del lado del webservice:** las fotos ahora se entregan
por un proxy propio con una **marca única dentro de la ruta**:

```
https://vidaurri.hlsistemas.com/api/whatsapp/foto/msxovbmiez/aldo/FCCA18R.jpg
                                                  └─ marca única por respuesta
```

Cada envío es, para cualquier caché, un recurso completamente distinto — aunque
la caché solo mire la ruta y no los parámetros. El contenido de la imagen es el
mismo archivo original de siempre.

**Qué revisar en el flujo de Axon Logic si aún se repite:**

1. Que el nodo de imagen tome la URL **de la respuesta de ESTA ejecución**
   (`fotos[n].url`), no de una variable global o de sesión que persista.
2. Que no haya activada ninguna caché de medios ni reutilización de `media_id`.
3. Que se envíe la URL **completa y sin modificar** — no recortarla ni
   "normalizarla", porque la marca de la ruta es justo lo que rompe la caché.

**Además: envía TODAS las fotos, no solo la primera.** El webservice puede
devolver 2 o 3 (por ejemplo el faro derecho y el izquierdo). Si el flujo solo
manda `fotos[0]`, el cliente ve una sola pieza aunque el texto mencione varias.
Recorre el arreglo y envía una imagen por cada elemento (máx. 3).

## 7. Notas

- **Un mensaje = una llamada.** No agrupes mensajes del cliente; manda cada
  texto entrante tal cual llegue.
- El agente **solo consulta** el catálogo (precios, existencia, fotos); no crea
  ventas ni modifica datos.
- Las URLs de `fotos` son públicas, HTTPS y directas al archivo JPG: la mayoría
  de las plataformas de WhatsApp pueden enviarlas tal cual como media por URL.
- Trata la API key como un secreto: no la pongas en flujos compartidos ni en
  capturas. Si se filtra, genera otra
  (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
  y actualízala en el `.env` del servidor y en Axon Logic.
- Los mensajes de voz/imagen que reciba tu flujo no se soportan: envía al
  webservice solo texto (si llega audio, responde pidiendo que lo escriban).

## 8. Bienvenida por WhatsApp al dar de alta un cliente

Es el camino inverso: aquí **este sistema llama a Axon Logic**. Cuando en
`Vendedor IA > Clientes con descuento` se da de alta un cliente con celular,
el servidor pide la bienvenida a la API pública de Axon Logic por cada celular
capturado:

```
POST https://api.axonlogic.com.mx/v1/public/customers/welcome
X-API-Key: axk_...
Content-Type: application/json

{ "phone": "+528112345678", "name": "Juan Pérez", "idempotency_key": "cliente-77-8112345678" }
```

- `phone` va en E.164: el celular de 10 dígitos del padrón con `+52` por
  delante (un número con lada de otro país solo lleva el `+`).
- `idempotency_key` es una por cliente y celular (`cliente-<id>-<celular>`):
  reintentar la misma alta no manda el mensaje dos veces.
- La plantilla del mensaje se configura en Axon Logic, no aquí.

**Configuración** (`.env` del servidor): `AXON_API_KEY` con la key `axk_...`
que entrega Axon Logic. Si está vacía la bienvenida no se manda y el alta
sigue funcionando; el aviso del padrón lo dice. `AXON_API_URL` solo sirve para
apuntar a otro servidor en pruebas.

**Qué ve el usuario del panel:** el aviso verde de "Se dio de alta a…" añade a
qué celulares llegó la bienvenida; si alguno falló, el aviso sale en ámbar con
el motivo (API key rechazada, Axon Logic sin responder, etc.) y dura 15 s. El
alta **nunca se deshace** por un fallo de la bienvenida: el cliente ya quedó en
el padrón. El detalle técnico (código HTTP y cuerpo de la respuesta) va al log
del servidor. Se espera hasta 10 s por envío.

No se manda bienvenida al importar la lista APV (serían miles de mensajes) ni
al agregar un celular a un cliente ya existente desde la edición.

**Reenvío manual.** Para esos casos, y para las altas hechas mientras Axon
Logic fallaba, cada fila del padrón con celular tiene el botón «Reenviar
bienvenida por WhatsApp» (icono de avión de papel), que llama a
`POST /api/clientes-descuento/{id}/bienvenida` y muestra el resultado en el
mismo aviso. Usa la misma `idempotency_key` que el alta, así que a quien Axon
Logic ya le mandó el mensaje no se lo repite.

## 9. Créditos de WhatsApp: saldo y compra de packs

Página `/dashboard/axon`, sin entrada en el menú lateral a propósito: se abre
desde el chip de saldo del encabezado del panel. Un token de Axon
Logic es una conversación de 24 h con un cliente por WhatsApp; sin saldo, el
Vendedor IA deja de contestar. El módulo sigue la "Guía de Integración — API
Pública de Axon Logic" (v1.0, sep 2026) y usa la misma `AXON_API_KEY`:

| Qué | Axon Logic | Nuestra API (con sesión del panel) |
|---|---|---|
| Saldo, consumo 30 días, ritmo diario, días restantes | `GET /v1/public/billing/balance` | `GET /api/axon/saldo` (cacheado 30 s en el servidor, como pide Axon; `?forzar=1` lo salta al volver de un pago) |
| Catálogo de packs con precio vigente | `GET /v1/public/billing/packs` | `GET /api/axon/packs` (cacheado 10 min) |
| Comprar un pack | `POST /v1/public/billing/checkout` | `POST /api/axon/checkout` `{ "packId": "pack_1500" }` → `{ checkout: { checkoutUrl, pack, expiraEnMinutos } }` |

**Flujo de compra.** El usuario elige un pack, el servidor abre la sesión de
pago en Stripe y la interfaz lo manda a `checkoutUrl` (solo se acepta una URL
HTTPS de `stripe.com`). Paga con tarjeta y Stripe lo regresa a
`PUBLIC_BASE_URL/dashboard/axon?pago=ok` (o `?pago=cancelado`); Axon acredita
los tokens por webhook de Stripe, así que al aterrizar el saldo ya viene
actualizado. La sesión de pago caduca a los 30 min. Cada compra iniciada queda
en el log del servidor con el usuario del panel. **`PUBLIC_BASE_URL` es
obligatoria para comprar**: a diferencia de las fotos, la dirección de regreso
de un pago no se deduce del encabezado Host (lo manda el cliente); sin ella el
checkout responde 500 con el aviso.

**Interfaz.** El encabezado del panel lleva un chip con el saldo (se refresca
cada 5 min y se pone en rojo con menos de 7 días de tokens); la página lo
detalla, alerta cuando quedan menos de 7 días y muestra los packs con el "más
popular" resaltado. Si `AXON_API_KEY` falta, la página lo dice y el chip no se
muestra.

**Límites de Axon.** 60 peticiones/min en GET y 20/min en checkout; con la
caché del servidor el panel no se acerca (ni `?forzar=1` consulta más de una
vez cada 5 s, y las peticiones simultáneas comparten una llamada). Un `429` se
muestra como "espera unos segundos".
