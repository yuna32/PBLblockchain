// 노드 모양: circle, square, diamond, triangle, hexagon. 색은 CSS 변수 문자열을 style로 넘긴다.
export function NodeShape({ shape = "circle", r = 8, fill, stroke, strokeWidth = 1.5, dash, opacity = 1 }) {
  const style = { fill, stroke, strokeWidth, strokeDasharray: dash, opacity };
  switch (shape) {
    case "square":
      return <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={3} style={style} />;
    case "diamond": {
      const k = r * 1.3;
      return <polygon points={`0,${-k} ${k},0 0,${k} ${-k},0`} style={style} />;
    }
    case "triangle":
      return <polygon points={`0,${-r * 1.25} ${r * 1.15},${r * 0.85} ${-r * 1.15},${r * 0.85}`} style={style} />;
    case "hexagon": {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
      }).join(" ");
      return <polygon points={pts} style={style} />;
    }
    default:
      return <circle r={r} style={style} />;
  }
}
