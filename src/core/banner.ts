import { config } from '../config';

export interface BannerInfo {
  license: boolean;
  database: boolean;
  discord: boolean;
  dashboardUrl: string;
  pm2: boolean;
}

/** Prints the boxed startup summary to stdout (PM2 captures it in out.log). */
export function printBanner(info: BannerInfo): void {
  const width = 40;
  const line = (text: string) => `║ ${text.padEnd(width - 2).slice(0, width - 2)} ║`;
  const state = (ok: boolean, yes: string, no: string) => (ok ? yes : no);
  const title = `PRIV BOT v${config.version}`;
  const rows = [
    `╔${'═'.repeat(width)}╗`,
    `║${title.padStart(Math.floor((width + title.length) / 2)).padEnd(width)}║`,
    `╠${'═'.repeat(width)}╣`,
    line(`License   : ${state(info.license, 'VALID', 'INVALID')}`),
    line(`Database  : ${state(info.database, 'CONNECTED', 'DISCONNECTED')}`),
    line(`Discord   : ${state(info.discord, 'CONNECTED', 'DISCONNECTED')}`),
    line(`Dashboard : ${info.dashboardUrl}`),
    line(`PM2       : ${state(info.pm2, 'RUNNING UNDER PM2', 'READY')}`),
    `╚${'═'.repeat(width)}╝`,
  ];
  console.log(`\n${rows.join('\n')}\n`);
}
