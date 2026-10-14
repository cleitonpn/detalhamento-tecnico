// Paleta ACI (AutoCAD Color Index) 0–255 como inteiros RGB.
const FIXED = {
  1: 0xff0000,
  2: 0xffff00,
  3: 0x00ff00,
  4: 0x00ffff,
  5: 0x0000ff,
  6: 0xff00ff,
  7: 0xffffff,
  8: 0x808080,
  9: 0xc0c0c0,
};
const GRAYS = [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff];
const BRIGHT = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3];

function hsv(h, s, v) {
  const f = (n, k = (n + h / 60) % 6) =>
    v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  return (
    (Math.round(f(5) * 255) << 16) |
    (Math.round(f(3) * 255) << 8) |
    Math.round(f(1) * 255)
  );
}

export const ACI = Array.from({ length: 256 }, (_, i) => {
  if (FIXED[i] !== undefined) return FIXED[i];
  if (i >= 250) return GRAYS[i - 250];
  if (i >= 10) {
    const hue = (Math.floor(i / 10) - 1) * 15;
    const k = i % 10;
    return hsv(hue, k % 2 === 0 ? 1 : 0.5, BRIGHT[k]);
  }
  return 0xffffff;
});
