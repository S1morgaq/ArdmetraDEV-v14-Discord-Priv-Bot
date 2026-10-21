import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type Role,
  type User,
} from 'discord.js';
import type { BotClient } from '../client';
import type { Command } from '../types/handlers';

/**
 * Lets every slash command run from a prefix message (".ban @user reason").
 *
 * The arguments are parsed against the command's own option definitions, so a new slash command works with
 * the prefix without any extra code. The command receives a small interaction look-alike (`PrefixInteraction`)
 * that answers with normal channel messages instead of interaction responses.
 */

// Discord's ApplicationCommandOptionType values.
const T = { SUB: 1, GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10 } as const;

interface OptionDef {
  name: string;
  type: number;
  required?: boolean;
  description?: string;
  choices?: { name: string; value: string | number }[];
  min_value?: number;
  max_value?: number;
  max_length?: number;
  options?: OptionDef[];
}

/** Free text options take the rest of the message; every other string takes one (optionally "quoted") word. */
const FREE_TEXT = new Set(['reason', 'text', 'message', 'description', 'content', 'nickname', 'nick', 'title']);

/** Turkish shortcuts for the most used commands. */
export const BRIDGE_ALIASES: Record<string, string> = {
  yasakla: 'ban',
  yasakac: 'unban',
  at: 'kick',
  sustur: 'timeout',
  uyar: 'warn',
  uyarilar: 'warns',
  temizle: 'clear',
  sil: 'clear',
  kilitle: 'lock',
  kilitac: 'unlock',
  yavasmod: 'slowmode',
  kayit: 'register',
  hosgeldin: 'welcome',
  cekilis: 'giveaway',
  rolpanel: 'rolepanel',
  koruma: 'protection',
};

class ParseError extends Error {}

const optionsOf = (command: Command): OptionDef[] => (command.data.toJSON().options ?? []) as unknown as OptionDef[];

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) tokens.push(match[1] ?? match[2]);
  return tokens;
}

// ---- usage text ------------------------------------------------------------------------------------

function fmtOption(o: OptionDef): string {
  const label = o.choices?.length ? o.choices.map((c) => String(c.value)).join('|') : o.name;
  return o.required ? `<${label}>` : `[${label}]`;
}

/** ".ban <user> [reason] [delete_days]" — or ".antinuke <status|toggle|set>" for commands with subcommands. */
export function usageOf(command: Command, prefix: string, sub?: string): string {
  const options = optionsOf(command);
  const subs = options.filter((o) => o.type === T.SUB);
  if (subs.length > 0) {
    const chosen = sub ? subs.find((s) => s.name === sub) : undefined;
    if (chosen) return `${prefix}${command.data.name} ${chosen.name} ${(chosen.options ?? []).map(fmtOption).join(' ')}`.trim();
    return `${prefix}${command.data.name} <${subs.map((s) => s.name).join('|')}>`;
  }
  return `${prefix}${command.data.name} ${options.map(fmtOption).join(' ')}`.trim();
}

/** Every "subcommand usage" line of a command, for the detailed help. */
export function allUsages(command: Command, prefix: string): string[] {
  const subs = optionsOf(command).filter((o) => o.type === T.SUB);
  return subs.length > 0 ? subs.map((s) => usageOf(command, prefix, s.name)) : [usageOf(command, prefix)];
}

// ---- parsing ---------------------------------------------------------------------------------------

interface Resolved {
  value: string | number | boolean | User | Role | GuildBasedChannel;
  member?: GuildMember | null;
}

const idOf = (token: string, kind: '@' | '@&' | '#'): string | null => {
  const m = token.match(new RegExp(`^<${kind === '@' ? '@!?' : kind}(\\d{15,25})>$`)) ?? token.match(/^(\d{15,25})$/);
  return m ? m[1] : null;
};

async function resolve(message: Message<true>, def: OptionDef, token: string): Promise<Resolved | undefined> {
  switch (def.type) {
    case T.STRING: {
      if (def.choices?.length) {
        const wanted = token.toLowerCase();
        const choice = def.choices.find((c) => String(c.value).toLowerCase() === wanted || c.name.toLowerCase() === wanted);
        return choice ? { value: choice.value } : undefined;
      }
      if (def.max_length && token.length > def.max_length) throw new ParseError(`"${def.name}" can be at most ${def.max_length} characters.`);
      return { value: token };
    }
    case T.INTEGER:
    case T.NUMBER: {
      if (!(def.type === T.INTEGER ? /^-?\d+$/ : /^-?\d+([.,]\d+)?$/).test(token)) return undefined;
      const n = Number(token.replace(',', '.'));
      if ((def.min_value !== undefined && n < def.min_value) || (def.max_value !== undefined && n > def.max_value)) {
        throw new ParseError(`"${def.name}" must be between ${def.min_value ?? '-∞'} and ${def.max_value ?? '∞'}.`);
      }
      return { value: n };
    }
    case T.BOOLEAN: {
      const t = token.toLowerCase();
      if (['true', 'yes', 'on', '1', 'evet', 'ac', 'aç', 'aktif'].includes(t)) return { value: true };
      if (['false', 'no', 'off', '0', 'hayir', 'hayır', 'kapat', 'kapali', 'kapalı'].includes(t)) return { value: false };
      return undefined;
    }
    case T.USER: {
      const id = idOf(token, '@');
      if (!id) return undefined;
      const user = await message.client.users.fetch(id).catch(() => null);
      if (!user) return undefined;
      const member = message.guild.members.cache.get(id) ?? (await message.guild.members.fetch(id).catch(() => null));
      return { value: user, member };
    }
    case T.ROLE: {
      const id = idOf(token, '@&');
      const role = id ? message.guild.roles.cache.get(id) : undefined;
      return role ? { value: role } : undefined;
    }
    case T.CHANNEL: {
      const id = idOf(token, '#');
      const channel = id ? message.guild.channels.cache.get(id) : undefined;
      return channel ? { value: channel } : undefined;
    }
    default:
      return undefined;
  }
}

async function parseOptions(message: Message<true>, defs: OptionDef[], tokensIn: string[]): Promise<Map<string, Resolved>> {
  const values = new Map<string, Resolved>();
  const named = new Map<string, string>();
  const tokens: string[] = [];
  for (const token of tokensIn) {
    const m = token.match(/^([a-z_0-9]+):(.+)$/);
    if (m && defs.some((d) => d.name === m[1])) named.set(m[1], m[2]);
    else tokens.push(token);
  }

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const explicit = named.get(def.name);
    if (explicit !== undefined) {
      const resolved = await resolve(message, def, explicit);
      if (!resolved) throw new ParseError(`"${def.name}" is not valid.`);
      values.set(def.name, resolved);
      continue;
    }
    if (tokens.length === 0) {
      if (def.required) throw new ParseError(`"${def.name}" is missing.`);
      continue;
    }

    const later = defs.slice(i + 1).filter((d) => !named.has(d.name));
    const laterRequired = later.some((d) => d.required);
    if (def.type === T.STRING && !def.choices?.length && FREE_TEXT.has(def.name) && !laterRequired) {
      // Free text: everything left, except trailing words that clearly belong to later options ("... spam 3").
      const rest = tokens.splice(0, tokens.length);
      const peeled: [OptionDef, Resolved][] = [];
      for (let j = later.length - 1; j >= 0 && rest.length > 1; j--) {
        if (later[j].type === T.STRING) continue;
        const hit = await resolve(message, later[j], rest[rest.length - 1]).catch(() => undefined);
        if (hit) {
          rest.pop();
          peeled.push([later[j], hit]);
        }
      }
      const text = rest.join(' ');
      if (text.length > (def.max_length ?? Infinity)) throw new ParseError(`"${def.name}" can be at most ${def.max_length} characters.`);
      values.set(def.name, { value: text });
      for (const [d, v] of peeled) values.set(d.name, v);
      continue;
    }

    const resolved = await resolve(message, def, tokens[0]);
    if (resolved) {
      values.set(def.name, resolved);
      tokens.shift();
    } else if (def.required) {
      throw new ParseError(`"${def.name}" is not valid: ${tokens[0]}`);
    }
  }
  return values;
}

// ---- the interaction look-alike ----------------------------------------------------------------------

class PrefixOptions {
  constructor(
    private readonly sub: string | null,
    private readonly values: Map<string, Resolved>,
  ) {}

  getSubcommand(required = true): string | null {
    if (!this.sub && required) throw new Error('No subcommand');
    return this.sub;
  }

  private raw(name: string, required?: boolean): Resolved | null {
    const v = this.values.get(name) ?? null;
    if (!v && required) throw new Error(`Required option "${name}" is missing`);
    return v;
  }

  getString(name: string, required?: boolean): string | null {
    const v = this.raw(name, required);
    return v ? String(v.value) : null;
  }
  getInteger(name: string, required?: boolean): number | null {
    const v = this.raw(name, required);
    return v ? Number(v.value) : null;
  }
  getNumber(name: string, required?: boolean): number | null {
    return this.getInteger(name, required);
  }
  getBoolean(name: string, required?: boolean): boolean | null {
    const v = this.raw(name, required);
    return v ? Boolean(v.value) : null;
  }
  getUser(name: string, required?: boolean): User | null {
    return (this.raw(name, required)?.value as User | undefined) ?? null;
  }
  getMember(name: string): GuildMember | null {
    return this.values.get(name)?.member ?? null;
  }
  getRole(name: string, required?: boolean): Role | null {
    return (this.raw(name, required)?.value as Role | undefined) ?? null;
  }
  getChannel(name: string, required?: boolean): GuildBasedChannel | null {
    return (this.raw(name, required)?.value as GuildBasedChannel | undefined) ?? null;
  }
  getAttachment(): null {
    return null;
  }
}

const EPHEMERAL_LIFETIME_MS = 20_000;

/** Only the parts of ChatInputCommandInteraction that the commands use. Replies are ordinary messages. */
class PrefixInteraction {
  readonly options: PrefixOptions;
  readonly user: User;
  readonly member: GuildMember | null;
  readonly guild;
  readonly guildId: string;
  readonly channel;
  readonly channelId: string;
  readonly client;
  readonly memberPermissions;
  readonly commandName: string;
  deferred = false;
  replied = false;
  private sent: Message | null = null;

  constructor(
    private readonly message: Message<true>,
    commandName: string,
    options: PrefixOptions,
  ) {
    this.options = options;
    this.user = message.author;
    this.member = message.member;
    this.guild = message.guild;
    this.guildId = message.guildId;
    this.channel = message.channel;
    this.channelId = message.channelId;
    this.client = message.client;
    this.memberPermissions = message.member?.permissions ?? null;
    this.commandName = commandName;
  }

  get appPermissions() {
    const me = this.guild.members.me;
    return me ? this.message.channel.permissionsFor(me) : null;
  }

  isChatInputCommand(): boolean {
    return true;
  }
  inCachedGuild(): boolean {
    return true;
  }

  async deferReply(): Promise<void> {
    this.deferred = true;
    await this.message.channel.sendTyping().catch(() => undefined);
  }

  /** Slash-only fields are dropped; prefix replies cannot be ephemeral, so those are short-lived instead. */
  private clean(input: unknown, forEdit: boolean): { payload: Record<string, unknown>; ephemeral: boolean } {
    const source = (typeof input === 'string' ? { content: input } : { ...(input as Record<string, unknown>) }) as Record<string, unknown>;
    const flags = source.flags;
    const ephemeral = source.ephemeral === true || (typeof flags === 'number' && (flags & MessageFlags.Ephemeral) !== 0);
    for (const key of ['flags', 'ephemeral', 'fetchReply', 'withResponse']) delete source[key];
    if (!forEdit) delete source.attachments;
    source.allowedMentions = { parse: [], repliedUser: false, ...((source.allowedMentions as object | undefined) ?? {}) };
    return { payload: source, ephemeral };
  }

  private forget(message: Message, ephemeral: boolean): void {
    if (ephemeral) setTimeout(() => void message.delete().catch(() => undefined), EPHEMERAL_LIFETIME_MS).unref();
  }

  async reply(input: unknown): Promise<Message> {
    this.replied = true;
    const { payload, ephemeral } = this.clean(input, false);
    // The command message may be gone already (".clear" deletes it): then answer in the channel instead of replying.
    const sent = await this.message.reply(payload as never).catch((error: unknown) => {
      if ((error as { code?: number }).code !== 50035) throw error;
      return this.message.channel.send(payload as never);
    });
    this.sent = sent;
    this.forget(sent, ephemeral);
    return sent;
  }

  async editReply(input: unknown): Promise<Message> {
    if (!this.sent) return this.reply(input);
    const { payload } = this.clean(input, true);
    this.sent = await this.sent.edit(payload as never);
    return this.sent;
  }

  async followUp(input: unknown): Promise<Message> {
    const { payload, ephemeral } = this.clean(input, false);
    const sent = await this.message.channel.send(payload as never);
    this.forget(sent, ephemeral);
    return sent;
  }

  async deleteReply(): Promise<void> {
    await this.sent?.delete().catch(() => undefined);
  }
}

// ---- entry point -------------------------------------------------------------------------------------

export interface BridgeOutcome {
  /** A message to show the user (error / usage) — the caller sends it as a short-lived reply. */
  error?: string;
}

/** Parses the arguments and runs the slash command. Resolves with an error text when the input is unusable. */
export async function runSlashAsPrefix(message: Message<true>, command: Command, args: string, client: BotClient, prefix: string): Promise<BridgeOutcome> {
  const defs = optionsOf(command);
  const tokens = tokenize(args);
  let sub: string | null = null;
  let active = defs;

  const subs = defs.filter((d) => d.type === T.SUB);
  if (subs.length > 0) {
    const wanted = (tokens.shift() ?? '').toLowerCase();
    const found = subs.find((s) => s.name === wanted);
    if (!found) return { error: `Usage: \`${usageOf(command, prefix)}\`` };
    sub = found.name;
    active = found.options ?? [];
  }

  let values: Map<string, Resolved>;
  try {
    values = await parseOptions(message, active, tokens);
  } catch (error) {
    if (error instanceof ParseError) return { error: `${error.message}\nUsage: \`${usageOf(command, prefix, sub ?? undefined)}\`` };
    throw error;
  }

  const interaction = new PrefixInteraction(message, command.data.name, new PrefixOptions(sub, values));
  await command.execute(interaction as unknown as ChatInputCommandInteraction<'cached'>, client);
  return {};
}
