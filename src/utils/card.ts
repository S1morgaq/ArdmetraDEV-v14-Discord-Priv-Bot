import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { AttachmentBuilder, type EmbedBuilder } from 'discord.js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { IconKind } from './statusIcons';
import { errorMessage, logger } from './logger';

export const FONT = '"Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif';

// ---------------------------------------------------------------------------------------------
// Shared helpers: bounded render queue + transparent animated GIF encoder
// ---------------------------------------------------------------------------------------------

const MAX_PENDING = 3;
let pending = 0;
let tail: Promise<unknown> = Promise.resolve();

/**
 * Rendering is CPU work: one image at a time, and when more than a few are waiting (an attack producing
 * hundreds of logs) the extra ones are skipped (null) so callers fall back to a plain embed.
 */
export async function scheduleRender<T>(job: () => Promise<T>): Promise<T | null> {
  if (pending >= MAX_PENDING) return null;
  pending++;
  try {
    const run = tail.then(job);
    tail = run.catch(() => undefined);
    return await run;
  } catch (error) {
    logger.warn(`[CARD] Render failed: ${errorMessage(error)}`);
    return null;
  } finally {
    pending--;
  }
}

/** Encodes a looping GIF with a transparent background (rounded card corners stay see-through). */
export async function encodeAnimation(
  width: number,
  height: number,
  frames: number,
  delayMs: number,
  draw: (ctx: SKRSContext2D, t: number) => void,
): Promise<Buffer> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const gif = GIFEncoder();
  for (let i = 0; i < frames; i++) {
    ctx.clearRect(0, 0, width, height);
    draw(ctx, i / frames);
    const { data } = ctx.getImageData(0, 0, width, height);
    // 255 real colours (rgb565 keeps pastel gradients smooth) + 1 reserved transparent entry.
    const palette = quantize(data, 255, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    for (let p = 0; p < index.length; p++) if (data[p * 4 + 3] < 110) index[p] = 255;
    while (palette.length < 255) palette.push([0, 0, 0]);
    palette.push([0, 0, 0]);
    gif.writeFrame(index, width, height, { palette, delay: delayMs, transparent: true, transparentIndex: 255, dispose: 2 });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

const emojiRe = /(?:[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2B00-\u2BFF]|\uFE0F|\u200D)+/g;

/** Canvas fonts cannot draw colour emoji (they show up as empty boxes), so cards use emoji-free text. */
export function stripEmoji(text: string): string {
  return text.replace(emojiRe, '').replace(/\s{2,}/g, ' ').trim();
}
export async function loadAvatar(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null;
  try {
    return await Promise.race([
      loadImage(url.replace(/\.gif(\?|$)/, '.png$1')),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('avatar timeout')), 3000)),
    ]);
  } catch {
    return null;
  }
}

/** Wraps text into at most `maxLines` lines; `truncated` tells whether text had to be cut. */
export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
    } else if (lines.length + 1 < maxLines) {
      lines.push(line);
      line = words[i];
    } else {
      break;
    }
  }
  if (line) lines.push(line);
  let truncated = i < words.length;
  const last = lines.length - 1;
  if (last >= 0) {
    let value = truncated ? `${lines[last]}…` : lines[last];
    while (ctx.measureText(value).width > maxWidth && value.length > 2) {
      truncated = true;
      value = `${value.slice(0, -2)}…`;
    }
    lines[last] = value;
  }
  return { lines, truncated };
}

export function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------------------------
// Panel card (confirmations, errors, logs, info lists)
// ---------------------------------------------------------------------------------------------

export type CardKind = IconKind;

export interface CardRow {
  label: string;
  value: string;
}

export interface CardOptions {
  kind: CardKind;
  /** Small pill above the title, e.g. "PROTECTION". */
  chip: string;
  title: string;
  text?: string;
  rows?: CardRow[];
  avatarUrl?: string | null;
  /** Keep the embed even when the card could replace it (embeds with live-updating text). */
  keepEmbed?: boolean;
}

const WIDTH = 640;
const PAD = 28;
const ROW_H = 30;
const MAX_ROWS = 10;
const FRAMES = 16;
const DELAY_MS = 90;

const THEMES: Record<CardKind, { a: string; b: string; accent: string; ink: string }> = {
  ok: { a: '#e3faee', b: '#d6f3fb', accent: '#17b26a', ink: '#12261c' },
  error: { a: '#ffe5e9', b: '#ffeedd', accent: '#e5384f', ink: '#2b1216' },
  info: { a: '#e6edff', b: '#e0f4ff', accent: '#4a6cf7', ink: '#141a33' },
  shield: { a: '#ede6ff', b: '#e0f1ff', accent: '#7a4dff', ink: '#1c1433' },
  warn: { a: '#fff0da', b: '#fff8c9', accent: '#f08c00', ink: '#2e2008' },
  star: { a: '#e0f7ff', b: '#f5e4ff', accent: '#a03bff', ink: '#211433' },
};

interface Layout {
  height: number;
  lines: string[];
  rows: CardRow[];
  fits: boolean;
}

function computeLayout(options: CardOptions): Layout {
  const ctx = createCanvas(10, 10).getContext('2d');
  const textX = 140;
  const maxW = WIDTH - textX - PAD;

  let lines: string[] = [];
  let truncated = false;
  if (options.text) {
    ctx.font = `16px ${FONT}`;
    ({ lines, truncated } = wrapText(ctx, options.text, maxW, 2));
  }

  const allRows = options.rows ?? [];
  let rowsFit = allRows.length <= MAX_ROWS;
  ctx.font = `17px ${FONT}`;
  const valueMaxW = WIDTH - 180 - PAD;
  const rows = allRows.slice(0, MAX_ROWS).map((r) => {
    let value = r.value.replace(/\s+/g, ' ').trim();
    if (ctx.measureText(value).width > valueMaxW) {
      rowsFit = false;
      while (ctx.measureText(`${value}…`).width > valueMaxW && value.length > 1) value = value.slice(0, -1);
      value = `${value}…`;
    }
    return { label: r.label, value };
  });

  const headerBottom = Math.max(124, 112 + lines.length * 22 + 8);
  const height = headerBottom + (rows.length > 0 ? 6 + rows.length * ROW_H + 14 : 14);
  return { height, lines, rows, fits: !truncated && rowsFit && !options.keepEmbed };
}

function drawPanel(ctx: SKRSContext2D, o: CardOptions, layout: Layout, avatar: Image | null, t: number): void {
  const theme = THEMES[o.kind];
  const ang = t * Math.PI * 2;
  const H = layout.height;

  ctx.save();
  roundedRect(ctx, 0, 0, WIDTH, H, 28);
  ctx.clip();

  // Pastel gradient
  const bg = ctx.createLinearGradient(0, 0, WIDTH, H);
  bg.addColorStop(0, theme.a);
  bg.addColorStop(1, theme.b);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, H);

  // Soft drifting bubbles
  const bubbles: [number, number, number, number, number][] = [
    [520, 40, 90, 0, 0.35],
    [610, H - 30, 70, 2.2, 0.28],
    [70, H - 10, 80, 4.1, 0.22],
  ];
  for (const [bx, by, r, ph, alpha] of bubbles) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(bx + Math.cos(ang + ph) * 14, by + Math.sin(ang + ph) * 10, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(WIDTH - 40 + Math.sin(ang) * 8, 30, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Shimmer sweep
  const sweepX = -160 + t * (WIDTH + 320);
  const sweep = ctx.createLinearGradient(sweepX - 70, 0, sweepX + 70, H);
  sweep.addColorStop(0, 'rgba(255,255,255,0)');
  sweep.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  sweep.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, WIDTH, H);

  // Avatar with rotating dashed ring
  const cx = PAD + 46;
  const cy = 28 + 46;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a0 = ang + (i / 12) * Math.PI * 2;
    ctx.globalAlpha = 0.35 + 0.65 * (i / 12);
    ctx.beginPath();
    ctx.arc(cx, cy, 52, a0, a0 + 0.36);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, cx - 44, cy - 44, 88, 88);
  } else {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(cx - 44, cy - 44, 88, 88);
    drawGlyph(ctx, o.kind, cx, cy, t);
  }
  ctx.restore();

  // Chip + title + text
  const textX = 140;
  const maxW = WIDTH - textX - PAD;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 12px ${FONT}`;
  const chipText = o.chip.toUpperCase().slice(0, 28);
  const chipW = ctx.measureText(chipText).width + 20;
  ctx.fillStyle = theme.accent;
  roundedRect(ctx, textX, 26, chipW, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(chipText, textX + 10, 41);

  let size = 27;
  ctx.font = `bold ${size}px ${FONT}`;
  while (ctx.measureText(o.title).width > maxW && size > 16) {
    size -= 1;
    ctx.font = `bold ${size}px ${FONT}`;
  }
  ctx.fillStyle = theme.ink;
  let title = o.title;
  while (ctx.measureText(title).width > maxW && title.length > 1) title = `${title.slice(0, -2)}…`;
  ctx.fillText(title, textX, 78);

  ctx.font = `16px ${FONT}`;
  ctx.fillStyle = `${theme.ink}b3`;
  layout.lines.forEach((line, i) => ctx.fillText(line, textX, 104 + i * 22));

  // Rows
  const headerBottom = Math.max(124, 112 + layout.lines.length * 22 + 8);
  layout.rows.forEach((row, i) => {
    const y = headerBottom + 6 + i * ROW_H;
    ctx.fillStyle = `${theme.ink}14`;
    ctx.fillRect(PAD, y, WIDTH - PAD * 2, 1);
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillStyle = `${theme.ink}88`;
    ctx.fillText(row.label.toUpperCase().slice(0, 16), PAD, y + 20);
    ctx.font = `17px ${FONT}`;
    ctx.fillStyle = theme.ink;
    ctx.fillText(row.value, 180, y + 20);
  });

  // Bottom accent line that travels
  const barX = ((t * (WIDTH + 240)) % (WIDTH + 240)) - 240;
  const bar = ctx.createLinearGradient(barX, 0, barX + 240, 0);
  bar.addColorStop(0, `${theme.accent}00`);
  bar.addColorStop(0.5, theme.accent);
  bar.addColorStop(1, `${theme.accent}00`);
  ctx.fillStyle = bar;
  ctx.fillRect(0, H - 4, WIDTH, 4);
  ctx.restore();
}

/** Simple vector symbol inside the badge when there is no avatar. */
function drawGlyph(ctx: SKRSContext2D, kind: CardKind, cx: number, cy: number, t: number): void {
  const pulse = 1 + Math.sin(t * Math.PI * 2) * 0.06;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pulse * 1.5, pulse * 1.5);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (kind) {
    case 'ok':
      ctx.moveTo(-14, 1);
      ctx.lineTo(-4, 11);
      ctx.lineTo(15, -10);
      ctx.stroke();
      break;
    case 'error':
      ctx.moveTo(-12, -12);
      ctx.lineTo(12, 12);
      ctx.moveTo(12, -12);
      ctx.lineTo(-12, 12);
      ctx.stroke();
      break;
    case 'warn':
      ctx.moveTo(0, -17);
      ctx.lineTo(0, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 15, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'info':
      ctx.arc(0, -14, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.lineTo(0, 16);
      ctx.stroke();
      break;
    case 'shield':
      ctx.moveTo(0, -19);
      ctx.lineTo(16, -12);
      ctx.lineTo(16, 3);
      ctx.quadraticCurveTo(14, 13, 0, 19);
      ctx.quadraticCurveTo(-14, 13, -16, 3);
      ctx.lineTo(-16, -12);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 19 : 8;
        const a = -Math.PI / 2 + (i * Math.PI) / 5 + t * 0.6;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

export interface CardPayload {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  /** The animated card was produced. */
  rendered: boolean;
  /** The card replaced the embed completely (nothing else to show). */
  imageOnly: boolean;
}

const stripRe = /<a?:\w+:\d+>|<t:\d+(?::\w)?>/g;

/**
 * Renders the animated pastel card. When everything fits on the picture the embed is dropped entirely
 * (the card *is* the message); otherwise the embed is kept below it for the details that do not fit.
 */
export async function withCard(embed: EmbedBuilder, options: CardOptions): Promise<CardPayload> {
  // Data shown as rows: explicit rows, or the embed's own simple one-line fields.
  let opts = options;
  let derived = false;
  if (!options.rows) {
    const fields = embed.data.fields ?? [];
    const simple = fields.every((f) => !f.value.includes('\n') && !/<@|<#|<t:/.test(f.value));
    opts = {
      ...options,
      rows: simple ? fields.map((f) => ({ label: f.name, value: f.value.replace(stripRe, '').replace(/[*_`~|]/g, '') })) : [],
      keepEmbed: options.keepEmbed || !simple,
    };
    derived = simple && fields.length > 0;
  }

  opts = {
    ...opts,
    chip: stripEmoji(opts.chip),
    title: stripEmoji(opts.title) || opts.title,
    text: opts.text ? stripEmoji(opts.text) : undefined,
    rows: opts.rows?.map((r) => ({ label: stripEmoji(r.label), value: stripEmoji(r.value) })),
  };

  const layout = computeLayout(opts);
  const bytes = await scheduleRender(async () => {
    const avatar = await loadAvatar(opts.avatarUrl);
    return encodeAnimation(WIDTH, layout.height, FRAMES, DELAY_MS, (ctx, t) => drawPanel(ctx, opts, layout, avatar, t));
  });
  if (!bytes) return { embeds: [embed], files: [], rendered: false, imageOnly: false };

  const alt = [opts.title, opts.text, ...(opts.rows ?? []).map((r) => `${r.label}: ${r.value}`)].filter(Boolean).join('. ').slice(0, 1000);
  const file = new AttachmentBuilder(bytes, { name: 'card.gif', description: alt });
  if (layout.fits) return { embeds: [], files: [file], rendered: true, imageOnly: true };

  embed.setTitle(null);
  if (derived) embed.spliceFields(0, 25);
  embed.setImage('attachment://card.gif');
  return { embeds: [embed], files: [file], rendered: true, imageOnly: false };
}
