// Terminal styling for the Themis CLI. Respects NO_COLOR and non-TTY output.

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const wrap = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  accent: wrap("38;2;255;107;61", "39"),
  green: wrap("38;2;143;209;158", "39"),
  red: wrap("38;2;239;143;132", "39"),
  paper: wrap("38;2;239;235;226", "39"),
  mute: wrap("38;2;108;104;98", "39"),
  inverse: (s, bg) => (useColor ? `\x1b[48;2;${bg}m\x1b[38;2;10;10;9m\x1b[1m ${s} \x1b[0m` : `[${s}]`),
};

export const stamp = (pass) => (pass ? c.inverse("PASS", "143;209;158") : c.inverse("FAIL", "255;107;61"));

// The pixel mark: a lowercase "a", its verdict dot, and a dithered baseline (two pixel rows per line)
const GLYPH = [
  ".######....",
  "#######....",
  "......##...",
  ".#######...",
  "########...",
  "##....##...",
  "########.##",
  ".###.###.##",
];

export const banner = (subtitle) => {
  const rows = [];
  for (let y = 0; y < GLYPH.length; y += 2) {
    let line = "";
    for (let x = 0; x < GLYPH[y].length; x++) {
      const top = GLYPH[y][x] === "#";
      const bottom = GLYPH[y + 1]?.[x] === "#";
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    rows.push(line);
  }
  const text = [c.bold(c.paper("themis")), c.mute(subtitle ?? ""), "", ""];
  console.log();
  rows.forEach((r, i) => console.log(`  ${c.accent(r)}  ${text[i] ?? ""}`));
  console.log();
};

export const ok = (msg, note = "") => console.log(`  ${c.green("✓")} ${msg}${note ? `  ${c.mute(note)}` : ""}`);
export const fail = (msg, note = "") => console.log(`  ${c.red("✗")} ${msg}${note ? `  ${c.mute(note)}` : ""}`);
export const info = (msg) => console.log(`  ${c.mute("·")} ${msg}`);
export const step = (msg) => console.log(`\n  ${c.accent("■")} ${c.bold(msg)}`);

export const pad = (s, n) => {
  const len = String(s).replace(/\x1b\[[0-9;]*m/g, "").length;
  return s + " ".repeat(Math.max(0, n - len));
};

export const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
