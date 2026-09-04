# Vidaurri IA

Sistema web para **AUTO PARTES VIDAURRI** sobre la base de datos `bdav`
(MySQL en hlsistemas.com), con agente inteligente integrado. Arquitectura y
diseño basados en `kyk-server-web`.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- MySQL (`mysql2`) — base de datos `bdav`
- Sesión JWT con cookie firmada (`jose`)
- Agente IA "VIDA" con acceso de solo lectura a la base (Anthropic / OpenAI)

## Puesta en marcha

```bash
npm install
cp .env.example .env   # y llenar valores (ya existe .env configurado en este equipo)
npm run dev            # http://localhost:3037
```

Producción:

```bash
npm run build
npm run start          # puerto 3038
```

## Acceso

Login contra la tabla `usuarios` de `bdav` (usuario y clave del sistema de
punto de venta). Perfiles: Administrador, Operaciones, Ventas.

## Módulos

- **Dashboard**: KPIs del día y del mes, gráfica de ventas, últimas operaciones.
- **Ventas**: consulta con filtros (fecha, serie, estatus), detalle con partidas y formas de pago.
- **Cotizaciones**: consulta y detalle, seguimiento de conversión a venta.
- **Artículos**: catálogo con búsqueda por código/descripción/código alterno, precios y aplicaciones por modelo.
- **Inventario**: existencias y valor, quiebres/reorden, kardex (`mov_articulos`).
- **Clientes**: directorio, cartera y saldos, historial de compras y pagos.
- **Compras**: pedidos a proveedor, recepciones y facturas de compra.
- **Devoluciones**: notas de salida y sus partidas.
- **Back orders**: pedidos especiales de cliente con anticipos.
- **Vendedor IA**: agente de ventas por chat web y WhatsApp; bitácora de conversaciones y
  padrón de **clientes con descuento** (celular → nombre y %, más RFC, otros teléfonos y
  email; se prellena del catálogo de `bdav` y, si no está, propone `DESCUENTO_DEFAULT` del
  `.env`, 33 si falta; se puede cargar completo desde el CSV de la lista APV). Cuando el
  número que escribe por WhatsApp está en ese padrón, el agente cotiza las piezas nuevas con
  el descuento del cliente sobre el precio de lista, más IVA; si no está, a precio de
  mostrador. Ambos viven en la base `BDVidaurriConversaciones`, la única donde la
  aplicación escribe. Al dar de alta un cliente con celular, el sistema le manda la
  bienvenida por WhatsApp a través de Axon Logic (`AXON_API_KEY` del `.env`; ver
  [docs/AXON-LOGIC.md](docs/AXON-LOGIC.md)). **Créditos WhatsApp** (`/dashboard/axon`):
  saldo de tokens de la cuenta en Axon Logic (un token = una conversación de 24 h) y
  compra de packs vía Stripe; el encabezado del panel lleva un chip con el saldo.
- **VIDA (agente IA)**: chat que consulta la base de datos en lenguaje natural (solo SELECT).
  Cada respuesta se puede exportar a PDF con la pregunta que la originó y su formato
  (tablas, listas, negritas, código).

## Pedidos de mostrador y el POS

Los pedidos de mostrador (los captura vidaurri-page contra `/api/mostrador/*`) viven en
`BDVidaurriConversaciones`. Dos momentos se reflejan en el POS (`bdav`), y son lo ÚNICO que
esta aplicación escribe ahí: van por el pool acotado de `src/lib/db-bdav-escritura.ts`, con
lista blanca de sentencias (lo que no está en la lista no se ejecuta).

- **Cotización** al quedar *listo*: `cotiza` + `detalle_cotiza` (`POS_COTIZA_MODO`).
- **Back order a Aldo Autopartes** al quedar *confirmado* (y cada vez que el mostrador vuelve
  a confirmar partidas): las partidas sobre pedido se insertan en `back_order` + `detalle_bko`
  con estatus ABIERTA (`POS_BKO_MODO`: `real` escribe, `simulacion` solo arma y loguea —el
  default—, `apagado` no hace nada). El número de la back order NO es MAX+1: el POS lo toma de
  `folios_ventas.folio_bko` (la fila con `folio_bko` no nulo guarda el SIGUIENTE número) y lo
  sube, así que aquí se lee bajo `FOR UPDATE` y se sube con
  `UPDATE folios_ventas SET folio_bko = folio_bko + 1 WHERE id = ? AND folio_bko = ?`; si el
  UPDATE no afecta una fila es que el POS lo tomó en el mismo instante y se reintenta la
  transacción completa. Si no se subiera, la siguiente back order del POS repetiría el número.
  Una sola back order vigente por pedido: se guarda la firma de los renglones y, si cambian, la
  vigente pasa a CANCELADA y se pide otra; al cancelar el pedido se cancela. `fecha_compromiso`
  es MARTES o VIERNES (los días que entrega Aldo). El vendedor que firma (`vendedores.id`:
  1 POLENDO, 2 ECHAVARRI, 3 JR) sale de la tabla `vendedores_pos` de `BDVidaurriConversaciones`
  por el usuario del POS que confirmó, o de `POS_BKO_VENDEDOR_DEFAULT` (3 = JR). Esa tabla no
  tiene UI; se llena a mano, con el usuario en minúsculas:

  ```sql
  INSERT INTO vendedores_pos (usuario, id_vendedor_bdav, vendedor, creado_en)
  VALUES ('jr', 3, 'JR', NOW());
  ```

  La hoja imprimible ("Orden de compra · Aldo Autopartes") sale de
  `GET /api/mostrador/pedidos/[id]/backorder`; `POST` a la misma ruta reintenta.

## Base de datos

Ver [docs/BDAV.md](docs/BDAV.md) para el esquema documentado (tablas vivas,
relaciones, estatus y tablas legacy a ignorar).
