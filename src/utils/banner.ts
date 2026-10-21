import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

const WIDTH = 720;
const HEIGHT = 230;
const FRAMES = 30;
const DELAY_MS = 70;
const PARTICLES = 34;
const FONT = '"Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif';

/** Deterministic pseudo random so every frame agrees on the particle layout. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const rand = seeded(1337);
const particles = Array.from({ length: PARTICLES }, () => ({
  x: rand() * WIDTH,
  y: rand() * HEIGHT,
  r: 1 + rand() * 2.6,
  speed: 0.4 + rand() * 1.2,
  phase: rand() * Math.PI * 2,
}));

function drawFrame(ctx: SKRSContext2D, t: number, title: string, subtitle: string): void {
  const angle = t * Math.PI * 2;

  // Slowly shifting gradient background
  const shift = (Math.sin(angle) + 1) / 2;
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, `hsl(${255 + shift * 25}, 70%, 14%)`);
  bg.addColorStop(0.5, `hsl(${270 - shift * 20}, 65%, 20%)`);
  bg.addColorStop(1, `hsl(${205 + shift * 30}, 75%, 22%)`);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Glowing orbs
  for (const [cx, cy, hue, phase] of [
    [130, 70, 265, 0],
    [590, 170, 195, 2],
  ] as const) {
    const pulse = 90 + Math.sin(angle + phase) * 18;
    const orb = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse);
    orb.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.45)`);
    orb.addColorStop(1, `hsla(${hue}, 90%, 60%, 0)`);
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Rising particles (they wrap around, so the loop is seamless)
  for (const p of particles) {
    const y = (((p.y - t * p.speed * HEIGHT) % HEIGHT) + HEIGHT) % HEIGHT;
    const x = p.x + Math.sin(angle * 2 + p.phase) * 8;
    ctx.globalAlpha = 0.25 + 0.5 * ((Math.sin(angle * 3 + p.phase) + 1) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Light sweep
  const sweepX = -200 + t * (WIDTH + 400);
  const sweep = ctx.createLinearGradient(sweepX - 90, 0, sweepX + 90, HEIGHT);
  sweep.addColorStop(0, 'rgba(255,255,255,0)');
  sweep.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  sweep.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Title with a pulsing glow
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = `rgba(124, 200, 255, ${0.55 + 0.35 * Math.sin(angle)})`;
  ctx.shadowBlur = 18 + 8 * Math.sin(angle);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 62px ${FONT}`;
  ctx.fillText(title, WIDTH / 2, HEIGHT / 2 - 18);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(226, 232, 255, 0.92)';
  ctx.font = `26px ${FONT}`;
  ctx.fillText(subtitle, WIDTH / 2, HEIGHT / 2 + 40);

  // Animated underline
  const lineWidth = 160 + Math.sin(angle) * 60;
  const line = ctx.createLinearGradient(WIDTH / 2 - lineWidth, 0, WIDTH / 2 + lineWidth, 0);
  line.addColorStop(0, 'rgba(124,92,255,0)');
  line.addColorStop(0.5, 'rgba(77,212,255,1)');
  line.addColorStop(1, 'rgba(124,92,255,0)');
  ctx.fillStyle = line;
  ctx.fillRect(WIDTH / 2 - lineWidth, HEIGHT / 2 + 66, lineWidth * 2, 3);

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);
}

let cached: Promise<Buffer> | null = null;

/** Renders (once) and caches the looping animated banner GIF used by the help embed. */
export function getHelpBanner(title: string, subtitle: string): Promise<Buffer> {
  if (!cached) {
    cached = render(title, subtitle).catch((error: unknown) => {
      cached = null; // allow a retry on the next call
      throw error;
    });
  }
  return cached;
}

async function render(title: string, subtitle: string): Promise<Buffer> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const gif = GIFEncoder();

  for (let i = 0; i < FRAMES; i++) {
    drawFrame(ctx, i / FRAMES, title, subtitle);
    const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const palette = quantize(data, 128);
    gif.writeFrame(applyPalette(data, palette), WIDTH, HEIGHT, { palette, delay: DELAY_MS });
    // Give the event loop room to breathe between frames.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}
