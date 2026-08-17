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
