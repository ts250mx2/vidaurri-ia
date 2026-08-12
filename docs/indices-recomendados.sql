-- ============================================================================
-- Índices recomendados para la base de datos `bdav`
-- ----------------------------------------------------------------------------
-- Estas tablas grandes NO tienen índice en las columnas por las que el sistema
-- (y el POS legacy) filtra con más frecuencia, por lo que varias consultas
-- hacen escaneos completos de tabla. Crear estos índices hace instantáneas las
-- consultas de rangos de fecha y las búsquedas por código alterno.
--
-- Ejecutar EN EL SERVIDOR hlsistemas.com, en horario de baja carga. Son
-- operaciones ONLINE en MySQL 8 (no bloquean lecturas/escrituras), pero en
-- tablas de cientos de miles de filas pueden tardar de segundos a minutos.
-- No afectan al sistema de punto de venta: solo aceleran las consultas.
-- ============================================================================

-- ventas: 174k filas. Se filtra por rango de fecha en casi todos los reportes.
ALTER TABLE `ventas` ADD INDEX `idx_ventas_fecha` (`fecha`);

-- mov_articulos (kardex): 610k filas. Se filtra por fecha en el kardex.
ALTER TABLE `mov_articulos` ADD INDEX `idx_mov_fecha` (`fecha`);

-- cotiza: 163k filas. Se filtra por fecha de cotización.
ALTER TABLE `cotiza` ADD INDEX `idx_cotiza_fecha` (`fecha_cot`);

-- codigos_alternos: 15k filas SIN índice por artículo. La búsqueda de artículos
-- por código alterno lo recorre por completo por cada artículo candidato.
ALTER TABLE `codigos_alternos` ADD INDEX `idx_codalt_articulo` (`id_articulo`);

-- detalle_venta: 419k filas. El cálculo de "más vendidos" y quiebres agrupa por
-- artículo uniendo contra ventas por fecha.
ALTER TABLE `detalle_venta` ADD INDEX `idx_detvta_articulo` (`id_articulo`);

-- Verificación posterior (opcional):
-- SHOW INDEX FROM `ventas`;
-- EXPLAIN SELECT COUNT(*) FROM ventas WHERE fecha = CURDATE();
