// Find transparent gutters close to the nominal grid. Generated source sheets
// may have uneven row margins; exported cells and pivots remain exact.
export function cuts(image, count, vertical) {
  const length = vertical ? image.height : image.width;
  const breadth = vertical ? image.width : image.height;
  const projection = Array(length).fill(0);
  for (let a = 0; a < length; a++) for (let b = 0; b < breadth; b++) {
    const x = vertical ? b : a, y = vertical ? a : b;
    if (image.data[(y * image.width + x) * 4 + 3] > 64) projection[a]++;
  }
  const result = [0];
  for (let i = 1; i < count; i++) {
    const expected = length * i / count, radius = length / count * 0.24;
    let best = Math.round(expected), score = Infinity;
    for (let a = Math.ceil(expected - radius); a < expected + radius; a++) {
      const candidate = projection[a] * 1000 + Math.abs(a - expected);
      if (candidate < score) { score = candidate; best = a; }
    }
    if (projection[best] > breadth * 0.025) throw new Error(`No clean gutter near ${vertical ? "row" : "column"} ${i}`);
    result.push(best);
  }
  return [...result, length];
}
