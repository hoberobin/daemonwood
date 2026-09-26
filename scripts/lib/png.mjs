import { deflateSync, inflateSync } from "node:zlib";

// Small, dependency-free PNG codec for the 8-bit RGB/RGBA art masters. No
// platform graphics framework or color conversion enters a repeatable export.
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([size, body, sum]);
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePNG(bytes) {
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("Not a PNG");
  let width, height, channels; const parts = [];
  for (let at = 8; at < bytes.length;) {
    const size = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + size);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (data[8] !== 8 || !channels || data[12] !== 0) throw new Error("Art requires non-interlaced 8-bit RGB/RGBA PNG");
    }
    if (type === "IDAT") parts.push(data);
    at += size + 12;
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = width * channels;
  const unpacked = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error("Unsupported PNG filter");
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= channels ? unpacked[i - channels] : 0;
      const b = y ? unpacked[i - stride] : 0, c = y && x >= channels ? unpacked[i - stride - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      unpacked[i] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < unpacked.length; i += channels, j += 4) {
    data[j] = unpacked[i]; data[j + 1] = unpacked[i + 1]; data[j + 2] = unpacked[i + 2];
    data[j + 3] = channels === 4 ? unpacked[i + 3] : 255;
  }
  return { width, height, data };
}
export function encodePNG({ width, height, data }) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const stride = width * 4, raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
export function bounds(image, rect = [0, 0, image.width, image.height], threshold = 32) {
  const [x, y, w, h] = rect; let left = x + w, top = y + h, right = -1, bottom = -1;
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    if (image.data[(py * image.width + px) * 4 + 3] <= threshold) continue;
    left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
  }
  return right < left ? null : [left, top, right - left + 1, bottom - top + 1];
}

// Area sampling averages premultiplied color, preserving transparent edges.
export function blit(source, rect, target, dx, dy, dw, dh) {
  const [sx, sy, sw, sh] = rect;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const x0 = sx + x * sw / dw, x1 = sx + (x + 1) * sw / dw;
    const y0 = sy + y * sh / dh, y1 = sy + (y + 1) * sh / dh;
    let weight = 0, alpha = 0, r = 0, g = 0, b = 0;
    for (let py = Math.floor(y0); py < Math.ceil(y1); py++) for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
      if (px < 0 || py < 0 || px >= source.width || py >= source.height) continue;
      const area = (Math.min(x1, px + 1) - Math.max(x0, px)) * (Math.min(y1, py + 1) - Math.max(y0, py));
      const i = (py * source.width + px) * 4, a = source.data[i + 3] / 255;
      weight += area; alpha += a * area;
      r += source.data[i] * a * area; g += source.data[i + 1] * a * area; b += source.data[i + 2] * a * area;
    }
    const i = ((dy + y) * target.width + dx + x) * 4;
    if (alpha) { target.data[i] = Math.round(r / alpha); target.data[i + 1] = Math.round(g / alpha); target.data[i + 2] = Math.round(b / alpha); }
    target.data[i + 3] = weight ? Math.round(alpha / weight * 255) : 0;
  }
}
