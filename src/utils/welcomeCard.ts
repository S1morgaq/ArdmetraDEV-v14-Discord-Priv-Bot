import { type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';
import { FONT, encodeAnimation, loadAvatar, roundedRect, scheduleRender, stripEmoji } from './card';

export interface WelcomeCardData {
  mode: 'welcome' | 'goodbye';
  name: string;
  server: string;
  /** Member position ("#128") shown as a pill. */
  count: number;
  avatarUrl: string | null;
}

const WIDTH = 720;
const HEIGHT = 240;
const FRAMES = 16;
const DELAY_MS = 100;

const THEME = {
  welcome: { hue: 262, headline: 'WELCOME', line: 'joined the server' },
  goodbye: { hue: 12, headline: 'GOODBYE', line: 'left the server' },
} as const;

function fit(ctx: SKRSContext2D, text: string, maxWidth: number, weight: string, start: number, min: number): string {
  let size = start;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (ctx.measureText(text).width > maxWidth && size > min) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  let out = text;
  while (ctx.measureText(out).width > maxWidth && out.length > 1) out = `${out.slice(0, -2)}…`;
  return out;
}

function draw(ctx: SKRSContext2D, d: WelcomeCardData, avatar: Image | null, t: number): void {
  const { hue, headline, line } = THEME[d.mode];
  const ang = t * Math.PI * 2;
  const accent = `hsl(${hue}, 78%, 56%)`;
  const accent2 = `hsl(${(hue + 55) % 360}, 85%, 66%)`;
  const ink = `hsl(${hue}, 40%, 16%)`;
  const soft = `hsla(${hue}, 35%, 16%, 0.6)`;

  ctx.save();
  roundedRect(ctx, 0, 0, WIDTH, HEIGHT, 32);
  ctx.clip();

  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, `hsl(${hue}, 85%, 91%)`);
  bg.addColorStop(0.55, `hsl(${(hue + 30) % 360}, 80%, 94%)`);
  bg.addColorStop(1, `hsl(${(hue + 60) % 360}, 85%, 90%)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Soft drifting blobs
  for (let i = 0; i < 3; i++) {
    const phase = ang + i * 2.1;
    const x = 120 + i * 260 + Math.cos(phase) * 30;
    const y = 120 + Math.sin(phase * 1.3) * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 120);
    g.addColorStop(0, `hsla(${(hue + i * 40) % 360}, 90%, 70%, 0.35)`);
    g.addColorStop(1, `hsla(${(hue + i * 40) % 360}, 90%, 70%, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Rising bubbles (each loops once per animation cycle so the GIF is seamless)
  for (let i = 0; i < 14; i++) {
    const seed = (i * 0.6180339) % 1;
    const rise = (t + seed) % 1;
    const x = 30 + ((i * 53) % (WIDTH - 60)) + Math.sin(ang + i) * 8;
    const y = HEIGHT + 10 - rise * (HEIGHT + 30);
    const r = 3 + (i % 4) * 2;
    ctx.globalAlpha = Math.sin(rise * Math.PI) * 0.55;
    ctx.fillStyle = i % 2 ? accent : accent2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Avatar with spinning gradient ring
  const cx = 128;
  const cy = 120;
  const radius = 68;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  const ring = ctx.createLinearGradient(-radius, -radius, radius, radius);
  ring.addColorStop(0, accent);
  ring.addColorStop(0.5, accent2);
  ring.addColorStop(1, accent);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 7;
  ctx.setLineDash([46, 14]);
  ctx.beginPath();
  ctx.arc(0, 0, radius + 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  // Text
  const left = 240;
  const maxW = WIDTH - left - 36;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `bold 16px ${FONT}`;
  const shimmer = ctx.createLinearGradient(left + ((t * 2) % 1) * 260 - 80, 0, left + ((t * 2) % 1) * 260 + 80, 0);
  shimmer.addColorStop(0, accent);
  shimmer.addColorStop(0.5, accent2);
  shimmer.addColorStop(1, accent);
  ctx.fillStyle = shimmer;
  ctx.fillText(headline.split('').join(' '), left, 76);

  ctx.fillStyle = ink;
  ctx.fillText(fit(ctx, d.name, maxW, 'bold', 40, 20), left, 124);

  ctx.fillStyle = soft;
  ctx.fillText(fit(ctx, `${line} · ${d.server}`, maxW, '500', 18, 12), left, 152);

  // Member-count pill
  const label = d.mode === 'welcome' ? `Member #${d.count}` : `${d.count} members left`;
  ctx.font = `bold 15px ${FONT}`;
  const pillW = ctx.measureText(label).width + 32;
  roundedRect(ctx, left, 172, pillW, 32, 16);
  const pill = ctx.createLinearGradient(left, 0, left + pillW, 0);
  pill.addColorStop(0, accent);
  pill.addColorStop(1, accent2);
  ctx.fillStyle = pill;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, left + 16, 193);

  ctx.restore();
}

/** Renders the animated welcome / goodbye card. Returns null when the renderer is busy or fails. */
export async function renderWelcomeCard(raw: WelcomeCardData): Promise<AttachmentBuilder | null> {
  const data = { ...raw, name: stripEmoji(raw.name) || raw.name.replace(/[^\x20-\x7E]/g, '') || 'New member', server: stripEmoji(raw.server) || 'the server' };
  const bytes = await scheduleRender(async () => {
    const avatar = await loadAvatar(data.avatarUrl);
    return encodeAnimation(WIDTH, HEIGHT, FRAMES, DELAY_MS, (ctx, t) => draw(ctx, data, avatar, t));
  });
  return bytes ? new AttachmentBuilder(bytes, { name: `${data.mode}.gif`, description: `${data.name} — ${THEME[data.mode].headline}` }) : null;
}
