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

Base URL según dónde corra el sistema, por ejemplo:
`http://TU_SERVIDOR:3038/api/whatsapp/vendedor`

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
| `mensaje` | string | Lo que escribió el cliente. **Requerido.** |
| `reiniciar` | boolean | Opcional. Si es `true`, olvida el historial de ese teléfono y empieza de cero. |

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
curl -X POST http://TU_SERVIDOR:3038/api/whatsapp/vendedor \
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

## Notas de seguridad

- Trata la `WHATSAPP_API_KEY` como un secreto. Si se filtra, genera otra
  (`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`)
  y actualiza el `.env` y tu pasarela.
- Expón este endpoint por HTTPS (detrás de tu proxy) si sale a internet.
- El agente es de **solo consulta** del catálogo: no crea ventas ni modifica datos.
