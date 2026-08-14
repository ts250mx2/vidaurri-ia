# Base de datos `wwapvi_bd-usadas` — BODEGA USADO

Servidor MySQL remoto (50.6.198.187:3306, usuario de solo lectura). Sistema propio de
la BODEGA USADO, la sucursal de piezas usadas (puertas, faros, calaveras, espejos,
elevadores, computadoras ECM/PCM, etc.), independiente de `bdav`: no comparten IDs ni códigos.
~19,000 piezas (~17,100 con existencia ≈ $37.7M a precio de venta), ~650 ventas
desde 2024-12. Acceso en la app vía `consultaUsadas` (`src/lib/db-usadas.ts`).

## Tablas principales (las vivas)

### Inventario de piezas usadas
- **`piezas`** (19k): inventario. `id_pieza`, `id_parte`→partes, `id_ubicacion`→ubicaciones,
  `id_modelo`→modelos, `codigo` (ej. PTA-5-129-DIE15-RB-B9-3), `descripcion`, `lado`,
  `posicion`, `tipo_puerta`, `anio_inicio`/`anio_fin` (0/NULL = sin capturar), `puertas`,
  `precio` (sin IVA; 0 = sin precio), `existencia`, `motor`, `numeroparte`, `origen`,
  `pedimento`, `fecha_alta`, `comentarios`, `revisado`.
- **`partes`** (23): tipo de pieza en SINGULAR (PUERTA, FARO, CALAVERA, ESPEJO...;
  en bdav son plurales). `parte`, `cve_parte`.
- **`marcas`** (44) / **`modelos`** (600, `id_marca`): catálogo de autos. Ojo: hay marcas
  compuestas ("DODGE / CHRYSLER").
- **`ubicaciones`** (32.6k): `id_modulo`→modulos, `casillero` (ej. RB-B9-3), `estatus`.
- **`modulos`** (19): zona física (TERRENO ATRAS, BODEGA PISO 1, PATIO RB...).
- **`lados_piezas`** / **`posicion_piezas`** / **`tipos_puertas`**: catálogos chicos.
- **`compatibilidades`** (3.7k): pieza↔auto. **`autos_partes`** (4.3k): catálogo de
  aplicaciones (marca, modelo, lado, posición, años, precio de referencia).
  **`reglas_compatibilidad`**: qué campos aplican por tipo de parte.
- **`piezas_imagenes`** (103k): fotos por pieza (`path_imagen`, `activo`).
- **`piezas_ml`** (3.5k) / **`piezas_ag`**: publicaciones en Mercado Libre.
- **`piezas_conectores`**: conectores/pines por pieza. **`nvos_modelos`**: altas pendientes.
- **`proveedores`** (4): claves de proveedor de las piezas.

### Ventas
- **`ventas`** (644): `id_venta`, `num_venta` (folio U-###), `nombre_cliente`/`telefono_cliente`
  (NULL = público general), `fecha`, `subtotal`, `iva`, `total`, `saldo`,
  `estatus` ('ACTIVO' | 'PAGADO'), `observa`.
- **`venta_detalle`** (2k): partidas. `id_venta`, `id_pieza`, `precio`, `cantidad`, `total_item`.

### Kardex
- **`bitacora_piezas`** (21k): movimientos. `id_pieza`, refs opcionales (`id_venta`,
  `id_compra`, devoluciones), `fecha_movimiento`, `tipo_movimiento`
  ('ENTRADA' | 'VENTA' | 'DEVOLUCION'), `folio_movimiento`, `existencia_anterior`,
  `cantidad`, `existencia_posterior`, `precio`, `total`.

## Tablas a IGNORAR (seguridad/respaldo/scratch)
`usuarios` (claves de acceso), `perfiles`, `permisos`, `metodos`, `control_folios`,
`tmp_detalle_*`, y los respaldos con fecha: `autos_partes_11jul26`, `autos_partes_19mayo26`,
`piezas_puertas_2jul26`, `piezas_quintas_1jul26`, `piezas_imagenes_backup`, `piezas_imagenes_bak`.

## Notas
- Precios sin IVA: el total de venta aplica 16% (`piezas.precio * 1.16`).
- La mayoría de las piezas tiene `existencia` 1 (son piezas únicas de desarme).
- Cruce con bdav (catálogo de artículos): por marca + raíz del tipo de parte en
  singular + traslape de años; no hay códigos compartidos entre ambas bases.
- Integración en la app (NO hay página aparte): selector de sucursal
  (Matriz | Bodega Usado, componente `SelectorSucursal`) dentro de las páginas
  del dashboard; las APIs aceptan `?sucursal=usadas` (principal usa
  `/api/usadas/resumen`). Páginas sin equivalente en la Bodega (cotizaciones,
  back orders, quiebres, pedidos, facturas de compra) muestran un estado vacío
  explicativo. Existencias tiene TRES fuentes: Matriz, Bodega Usado y Aldo
  Autopartes (`/api/inventario/existencias-aldo`, scraping `buscarAldo`).
  Artículos muestra tres grupos de columnas: Principal, Aldo Autopartes y
  Bodega Usado (conteo y "desde" por artículo vía `/api/articulos/usadas-lote`,
  detalle por artículo vía `/api/articulos/usadas`). Agentes IA:
  `consulta_sql_usadas` en VIDA y `buscar_piezas_usadas` en el Vendedor
  (allowlists en `src/lib/agente-sql.ts`).
