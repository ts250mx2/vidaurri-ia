# Base de datos `bdav` — AUTO PARTES VIDAURRI

Servidor MySQL 8.0 en `hlsistemas.com`. Sistema de punto de venta / inventarios de
autopartes de colisión (cofres, defensas, parrillas, polveras, etc.) para autos por
marca (línea), modelo y rango de años. Datos vivos desde 2016-04 a la fecha.
~175,000 ventas, ~42,000 artículos, ~6,300 clientes. Empresa: AUTO PARTES VIDAURRI
(RFC APV940215AL1), tabla `generales`.

## Tablas principales (las vivas)

### Catálogo de artículos
- **`articulos`** (42k): catálogo. `id`, `id_prov`→proveedores, `id_linea`→lineas,
  `id_parte`→partes, `codigo` (ej. CACMD01), `descripcion`, `precio_lista`,
  `precio_cpa` (compra), `descuento`, `precio_vta`, `utilidad`, `existencia`,
  `minimo`/`maximo`/`reorden`, `localizacion`, `aini`/`afin` (rango de años),
  `imagen`, `catalogo` bit.
- **`lineas`** (49): marca de auto (ACURA, AUDI, BMW, CHEVROLET, FORD, NISSAN…). `linea`.
- **`partes`** (115): tipo de pieza (COFRES, POLVERAS, PARRILLAS, DEFENSAS…). `parte`, `abrev`.
- **`modelos`** (591): modelos por línea. `id_linea`, `modelo`.
- **`art-mod`**: aplicaciones artículo↔modelo con rango de años (`aini`, `afin`).
  Ojo: el nombre lleva guion, citar con backticks.
- **`codigos_alternos`** (15k): códigos alternos/equivalencias. `id_articulo`, `codigo`, `codigo_alterno`.
- **`partes_usadas`** (2.1k): inventario de piezas usadas (módulo aparte, con su propio precio/existencia).
- **`proveedores`** (3): ALDO AUTOPARTES, AUTO PARTES ESPECIALIZADAS, RADEC.

### Ventas
- **`ventas`** (174k): `id`, `id_cliente`→clientes, `num_venta`, `serie`
  ('V'=ventas/facturación, 'M'=mostrador), `fecha`, `subtotal`, `iva`, `total`,
  `saldo` (crédito pendiente), `estatus` ('VIGENTE' = con saldo, 'PAGADA'),
  `num_cotiza` (si nace de cotización), `nombre`/`telefono` (público general),
  `observa`, `det_usado` (si vendió piezas usadas).
- **`detalle_venta`** (419k): partidas. `id_venta`, `id_articulo`, `partida`,
  `cantidad`, `precio`, `total_partida`, `devolucion`, `num_devol`.
- **`venta_formapago`** (134k): liga venta↔forma de pago↔usuario que cobró.
- **`forma_pago`** (5): EFECTIVO, TARJETA, CREDITO, CHEQUE, TRANSFERENCIA (`describe_pago`).
- **`detalle_vtausado`**: partidas de venta de piezas usadas (texto libre).
- **`folios_ventas`**: folios consecutivos por serie.

### Cotizaciones
- **`cotiza`** (163k): `id_cte` (nullable), `num_cotiza`, `nombre`, `telefono`,
  `fecha_cot`, `subtotal`, `iva`, `total`, `observa`,
  `estatus` ('VIGENTE', 'VENTA' = se convirtió, 'CANCELADA').
- **`detalle_cotiza`** (349k): `id_cot`, `id_articulo`, `partida`, `cantidad`, `precio`, `total_partida`.

### Clientes y crédito
- **`clientes`** (6.3k): `rfc`, `nombre`, dirección (`calle`,`numero`,`colonia`,
  `codpost`,`ciudad`,`estado`), `telefono`, `descuento`, `saldo` (adeudo),
  `activo` bit, `email`, `limite_credito`, `bloqueo_por_adeudo` bit.
- **`pagos_ventas`**: pagos/abonos de clientes. `id_cliente`, `num_pago`, `fecha_pago`,
  `forma_pago` texto, `num_referencia`, `total_pago`, `estatus_pago`.
- **`pagos_detalle`**: ventas que cubre cada pago.

### Compras y pedidos a proveedor
- **`pedidos`** (614): pedidos a proveedor. `id_prov`, `num_pedido`, `fecha`, totales,
  `estatus` ('ABIERTO', 'COMPLETO', 'INCOMPLETO').
- **`detalle_pedido`** (846k): `id_pedido`, `id_articulo`, `partida`, `codigo`,
  `cantidad`, `total_partida`, `cant_recibida`, `cant_pdte`.
- **`compras`** (510): recepciones. `id_prov`, `id_pedido`, `num_compra`, `fecha_compra`, totales.
- **`detalle_compra`** (2.1k): partidas de compra.
- **`facturas_compras`** (4k): facturas de proveedor. `id_compra`, `num_factura` varchar,
  `fecha_factura`, totales, `saldo`, `estatus`, `comentarios`.
- **`detalle_factura_compra`** (123k): partidas de factura de compra (`precio_compra`).

### Devoluciones
- **`devoluciones`** (2.9k) + **`devoluciones_detalle`** (4.5k): devoluciones de venta
  actuales (num_devolucion, fecha, totales, estatus; detalle con causa_devolucion).
- `devolucion_ventas`/`devolucion_det_vta`, `devolucion_compras`/`devolucion_det_cpa`: vacías (legacy).

### Inventario / kardex
- **`mov_articulos`** (610k): kardex. `id_articulo`, refs opcionales (`id_venta`,
  `id_compra`, `id_fact_cpa`, `id_dev_vta`, `id_dev_cpa`), `fecha`,
  `tipo_mov` ('ENTRADA','VENTA','DEVOLUCION'), `num_doc`, `tipo_doc`
  ('NOTA DE VENTA','COMPRA','AJUSTE INVENTARIO','NOTA DE SALIDA'),
  `exist_ant`, `cantidad`, `exist_post`, `id_usuario`.

### Back orders (pedidos especiales de cliente)
- **`back_order`** (70): `id_prov`, `id_cte`, `id_vendedor`, `num_bko`, `fecha_bko`,
  datos de cliente, totales, `anticipo`, `liquida`, `saldo`,
  `estatus` ('ABIERTA','PROCESO','RECIBIDA','VENTA'), `fecha_compromiso`, `comentarios`.
- **`detalle_bko`**: partidas (estatus 'BKO','PROCESO','RECIBIDA','ENTREGADA', `cant_recibida`, `fecha_llegada`).
- **`backorder_venta`**: liga back order → venta final.

### Seguridad y varios
- **`usuarios`** (12): `usuario`, `clave_usr` (texto plano, 10 chars), `nombre`,
  `perfil` ('Administrador','Operaciones','Ventas'), `nivel` (1=alto, 3=mostrador),
  `serie` ('V' o 'M').
- **`vendedores`** (3): POLENDO, ECHAVARRI, JR.
- **`generales`**: datos de la empresa, `dcto` (33) y `utilidad` (38) por defecto.

## Tablas a IGNORAR (respaldo/legacy/scratch)
`articulos_21mzo26`, `clientes_21mzo26`, `generales_23mzo26`, `bk_arts`, `bk_arts2`,
`articulos_eliminados` (histórico de borrados), `pedido_tony`, `banderas`,
todas las `tbl_*` (mostrador/josvid/ventas1/almacen/beto/polendo: áreas de trabajo
del POS legacy), `tmp_detalle`, `tmplineas`, `tmppiezas`, `tbl_prueba`,
y las vistas `vw_*` (tienen IDs fijos, son auxiliares del POS VB legacy).

## Notas
- Motor InnoDB, charset utf8mb3. Sin ON DELETE CASCADE en la mayoría: borrar con cuidado.
- Precios en `float(7,2)` en tablas viejas (ventas usa `decimal(11,2)`).
- `ventas.serie`: 'V' facturación/crédito, 'M' mostrador (~120k de 174k).
- Estatus de venta: VIGENTE (65k, incluye crédito con saldo) / PAGADA (109k).
- KPIs de referencia (ago 2026): ~3,400 ventas/mes ≈ $8.5M MXN/mes; inventario
  con existencia: ~9,900 códigos ≈ $46.9M a precio de lista.
