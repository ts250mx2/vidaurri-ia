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
  padrón de **clientes con descuento** (teléfono → nombre y %; se prellena del catálogo de
  `bdav` y, si no está, propone `DESCUENTO_DEFAULT` del `.env`, 33 si falta). Cuando el
  número que escribe por WhatsApp está en ese padrón, el agente cotiza las piezas nuevas con
  el descuento del cliente sobre el precio de lista, más IVA; si no está, a precio de
  mostrador. Ambos viven en la base `BDVidaurriConversaciones`, la única donde la
  aplicación escribe.
- **VIDA (agente IA)**: chat que consulta la base de datos en lenguaje natural (solo SELECT).

## Base de datos

Ver [docs/BDAV.md](docs/BDAV.md) para el esquema documentado (tablas vivas,
relaciones, estatus y tablas legacy a ignorar).
