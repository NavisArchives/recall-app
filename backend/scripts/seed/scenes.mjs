/**
 * Drawn scenes, not photographs.
 *
 * A test archive full of grey rectangles tells you nothing about how the
 * product feels; a beach that looks like a beach does. These are simple
 * procedural illustrations — bands, discs, silhouettes — one per subject, so
 * clicking through a channel reads the way a real one would.
 *
 * They are obviously drawings. That is deliberate: nothing here should ever be
 * mistaken for a family's actual photograph.
 */
import { deflateSync } from "node:zlib";

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const W = 800, H = 600;

class Canvas {
  constructor(w = W, h = H) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 3);
  }
  set(x, y, [r, g, b], alpha = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.px[o] = this.px[o] * (1 - alpha) + r * alpha;
    this.px[o + 1] = this.px[o + 1] * (1 - alpha) + g * alpha;
    this.px[o + 2] = this.px[o + 2] * (1 - alpha) + b * alpha;
  }
  /** Vertical gradient between two colours across a y range. */
  band(y0, y1, top, bottom) {
    for (let y = Math.max(0, y0 | 0); y < Math.min(this.h, y1 | 0); y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      const c = [0, 1, 2].map((i) => top[i] + (bottom[i] - top[i]) * t);
      for (let x = 0; x < this.w; x++) this.set(x, y, c);
    }
  }
  disc(cx, cy, r, color, alpha = 1) {
    for (let y = (cy - r) | 0; y <= cy + r; y++) {
      for (let x = (cx - r) | 0; x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r) this.set(x, y, color, alpha * Math.min(1, (r - d) / 2 + 0.6));
      }
    }
  }
  rect(x0, y0, x1, y1, color, alpha = 1) {
    for (let y = y0 | 0; y < y1; y++) for (let x = x0 | 0; x < x1; x++) this.set(x, y, color, alpha);
  }
  /** Filled triangle, used for roofs and play buttons. */
  tri(ax, ay, bx, by, cx, cy, color) {
    const minX = Math.min(ax, bx, cx) | 0, maxX = Math.max(ax, bx, cx) | 0;
    const minY = Math.min(ay, by, cy) | 0, maxY = Math.max(ay, by, cy) | 0;
    const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d1 = sign(x, y, ax, ay, bx, by);
        const d2 = sign(x, y, bx, by, cx, cy);
        const d3 = sign(x, y, cx, cy, ax, ay);
        const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) this.set(x, y, color);
      }
    }
  }
  /** Deterministic scatter, so the same channel always looks the same. */
  scatter(n, seed, fn) {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < n; i++) fn(rnd() * this.w, rnd() * this.h, rnd(), i);
  }
  toPng() {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      this.px.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

const GLYPHS = {
  0: ["01110","10001","10011","10101","11001","10001","01110"],
  1: ["00100","01100","00100","00100","00100","00100","01110"],
  2: ["01110","10001","00001","00010","00100","01000","11111"],
  3: ["11111","00010","00100","00010","00001","10001","01110"],
  4: ["00010","00110","01010","10010","11111","00010","00010"],
  5: ["11111","10000","11110","00001","00001","10001","01110"],
  6: ["00110","01000","10000","11110","10001","10001","01110"],
  7: ["11111","00001","00010","00100","01000","01000","01000"],
  8: ["01110","10001","10001","01110","10001","10001","01110"],
  9: ["01110","10001","10001","01111","00001","00010","01100"],
};

/** A step number, bottom-left, so the order of a guide is never in doubt. */
function stamp(c, label) {
  const s = 7, pad = 26;
  const w = label.length * 6 * s;
  c.rect(pad - 12, c.h - pad - 7 * s - 12, pad + w, c.h - pad + 12, [0, 0, 0], 0.45);
  label.split("").forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) return;
    for (let gy = 0; gy < 7; gy++)
      for (let gx = 0; gx < 5; gx++)
        if (g[gy][gx] === "1")
          c.rect(pad + (i * 6 + gx) * s, c.h - pad - (7 - gy) * s, pad + (i * 6 + gx + 1) * s, c.h - pad - (6 - gy) * s, [255, 255, 255]);
  });
}

const SCENES = {
  beach(c) {
    c.band(0, 300, [140, 196, 226], [206, 226, 232]);
    c.disc(624, 116, 52, [255, 240, 205]);
    c.band(300, 392, [58, 128, 140], [96, 168, 168]);
    c.band(392, H, [222, 200, 158], [198, 172, 130]);
    c.scatter(38, 7, (x, y, r) => { if (y > 392) c.disc(x, y, 1 + r * 2, [178, 152, 116], 0.5); });
  },
  garden(c) {
    c.band(0, 236, [176, 208, 226], [214, 230, 226]);
    c.band(236, H, [92, 132, 70], [58, 96, 50]);
    c.scatter(16, 3, (x, y, r) => c.disc(x, 250 + (y % 320), 22 + r * 34, [66, 108, 56], 0.85));
    c.scatter(30, 11, (x, y, r) => c.disc(x, 300 + (y % 260), 3 + r * 4, [226, 196, 108], 0.9));
  },
  wedding(c) {
    c.band(0, H, [238, 224, 200], [206, 180, 146]);
    c.scatter(26, 5, (x, y, r) => c.disc(x, y, 16 + r * 46, [255, 246, 226], 0.24));
    c.disc(400, 300, 96, [255, 252, 244], 0.5);
  },
  children(c) {
    c.band(0, H, [226, 214, 226], [186, 202, 224]);
    const hues = [[236,150,140],[236,196,120],[130,186,158],[142,166,220],[214,152,196]];
    c.scatter(22, 13, (x, y, r, i) => c.disc(x, y, 20 + r * 40, hues[i % hues.length], 0.6));
  },
  table(c) {
    c.band(0, 260, [206, 186, 158], [186, 160, 128]);
    c.band(260, H, [146, 106, 72], [112, 78, 52]);
    c.scatter(9, 17, (x, _y, r, i) => c.disc(90 + i * 78, 330 + r * 150, 26 + r * 16, [238, 232, 218], 0.95));
  },
  house(c) {
    c.band(0, 340, [166, 196, 220], [214, 224, 226]);
    c.band(340, H, [96, 124, 78], [70, 96, 60]);
    c.rect(268, 262, 532, 400, [204, 186, 160]);
    c.tri(248, 264, 552, 264, 400, 150, [138, 84, 66]);
    c.rect(378, 316, 424, 400, [92, 66, 52]);
    c.rect(300, 292, 344, 332, [226, 224, 196]);
    c.rect(456, 292, 500, 332, [226, 224, 196]);
  },
  christmas(c) {
    c.band(0, H, [26, 46, 44], [14, 26, 30]);
    c.tri(400, 116, 262, 452, 538, 452, [42, 88, 62]);
    c.rect(378, 452, 422, 496, [86, 60, 42]);
    c.scatter(34, 23, (x, y, r) => {
      const cy = 140 + (y % 300);
      const half = ((cy - 116) / 336) * 138;
      c.disc(400 + (r - 0.5) * half * 2, cy, 4 + r * 3, r > 0.5 ? [246, 214, 130] : [232, 122, 96]);
    });
  },
  video(c) {
    c.band(0, H, [34, 30, 36], [18, 16, 20]);
    c.disc(400, 300, 96, [232, 232, 236], 0.14);
    c.tri(364, 246, 364, 354, 462, 300, [236, 236, 240]);
  },
  coffee(c) {
    c.band(0, 300, [226, 216, 200], [206, 192, 172]);
    c.band(300, H, [176, 158, 134], [148, 128, 106]);
    c.rect(300, 216, 476, 396, [244, 242, 238]);
    c.disc(500, 300, 44, [244, 242, 238]);
    c.disc(500, 300, 24, [176, 158, 134]);
    c.disc(388, 244, 62, [92, 64, 44], 0.9);
  },
  night(c) {
    c.band(0, H, [22, 28, 52], [12, 14, 28]);
    c.disc(608, 130, 46, [232, 230, 208], 0.92);
    c.disc(590, 120, 44, [22, 28, 52], 1);
    c.scatter(46, 29, (x, y, r) => { if (y < 340) c.disc(x, y, 1 + r * 1.6, [226, 226, 240], 0.8); });
    c.rect(250, 420, 550, 470, [58, 52, 74]);
  },
};

/**
 * @param {string} scene  a key of SCENES
 * @param {string} [label] optional step number, drawn bottom-left
 */
export function makeScene(scene, label) {
  const c = new Canvas();
  (SCENES[scene] ?? SCENES.garden)(c);
  if (label) stamp(c, label);
  return c.toPng();
}

export const SCENE_NAMES = Object.keys(SCENES);

/**
 * A profile picture that is nobody.
 *
 * Every person in a seeded family needs a face, and the one thing a seed must
 * never contain is a real one — a photograph of a stranger standing in for
 * somebody's grandmother is a privacy problem wearing a convenience costume.
 * So these are drawn: a lit ground, a shoulder arc and a head disc, in a hue
 * derived from the name. No features, because features are what would make it
 * a likeness of someone.
 *
 * Deterministic on the name, so re-running the seed does not reshuffle who
 * looks like what — a family that changes faces between runs is confusing in
 * a way that costs real debugging time.
 */
export function makePortrait(name) {
  const seed = [...name].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) & 0x7fffffff, 7);
  const hue = seed % 360;

  /* Muted, warm-leaning colours only: this sits beside the product's amber,
     and a saturated avatar would shout across every screen it appears on. */
  const hsl = (h, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };

  const c = new Canvas(400, 400);
  c.band(0, 400, hsl(hue, 0.22, 0.28), hsl((hue + 24) % 360, 0.26, 0.16));
  // Shoulders: a wide low disc, cropped by the frame.
  c.disc(200, 430, 165, hsl((hue + 12) % 360, 0.3, 0.42), 0.95);
  // Head.
  c.disc(200, 176, 92, hsl((hue + 6) % 360, 0.26, 0.55), 1);
  // A soft light from the upper left, so it reads as lit rather than flat.
  c.disc(160, 140, 44, hsl((hue + 6) % 360, 0.22, 0.66), 0.5);
  return c.toPng();
}
