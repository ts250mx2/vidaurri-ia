# Webservice del Vendedor IA para WhatsApp

Permite conectar el agente **Vendedor IA** a WhatsApp (o cualquier canal de chat).
Recibe el mensaje de un cliente y devuelve la respuesta del vendedor en texto,
lista para reenviar al chat. Las respuestas están redactadas en estilo WhatsApp
(cortas, con `*negritas*`, sin tablas).

## Endpoint

```
POST  /api/whatsapp/vendedor
GET   /api/whatsapp/vendedor      (health check: responde {ok:true})
```

Base URL según dónde corra el sistema. En producción es
`https://vidaurri.hlsistemas.com/api/whatsapp/vendedor` (**con `https://`**: el
puerto 80 de ese servidor redirige a otro vhost y el 3038 no está abierto a
internet). En desarrollo, `http://localhost:3037/api/whatsapp/vendedor`.

## Autenticación

Cada petición debe llevar la API key (variable `WHATSAPP_API_KEY` del `.env`) en
**uno** de estos headers:

```
X-API-Key: <WHATSAPP_API_KEY>
```
o
```
Authorization: Bearer <WHATSAPP_API_KEY>
```

Sin key válida responde `401`. Si `WHATSAPP_API_KEY` no está configurada en el
servidor, el webservice queda cerrado (siempre `401`).

## Petición

`Content-Type: application/json`

```json
{
  "telefono": "5218112345678",
  "mensaje": "necesito un cofre para versa 2016",
  "reiniciar": false
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `telefono` | string | Número del cliente. Identifica la conversación para recordar el contexto. Opcional (si falta, se usa `anon`). |
| `mensaje` | string | Lo que escribió el cliente. **Requerido**, salvo que venga al menos una imagen. |
| `reiniciar` | boolean | Opcional. Si es `true`, olvida el historial de ese teléfono y empieza de cero. |
| `imagenes` | array | Opcional. Hasta **3** fotos que mandó el cliente (la pieza, una etiqueta con el número de parte, el golpe). Cada elemento es la **URL `https`** del medio, el archivo en **base64** (con o sin prefijo `data:image/...;base64,`) o un objeto `{ "url": ... }` / `{ "base64": ... }`. Para mapear una sola variable de la pasarela también se aceptan `imagen` o `imagenUrl`. |

### Fotos del cliente

Vico ve la foto en el turno en que llega y con ella busca la pieza en el catálogo;
en la memoria de la conversación y en la bitácora queda solo la marca `[foto]`.

- Máximo 3 imágenes y 8 MB cada una. Se normalizan en el servidor (orientación,
  tamaño, JPEG, sin metadatos), así que da igual si llegan en PNG, WebP o HEIC-convertido.
- **Por URL**: solo `https`, sin credenciales en la URL y nunca a direcciones privadas;
  cada redirección se vuelve a validar. Si la pasarela exige un token para bajar el
  medio, va en `WHATSAPP_MEDIA_AUTH` y **solo** se manda a los hosts de
  `WHATSAPP_MEDIA_HOSTS` (lista blanca separada por comas; con ella, cualquier otro
  host se rechaza).
- **En base64**: la petición crece; nginx corta en 1 MB por omisión, así que hace
  falta `client_max_body_size 12m;` en el `server` de este sitio.
- Una foto que no se pueda abrir no da error: si el cliente además escribió algo, Vico
  contesta al texto y le pide reenviarla; si solo mandó la foto, la respuesta le pide
  reenviarla o escribir qué busca. `400` solo si el campo viene mal formado o son más de 3.
- Si el modelo que HL tiene asignado a Vico no ve imágenes, el turno se repite sin la
  foto y Vico le pide al cliente que describa la pieza.

La conversación por teléfono se recuerda **30 minutos** desde el último mensaje
(hasta 12 mensajes de contexto). Límite: 20 mensajes por minuto por teléfono.

## Respuesta

```json
{
  "ok": true,
  "respuesta": "¡Claro! Para tu *Versa 2016* tengo el cofre 👇\n*CNVE15* – Cofre Versa 15-19\n💵 $1,709.84 con IVA\n📦 3 en existencia\n¿Es sedán? Con eso te confirmo que sea el correcto 👍",
  "fotos": [
    {
      "codigo": "CNVE15",
      "url": "https://s3-us-west-2.amazonaws.com/aldoautopartesproductos/CNVE15.jpg"
    }
  ]
}
```

| Campo | Descripción |
|---|---|
| `respuesta` | Texto listo para enviar al cliente (ya sin marcadores internos). |
| `fotos` | Lista de las **fotos de los productos sugeridos**, con su `url` pública en **AWS S3**. Solo trae las que existen (verificadas). Puede venir vacía (`[]`) si el agente no sugirió productos o no tienen foto. |

Tu pasarela debe **enviar `respuesta` como mensaje de texto** y, por cada elemento
de `fotos`, **enviar su `url` como imagen** (todas son URLs públicas HTTPS de
Amazon, no requieren autenticación). Orden sugerido: primero las imágenes, luego
el texto (o al revés, según prefieras).

En error: `{ "ok": false, "error": "..." }` con el código HTTP correspondiente
(`400` datos inválidos, `401` sin autorización, `429` demasiados mensajes,
`502` falla del servicio).

## Prueba rápida (curl)

```bash
curl -X POST https://vidaurri.hlsistemas.com/api/whatsapp/vendedor \
  -H "X-API-Key: <WHATSAPP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"telefono":"5218112345678","mensaje":"cofre para versa 2016"}'
```

## Cómo conectarlo a WhatsApp

Este webservice es **genérico**: cualquier pasarela de WhatsApp que pueda hacer
una llamada HTTP puede usarlo. Solo tienes que, por cada mensaje que llegue a tu
WhatsApp, llamar a este endpoint y responder con el campo `respuesta`.

### Opción A — WhatsApp Cloud API (Meta)

En el webhook que recibe los mensajes de Meta:
1. Extrae el texto (`entry[].changes[].value.messages[].text.body`) y el número
   (`...messages[].from`).
2. Llama a `POST /api/whatsapp/vendedor` con `{ telefono, mensaje }`.
3. Envía `respuesta` de vuelta con la Graph API
   (`POST /v20.0/<PHONE_NUMBER_ID>/messages`, tipo `text`).

### Opción B — Twilio WhatsApp

En el webhook de Twilio (recibe `From` y `Body`):
1. Llama a este endpoint con `{ telefono: From, mensaje: Body }`.
2. Devuelve `respuesta` como TwiML `<Message>` o vía la API de Twilio.

### Opción C — n8n / whatsapp-web.js / Baileys / Chatwoot

- Nodo/paso "HTTP Request" → `POST` a este endpoint con la API key en el header.
- Usa el `respuesta` para contestar el chat.

## Pedidos por WhatsApp

Un número que está en el padrón (`Vendedor IA > Clientes con descuento`) **con la
casilla "Permitir pedido"** puede levantar pedidos desde el chat: el agente agrega
piezas, muestra el resumen y, cuando el cliente dice que sí, lo envía al mostrador
con folio (`P-000123`). En ese mismo mensaje va la liga al PDF del pedido:

```
📄 Tu pedido P-000123 en PDF: https://vidaurri.hlsistemas.com/api/pedidos/123/pdf?f=<firma>
```

- La liga es pública a propósito (el cliente no tiene sesión) pero lleva una firma
  HMAC del id derivada de `JWT_SECRET`: sin ella, o con la de otro pedido, responde
  404. Se arma sobre `PUBLIC_BASE_URL` (obligatoria: sin ella no se manda liga; nunca
  se deduce del encabezado Host). El PDF trae cliente, sucursal, partidas con
  precio e importe (ya con descuento e IVA), totales, observaciones y la leyenda de
  "sujeto a confirmación de existencia".
- Si el número **no está en el padrón**, o está pero **sin "Permitir pedido"**, el
  agente solo cotiza y, cuando el cliente pide levantar un pedido, le explica el
  motivo (no está registrado / no tiene el permiso) y que lo solicite en el mostrador.
- En cada turno el webservice le pasa al modelo, como nota interna, el estado del
  pedido en captura del cliente (cuántas piezas lleva) y si el número puede pedir.
  La memoria de conversación guarda solo texto, no lo que devolvieron las
  herramientas; sin esa nota, al "sí" del cliente el modelo volvía a agregar las
  piezas (duplicándolas) en vez de confirmar.

## Notas de seguridad

- Trata la `WHATSAPP_API_KEY` como un secreto. Si se filtra, genera otra
  (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
  y actualiza el `.env` y tu pasarela.
- Expón este endpoint por HTTPS (detrás de tu proxy) si sale a internet.
- El agente **consulta** el catálogo (no crea ventas ni modifica datos de bdav); lo
  único que escribe son los pedidos de mostrador, y solo para números autorizados.
