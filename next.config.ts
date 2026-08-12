import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Raíz del workspace fija para que la externalización de paquetes resuelva
  // node_modules correctamente aunque exista otro lockfile arriba en el árbol.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
