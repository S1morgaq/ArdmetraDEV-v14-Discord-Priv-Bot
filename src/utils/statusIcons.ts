import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { AttachmentBuilder, type EmbedBuilder } from 'discord.js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { errorMessage, logger } from './logger';

export type IconKind = 'ok' | 'error' | 'info' | 'shield' | 'warn' | 'star';

interface IconStyle {
  color: [number, number, number];
  symbol: 'check' | 'cross' | 'info' | 'exclaim' | 'shield' | 'star';
}

const STYLES: Record<IconKind, IconStyle> = {
  ok: { color: [46, 204, 113], symbol: 'check' },
  error: { color: [255, 71, 87], symbol: 'cross' },
  info: { color: [114, 137, 218], symbol: 'info' },
  shield: { color: [124, 92, 255], symbol: 'shield' },
  warn: { color: [245, 166, 35], symbol: 'exclaim' },
  star: { color: [77, 212, 255], symbol: 'star' },
};

const SIZE = 96;
const FRAMES = 22;
const DELAY_MS = 60;
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function drawSymbol(ctx: SKRSContext2D, symbol: IconStyle['symbol'], t: number): void {
  const pulse = 1 + Math.sin(t * Math.PI * 2) * 0.05;
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  if (symbol === 'cross') ctx.translate(Math.sin(t * Math.PI * 6) * (t < 0.5 ? 2.5 : 0), 0); // little shake
  ctx.scale(pulse, pulse);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (symbol) {
    case 'check': {
      // The tick draws itself during the first 45% of the loop, then stays.
      const p = Math.min(1, t / 0.45);
      const a = { x: -14, y: 1 };
      const b = { x: -4, y: 11 };
      const c = { x: 15, y: -10 };
      const first = Math.min(1, p / 0.33);
      const second = Math.max(0, (p - 0.33) / 0.67);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * first, a.y + (b.y - a.y) * first);
      if (second > 0) ctx.lineTo(b.x + (c.x - b.x) * second, b.y + (c.y - b.y) * second);
      ctx.stroke();
      break;
    }
    case 'cross':
      ctx.beginPath();
      ctx.moveTo(-12, -12);
      ctx.lineTo(12, 12);
      ctx.moveTo(12, -12);
      ctx.lineTo(-12, 12);
      ctx.stroke();
      break;
    case 'info':
      ctx.beginPath();
      ctx.arc(0, -14, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(0, 16);
      ctx.stroke();
      break;
    case 'exclaim':
      ctx.beginPath();
      ctx.moveTo(0, -17);
      ctx.lineTo(0, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 15, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(0, -19);
      ctx.lineTo(16, -12);
      ctx.lineTo(16, 3);
      ctx.quadraticCurveTo(14, 13, 0, 19);
      ctx.quadraticCurveTo(-14, 13, -16, 3);
      ctx.lineTo(-16, -12);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? 19 : 8;
        const angle = -Math.PI / 2 + (i * Math.PI) / 5 + t * 0.6 - 0.3;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function drawFrame(ctx: SKRSContext2D, style: IconStyle, t: number): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  const angle = t * Math.PI * 2;
  const c = SIZE / 2;

  // Expanding ripple
  ctx.strokeStyle = rgba(style.color, (1 - t) * 0.55);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, 34 + t * 12, 0, Math.PI * 2);
  ctx.stroke();

  // Breathing disc with a soft glow
  const radius = 34 + Math.sin(angle) * 1.6;
  const glow = ctx.createRadialGradient(c, c, 4, c, c, radius + 6);
  glow.addColorStop(0, rgba(style.color, 1));
  glow.addColorStop(0.85, rgba(style.color, 0.9));
  glow.addColorStop(1, rgba(style.color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(c, c, radius + 6, 0, Math.PI * 2);
  ctx.fill();

  drawSymbol(ctx, style.symbol, t);
}

async function render(kind: IconKind): Promise<Buffer> {
  const style = STYLES[kind];
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const gif = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    drawFrame(ctx, style, i / FRAMES);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const palette = quantize(data, 64, { format: 'rgba4444' });
    const index = applyPalette(data, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((entry) => entry[3] === 0);
    gif.writeFrame(index, SIZE, SIZE, {
      palette,
      delay: DELAY_MS,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2, // clear between frames so the ripple does not leave trails
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

const cache = new Map<IconKind, Promise<Buffer>>();

function getIcon(kind: IconKind): Promise<Buffer> {
  let pending = cache.get(kind);
  if (!pending) {
    pending = render(kind).catch((error: unknown) => {
      cache.delete(kind); // retry next time
      throw error;
    });
    cache.set(kind, pending);
  }
  return pending;
}

export interface IconPayload {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
}

/**
 * Adds a small animated (looping GIF) icon as the embed thumbnail. Icons are rendered once with canvas and
 * cached in memory (~30 KB each). If rendering ever fails the embed is sent as-is.
 */
export async function withIcon(embed: EmbedBuilder, kind: IconKind): Promise<IconPayload> {
  try {
    const buffer = await getIcon(kind);
    embed.setThumbnail(`attachment://${kind}.gif`);
    return { embeds: [embed], files: [new AttachmentBuilder(buffer, { name: `${kind}.gif` })] };
  } catch (error) {
    logger.warn(`[ICONS] Could not render the "${kind}" icon: ${errorMessage(error)}`);
    return { embeds: [embed], files: [] };
  }
}
