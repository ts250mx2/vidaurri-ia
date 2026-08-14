// Algoritmo "squarified treemap" (Bruls, Huizing, van Wijk): acomoda una lista
// de valores en rectángulos cuyo ÁREA es proporcional al valor, buscando que
// queden lo más cuadrados posible. Sin dependencias externas.

export interface NodoTreemap {
  nombre: string;
  valor: number;
  [extra: string]: unknown;
}

export interface RectTreemap {
  x: number;
  y: number;
  w: number;
  h: number;
  nodo: NodoTreemap;
}

interface Escalado {
  nodo: NodoTreemap;
  area: number;
}

/** Calcula los rectángulos del treemap para el ancho/alto dados. */
export function calcularTreemap(
  nodos: NodoTreemap[],
  width: number,
  height: number
): RectTreemap[] {
  const positivos = nodos.filter((n) => n.valor > 0);
  const total = positivos.reduce((s, n) => s + n.valor, 0);
  if (total <= 0 || width <= 0 || height <= 0) return [];

  const area = width * height;
  const restantes: Escalado[] = positivos
    .slice()
    .sort((a, b) => b.valor - a.valor)
    .map((n) => ({ nodo: n, area: (n.valor / total) * area }));

  const rects: RectTreemap[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let fila: Escalado[] = [];

  const ladoCorto = () => Math.min(w, h);

  // Peor relación de aspecto de una fila si se dispone a lo largo de `lado`.
  const peor = (items: Escalado[], lado: number): number => {
    if (items.length === 0) return Infinity;
    const suma = items.reduce((s, r) => s + r.area, 0);
    const max = Math.max(...items.map((r) => r.area));
    const min = Math.min(...items.map((r) => r.area));
    const lado2 = lado * lado;
    const suma2 = suma * suma;
    return Math.max((lado2 * max) / suma2, suma2 / (lado2 * min));
  };

  const colocarFila = () => {
    const suma = fila.reduce((s, r) => s + r.area, 0);
    if (w >= h) {
      // Columna vertical que llena la altura h; avanza en x.
      const colAncho = suma / h;
      let fy = y;
      for (const r of fila) {
        const rh = r.area / colAncho;
        rects.push({ x, y: fy, w: colAncho, h: rh, nodo: r.nodo });
        fy += rh;
      }
      x += colAncho;
      w -= colAncho;
    } else {
      // Fila horizontal que llena el ancho w; avanza en y.
      const filaAlto = suma / w;
      let fx = x;
      for (const r of fila) {
        const rw = r.area / filaAlto;
        rects.push({ x: fx, y, w: rw, h: filaAlto, nodo: r.nodo });
        fx += rw;
      }
      y += filaAlto;
      h -= filaAlto;
    }
    fila = [];
  };

  while (restantes.length > 0) {
    const siguiente = restantes[0];
    const lado = ladoCorto();
    if (fila.length === 0 || peor(fila, lado) >= peor([...fila, siguiente], lado)) {
      fila.push(siguiente);
      restantes.shift();
    } else {
      colocarFila();
    }
  }
  if (fila.length > 0) colocarFila();

  return rects;
}
