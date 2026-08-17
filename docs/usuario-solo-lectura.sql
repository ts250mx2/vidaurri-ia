-- ============================================================================
-- Usuario de base de datos de SOLO LECTURA para la app vidaurri-ia
-- ----------------------------------------------------------------------------
-- Crea un usuario MySQL que ÚNICAMENTE puede leer (SELECT) la base `bdav`. La
-- app se conectará con este usuario, de modo que —aunque el código fallara— la
-- base misma rechaza cualquier INSERT / UPDATE / DELETE / DROP. Es la barrera
-- definitiva de "solo consulta".
--
-- Ejecutar EN serverav (donde está MySQL), con un usuario administrador
-- (por ejemplo desde MySQL Workbench con el usuario root o kyk).
-- ============================================================================

-- 1. Crear el usuario de solo lectura (permite conexión desde cualquier host).
-- Sustituye TU_PASSWORD_SEGURA por una contraseña real antes de ejecutar.
CREATE USER IF NOT EXISTS 'kyk_ro'@'%' IDENTIFIED BY 'TU_PASSWORD_SEGURA';

-- 2. Darle SOLO permiso de lectura sobre la base bdav (nada más).
GRANT SELECT ON `bdav`.* TO 'kyk_ro'@'%';

-- 3. Aplicar los cambios.
FLUSH PRIVILEGES;

-- ----------------------------------------------------------------------------
-- Verificación (opcional): debe mostrar únicamente GRANT SELECT ON `bdav`.*
SHOW GRANTS FOR 'kyk_ro'@'%';

-- Prueba de que NO puede escribir (debe dar error de permisos si lo ejecutas
-- conectado como kyk_ro):
--   INSERT INTO bdav.articulos (codigo) VALUES ('X');   -> ERROR 1142 (denegado)
-- ============================================================================
