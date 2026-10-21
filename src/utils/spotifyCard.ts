import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';
import { FONT, encodeAnimation, loadAvatar, roundedRect, scheduleRender, stripEmoji } from './card';

export interface SpotifyCardData {
  title: string;
  artists: string;
  album: string;
  coverUrl: string | null;
  elapsedMs: number;
  totalMs: number;
  listener: string;
}

const WIDTH = 640;
const HEIGHT = 200;
const FRAMES = 14;
const DELAY_MS = 110;

// ---- colour helpers -------------------------------------------------------------------------

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

/** Weighted average of the cover: vivid pixels count more, so the card picks up the album's main colour. */
function dominantHue(cover: Image | null): { h: number; s: number } {
  if (!cover) return { h: 145, s: 0.6 }; // Spotify green fallback
  const size = 16;
  const ctx = createCanvas(size, size).getContext('2d');
  ctx.drawImage(cover, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  let x = 0;
  let y = 0;
  let weightSum = 0;
  let satSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    const w = s * (1 - Math.abs(l - 0.5) * 1.6) + 0.02;
    x += Math.cos((h * Math.PI) / 180) * w;
    y += Math.sin((h * Math.PI) / 180) * w;
    satSum += s * w;
    weightSum += w;
  }
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { h: hue, s: Math.min(0.85, Math.max(0.45, satSum / weightSum)) };
}

const fmt = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function fit(ctx: SKRSContext2D, text: string, maxWidth: number, weight: string, start: number, min: number, family = FONT): string {
  let size = start;
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > min) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  let out = text;
  while (ctx.measureText(out).width > maxWidth && out.length > 1) out = `${out.slice(0, -2)}…`;
  return out;
}

// ---- drawing --------------------------------------------------------------------------------

function draw(ctx: SKRSContext2D, d: SpotifyCardData, cover: Image | null, hue: { h: number; s: number }, t: number): void {
  const ang = t * Math.PI * 2;
  const pastelA = `hsl(${hue.h}, ${Math.round(hue.s * 100)}%, 90%)`;
  const pastelB = `hsl(${(hue.h + 25) % 360}, ${Math.round(hue.s * 70)}%, 97%)`;
  const accent = `hsl(${hue.h}, ${Math.round(Math.min(0.9, hue.s + 0.15) * 100)}%, 48%)`;
  const ink = `hsl(${hue.h}, 35%, 14%)`;
  const soft = `hsla(${hue.h}, 35%, 14%, 0.62)`;

  ctx.save();
  roundedRect(ctx, 0, 0, WIDTH, HEIGHT, 30);
  ctx.clip();

  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, pastelA);
  bg.addColorStop(1, pastelB);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Slow glow behind the cover
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(100 + Math.cos(ang) * 10, 100 + Math.sin(ang) * 8, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const wash = ctx.createLinearGradient(0, 0, 260, 0);
  wash.addColorStop(0, 'rgba(255,255,255,0)');
  wash.addColorStop(1, 'rgba(255,255,255,0.55)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 260, HEIGHT);

  // Cover
  const cx = 26;
  const cy = 24;
  const size = 152;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundedRect(ctx, cx, cy, size, size, 20);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, cx, cy, size, size, 20);
  ctx.clip();
  if (cover) ctx.drawImage(cover, cx, cy, size, size);
  ctx.restore();

  // Text block
  const left = 202;
  const maxW = WIDTH - left - 30;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // "Spotify" tag
  ctx.fillStyle = '#1db954';
  ctx.beginPath();
  ctx.arc(left + 6, 34, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillStyle = soft;
  ctx.fillText('SPOTIFY', left + 18, 39);

  // Dancing equaliser
  const bars = 5;
  for (let i = 0; i < bars; i++) {
    const h = 8 + (Math.sin(ang * 2 + i * 1.3) + 1) * 8;
    ctx.fillStyle = accent;
    roundedRect(ctx, WIDTH - 30 - (bars - i) * 9, 40 - h, 5, h, 2.5);
    ctx.fill();
  }

  ctx.fillStyle = ink;
  ctx.fillText(fit(ctx, d.title, maxW, 'bold', 28, 17), left, 78);
  ctx.fillStyle = soft;
  ctx.fillText(fit(ctx, d.artists, maxW, '500', 19, 13), left, 104);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = `hsla(${hue.h}, 35%, 14%, 0.45)`;
  ctx.fillText(fit(ctx, d.album, maxW, '', 13, 11), left, 126);

  // Progress
  const barX = left;
  const barW = WIDTH - left - 30;
  const barY = 146;
  const ratio = Math.min(1, Math.max(0, d.elapsedMs / Math.max(1, d.totalMs)));
  ctx.fillStyle = `hsla(${hue.h}, 60%, 45%, 0.2)`;
  roundedRect(ctx, barX, barY, barW, 8, 4);
  ctx.fill();
  ctx.save();
  roundedRect(ctx, barX, barY, barW, 8, 4);
  ctx.clip();
  const fill = ctx.createLinearGradient(barX, 0, barX + barW * ratio, 0);
  fill.addColorStop(0, accent);
  fill.addColorStop(1, `hsl(${(hue.h + 20) % 360}, 80%, 55%)`);
  ctx.fillStyle = fill;
  ctx.fillRect(barX, barY, Math.max(8, barW * ratio), 8);
  // Sheen running through the filled part
  const shine = barX + ((t * 2) % 1) * barW * ratio;
  const glow = ctx.createLinearGradient(shine - 30, 0, shine + 30, 0);
  glow.addColorStop(0, 'rgba(255,255,255,0)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(barX, barY, barW * ratio, 8);
  ctx.restore();
  // Knob
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(barX + Math.max(8, barW * ratio) - 2, barY + 4, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = soft;
  ctx.textAlign = 'left';
  ctx.fillText(fmt(d.elapsedMs), barX, 176);
  ctx.textAlign = 'right';
  ctx.fillText(fmt(d.totalMs), barX + barW, 176);
  ctx.textAlign = 'center';
  ctx.fillText(d.listener.slice(0, 24), barX + barW / 2, 176);

  ctx.restore();
}

/** Renders the Spotify "now playing" card. Returns null when the renderer is busy or fails. */
export async function renderSpotifyCard(raw: SpotifyCardData): Promise<AttachmentBuilder | null> {
  const data = { ...raw, title: stripEmoji(raw.title) || raw.title, artists: stripEmoji(raw.artists) || raw.artists, album: stripEmoji(raw.album), listener: stripEmoji(raw.listener) || raw.listener };
  const bytes = await scheduleRender(async () => {
    const cover = await loadAvatar(data.coverUrl);
    const hue = dominantHue(cover);
    return encodeAnimation(WIDTH, HEIGHT, FRAMES, DELAY_MS, (ctx, t) => draw(ctx, data, cover, hue, t));
  });
  return bytes ? new AttachmentBuilder(bytes, { name: 'spotify.gif', description: `${data.title} — ${data.artists}` }) : null;
}
