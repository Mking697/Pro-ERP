import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync('src/app/globals.css', 'utf8');
function token(name, dark = false) {
  const values = [...css.matchAll(new RegExp(`--${name}: ([^;]+);`, 'g'))].map(m => m[1]);
  return values[dark ? values.length - 1 : 0];
}
const encode = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const decode = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
function rgb(value, dark) {
  if (value.startsWith('var(')) return rgb(token(value.slice(6, -1), dark), dark);
  if (value.startsWith('#')) return value.slice(1).match(/../g).map(x => parseInt(x, 16) / 255);
  const [L, C, h] = value.match(/[\d.]+/g).map(Number);
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621*l-3.3077115913*m+0.2309699292*s, -1.2684380046*l+2.6097574011*m-0.3413193965*s, -0.0041960863*l-0.7034186147*m+1.707614701*s].map(c => Math.max(0, Math.min(1, encode(c))));
}
const luminance = color => color.map(decode).reduce((v, c, i) => v + c * [0.2126, 0.7152, 0.0722][i], 0);
const blend = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1-alpha));
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
for (const dark of [false, true]) {
  test(`normal text contrast on actual surfaces (${dark ? 'dark' : 'light'})`, () => {
    const cases = [];
    for (const surface of ['background', 'card', 'popover', 'muted']) {
      const bg = rgb(token(surface, dark), dark);
      cases.push(['muted-foreground', surface, contrast(rgb(token('muted-foreground', dark), dark), bg)]);
    }
    for (const [variant, tint, foreground, alpha] of [['success', 'chart-good', 'badge-success-foreground', 0.12], ['success-hover', 'chart-good', 'badge-success-foreground', 0.22], ['destructive', 'destructive', 'badge-destructive-foreground', dark ? 0.2 : 0.1], ['destructive-hover', 'destructive', 'badge-destructive-foreground', 0.2]]) {
      for (const surface of ['background', 'card', 'popover', 'muted']) {
        const bg = blend(rgb(token(tint, dark), dark), rgb(token(surface, dark), dark), alpha);
        // Before the fix destructive badges inherited the destructive token itself.
        const fg = rgb(token(foreground, dark) ?? token(tint, dark), dark);
        cases.push([variant, `${surface}+${alpha*100}% tint`, contrast(fg, bg)]);
      }
    }
    for (const [name, surface, ratio] of cases) console.log(`${dark ? 'dark' : 'light'} ${name} / ${surface}: ${ratio.toFixed(2)}:1`);
    assert.deepEqual(cases.filter(([, , ratio]) => ratio < 4.5).map(([name, surface, ratio]) => `${name}/${surface} ${ratio.toFixed(2)}:1`), []);
  });
}
