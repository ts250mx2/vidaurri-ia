"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Render del markdown de VIDA con estilos del tema oscuro y dos reglas de
// seguridad del patrón kyk-server-web: solo enlaces internos clickeables y
// solo imágenes servidas por el propio sistema.
export function AgenteMarkdown({ texto }: { texto: string }) {
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-slate-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-black text-white">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
          h1: ({ children }) => <p className="text-sm font-black text-amber-300">{children}</p>,
          h2: ({ children }) => <p className="text-sm font-black text-amber-300">{children}</p>,
          h3: ({ children }) => <p className="text-[13px] font-black text-amber-300">{children}</p>,
          a: ({ href, children }) => {
            const ruta = typeof href === "string" ? href : "";
            if (ruta.startsWith("/") && !ruta.startsWith("//")) {
              return (
                <a
                  href={ruta}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-300 underline decoration-amber-500/40 hover:decoration-amber-300"
                >
                  {children}
                </a>
              );
            }
            return <span className="text-slate-300">{children}</span>;
          },
          img: ({ src }) => {
            // Solo se permiten las fotos servidas por el proxy interno del
            // catálogo (evita cargar imágenes externas desde la respuesta del IA).
            const ruta = typeof src === "string" ? src : "";
            if (!ruta.startsWith("/api/articulos/foto")) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ruta}
                alt="Foto del producto"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
                className="my-1.5 h-28 w-28 object-contain rounded-xl border border-white/10 bg-white"
              />
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[12px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-white/[0.06] text-slate-300">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-2.5 py-1.5 text-left font-black text-[10px] uppercase tracking-wider border border-white/10">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 border border-white/[0.06] font-bold">{children}</td>
          ),
          code: ({ children, className }) => {
            const esBloque = typeof className === "string";
            if (esBloque) {
              return (
                <pre className="bg-black/40 border border-white/10 rounded-xl p-3 overflow-x-auto text-[11px] font-mono text-slate-300">
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code className="bg-white/[0.08] px-1.5 py-0.5 rounded-md text-[11px] font-mono text-amber-200">
                {children}
              </code>
            );
          },
          hr: () => <hr className="border-white/10 my-2" />,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-amber-500/40 pl-3 text-slate-400">
              {children}
            </blockquote>
          ),
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
}
