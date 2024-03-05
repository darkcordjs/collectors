import {
  API,
  AutocompleteInteraction,
  type Awaitable,
  Cache,
  Client,
  CommandInteraction,
  ComponentInteraction,
  Constants,
  Guild,
  Interaction,
  Message,
  ModalSubmitInteraction,
  Reaction,
  TextBasedChannel,
  User,
} from "darkcord";
import EventEmitter from "node:events";

export type Filter<T, E extends any[] = never[]> = (
  collected: T,
  ...extra: E
) => boolean | Promise<boolean>;
export interface CollectorOptions<T> {
  max?: number;
  filter?: Filter<T>;
  dispose?: boolean;
  timeout?: number | null;
  idleTimeout?: number | null;
}

const { Events } = Constants;

export interface BaseCollectorEvents<T, E extends string = string> {
  end: [collected: Cache<T>, reason: "idle" | "limit" | "timeout" | E]
}
export declare interface Collector<T, E extends Record<string | symbol, any>> {
  on<T extends keyof E>(event: T, listener: (...args: E[T]) => any): this;
  on(event: keyof E, listener: (...args: any[]) => any): this;
  once<T extends keyof E>(event: T, listener: (...args: E[T]) => any): this;
  once(event: keyof E, listener: (...args: any[]) => any): this;
  emit<T extends keyof E>(event: T, ...args: E[T]): boolean;
  emit(event: keyof E, ...args: any[]): boolean;
}
export class Collector<T, E extends Record<string | symbol, any>> extends EventEmitter {
  collected = new Cache<T>();
  options: Required<CollectorOptions<T>>;
  ended = false;
  timeout: NodeJS.Timer | null;
  idleTimeout: NodeJS.Timer | null;
  endReason?: string;
  constructor(options: CollectorOptions<T> = {}) {
    super();

    options.filter = options.filter ?? (() => true);
    options.max = Number(options.max) || Infinity;
    options.dispose = Boolean(options.dispose);
    options.timeout = Number(options.timeout) || null;
    options.idleTimeout = Number(options.idleTimeout) || null;

    this._handleCollect = this._handleCollect.bind(this);
    this._handleDispose = this._handleDispose.bind(this);
    this._handleIdle = this._handleIdle.bind(this);

    this.timeout = null;
    if (options.timeout) {
      this.timeout = setTimeout(() => this.stop("timeout"), options.timeout).unref();
    }

    this.idleTimeout = null;
    if (options.idleTimeout) {
      this.idleTimeout = setTimeout(this._handleIdle, options.idleTimeout).unref();
    }

    this.options = options as Required<CollectorOptions<T>>;
  }

  protected collect(data: T): Awaitable<[string, T] | undefined> {
    return [null as unknown as string, null as T];
  }

  protected dispose(data: T): Awaitable<[string, T]> {
    return [null as unknown as string, null as T];
  }

  async _handleCollect(data: T) {
    const collected = await this.collect(data);

    if (collected) {
      this.collected.set(collected[0], collected[1]);
      this.emit("collect", collected[1]);

      if (this.idleTimeout) {
        clearTimeout(this.idleTimeout);
        this.idleTimeout = setTimeout(this._handleIdle).unref();
      }

      if (this.collected.size >= this.options.max) {
        this.stop("limit");
      }
    }
  }

  async _handleDispose(data: T) {
    if (!this.options.dispose) return;

    const dispose = await this.dispose(data);

    this.collected.delete(dispose[0]);
    this.emit("dispose", dispose[1]);
  }

  _handleIdle() {
    this.stop("idle");
  }

  stop(reason?: string) {
    if (this.ended) return;

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }

    this.ended = true;
    this.endReason = reason;

    this.emit("end", this.collected, reason);

    // Remove all listeners excluding end
    this.removeAllListeners("collect");
    this.removeAllListeners("dispose");
  }
}

export interface MessageCollectorOptions extends CollectorOptions<Message> {
  channelId?: string;
  guildId?: string;
}

export interface MessageCollectorEvents extends BaseCollectorEvents<Message, "channelDelete" | "guildDelete"> {
  collect: [collected: Message];
  dispose: [disposed: Message];
}

export class MessageCollector extends Collector<Message, MessageCollectorEvents> {
  private _channelId?: string;
  private _guildId?: string;

  constructor(private client: Client, options: MessageCollectorOptions) {
    super(options);

    this._handleGuildDelete = this._handleGuildDelete.bind(this);
    this._handleChannelDelete = this._handleChannelDelete.bind(this);
    this._handleBulkDelete = this._handleBulkDelete.bind(this);
    this._channelId = options.channelId;

    client.on(Events.MessageCreate, this._handleCollect);
    client.on(Events.MessageDelete, this._handleDispose);
    client.on(Events.ChannelDelete, this._handleChannelDelete);
    client.on(Events.ThreadDelete, this._handleChannelDelete);
    client.on(Events.GuildDelete, this._handleGuildDelete);
    client.on(Events.MessageDeleteBulk, this._handleBulkDelete);
  }

  _handleChannelDelete(channel: TextBasedChannel) {
    if (this._channelId === channel.id) this.stop("channelDelete");
  }

  _handleGuildDelete(guild: Guild) {
    if (this._guildId === guild.id) this.stop("guildDelete");
  }

  _handleBulkDelete(bulk: Map<string, Message>) {
    for (const deleted of bulk.values()) {
      if (this.collected.has(deleted.id)) this.collected.delete(deleted.id);
    }
  }

  stop(reason?: string) {
    if (this.ended) return;

    this.client.off(Events.MessageCreate, this._handleCollect);
    this.client.off(Events.MessageDelete, this._handleDispose);
    this.client.off(Events.ChannelDelete, this._handleChannelDelete);
    this.client.off(Events.ThreadDelete, this._handleChannelDelete);
    this.client.off(Events.GuildDelete, this._handleGuildDelete);
    this.client.off(Events.MessageDeleteBulk, this._handleBulkDelete);

    super.stop(reason);
  }

  async collect(message: Message) {
    if (this._channelId && message.channelId !== this._channelId) return;
    if (!(await this.options.filter(message))) return;

    return [message.id, message] as [string, Message];
  }

  dispose(message: Message) {
    return [message.id, message] as [string, Message];
  }
}

export interface InteractionByType {
  [API.InteractionType.ApplicationCommand]: CommandInteraction;
  [API.InteractionType.ApplicationCommandAutocomplete]: AutocompleteInteraction;
  [API.InteractionType.MessageComponent]: ComponentInteraction;
  [API.InteractionType.ModalSubmit]: ModalSubmitInteraction;
}

export type InteractionToCollect = Exclude<
  API.InteractionType,
  API.InteractionType.Ping
>;

export interface InteractionCollectorOptions<
  T extends Exclude<API.InteractionType, API.InteractionType.Ping>,
> extends CollectorOptions<InteractionByType[T]> {
  interactionType?: T;
  componentType?: API.ComponentType;
  channelId?: string;
  guildId?: string;
}

export interface InteractionCollectorEvents<I extends InteractionByType[keyof InteractionByType]> extends BaseCollectorEvents<I, "channelDelete" | "guildDelete"> {
  collect: [collected: I];
  dispose: [disposed: I];
}

export class InteractionCollector<
  I extends InteractionToCollect = InteractionToCollect,
> extends Collector<InteractionByType[I], InteractionCollectorEvents<InteractionByType[I]>> {
  interactionType: API.InteractionType | -1;
  private _channelId?: string;
  componentType?: API.ComponentType;
  private _guildId: string | undefined;
  constructor(private client: Client, options: InteractionCollectorOptions<I>) {
    super(options);

    this.interactionType = options.interactionType || -1;
    this._channelId = options.channelId;
    this._guildId = options.guildId;
    this.componentType = options.componentType;

    this._handleChannelDelete = this._handleChannelDelete.bind(this);
    this._handleGuildDelete = this._handleGuildDelete.bind(this);

    client.on(Events.InteractionCreate, this._handleCollect);
    client.on(Events.ChannelDelete, this._handleChannelDelete);
    client.on(Events.GuildDelete, this._handleGuildDelete);
    client.on(Events.ThreadDelete, this._handleChannelDelete);
  }

  _handleGuildDelete(guild: Guild) {
    if (guild.id === this._guildId) this.stop("guildDelete");
  }

  _handleChannelDelete(channel: TextBasedChannel) {
    if (channel.id === this._channelId) this.stop("channelDelete");
  }

  protected async collect(interaction: Interaction) {
    if (this.interactionType !== -1) {
      switch (this.interactionType) {
        case API.InteractionType.ApplicationCommand: {
          if (!interaction.isCommand()) return;
          break;
        }
        case API.InteractionType.ApplicationCommandAutocomplete: {
          if (!interaction.isAutoComplete()) return;
          break;
        }
        case API.InteractionType.MessageComponent: {
          if (!interaction.isComponent()) return;
          break;
        }
        case API.InteractionType.ModalSubmit: {
          if (!interaction.isModalSubmit()) return;
          break;
        }
        default: {
          return;
        }
      }
    }

    if (
      this._channelId &&
      (interaction.isCommand() ||
        interaction.isComponent() ||
        interaction.isModalSubmit()) &&
      interaction.channelId !== this._channelId
    )
      return;
    if (
      this.componentType &&
      interaction.isComponent() &&
      interaction.componentType !== this.componentType
    )
      return;
    if (!(await this.options.filter(interaction as InteractionByType[I])))
      return;

    return [interaction.id, interaction] as [string, InteractionByType[I]];
  }

  protected dispose(interaction: InteractionByType[I]) {
    return [interaction.id, interaction] as [string, InteractionByType[I]];
  }

  stop(reason?: string) {
    if (this.ended) return;

    this.client.off(Events.InteractionCreate, this._handleCollect);
    this.client.off(Events.ChannelDelete, this._handleChannelDelete);
    this.client.off(Events.GuildDelete, this._handleGuildDelete);
    this.client.off(Events.ThreadDelete, this._handleChannelDelete);

    super.stop(reason);
  }
}

export interface CollectedReaction {
  reaction: Reaction;
  message: Message;
  user: User;
}

export interface ReactionCollectorOptions
  extends CollectorOptions<CollectedReaction> {
  messageId?: string;
  channelId?: string;
  guildId?: string;
}

export interface ReactionCollectorEvents extends BaseCollectorEvents<CollectedReaction, "channelDelete" | "guildDelete" | "messageDelete"> {
  collect: [collected: CollectedReaction];
  dispose: [disposed: CollectedReaction];
}

export class ReactionCollector extends Collector<CollectedReaction, ReactionCollectorEvents> {
  private _channelId?: string;
  private _guildId?: string;
  private _messageId?: string;
  private _createCollectHandler: (
    reaction: Reaction,
    user: User,
    message: Message,
  ) => void;
  private _createDisposeHandler: (
    reaction: Reaction,
    user: User,
    message: Message,
  ) => void;
  constructor(private client: Client, options: ReactionCollectorOptions) {
    super(options);

    this._channelId = options.channelId;
    this._guildId = options.guildId;
    this._messageId = options.messageId;

    this._handleChannelDelete = this._handleChannelDelete.bind(this);
    this._handleGuildDelete = this._handleGuildDelete.bind(this);
    this._handleMessageDelete = this._handleMessageDelete.bind(this);

    const createCollectHandler = (
      reaction: Reaction,
      user: User,
      message: Message,
    ) => {
      return this._handleCollect({
        reaction,
        user,
        message,
      });
    };

    const createDisposeHandler = (
      reaction: Reaction,
      user: User,
      message: Message,
    ) => {
      return this._handleDispose({
        reaction,
        user,
        message,
      });
    };

    this._createCollectHandler = createCollectHandler.bind(this);
    this._createDisposeHandler = createDisposeHandler.bind(this);

    client.on(Events.MessageReactionAdd, this._createCollectHandler);
    client.on(Events.MessageReactionRemove, this._createDisposeHandler);
    client.on(Events.ChannelDelete, this._handleChannelDelete);
    client.on(Events.GuildDelete, this._handleGuildDelete);
    client.on(Events.ThreadDelete, this._handleChannelDelete);
    client.on(Events.MessageDelete, this._handleMessageDelete);
  }

  _handleGuildDelete(guild: Guild) {
    if (guild.id === this._guildId) this.stop("guildDelete");
  }

  _handleChannelDelete(channel: TextBasedChannel) {
    if (channel.id === this._channelId) this.stop("channelDelete");
  }

  _handleMessageDelete(message: Message) {
    if (message.id === this._messageId) this.stop("messageDelete");
  }

  protected async collect(collected: CollectedReaction) {
    if (this._messageId && collected.message.id !== this._messageId) return;
    if (this._channelId && collected.message.channelId !== this._channelId)
      return;
    if (this._guildId && collected.message.guildId !== this._guildId) return;
    if (!(await this.options.filter(collected))) return;

    return [collected.reaction.emoji.toString(), collected] as [
      string,
      CollectedReaction,
    ];
  }

  protected dispose(collected: CollectedReaction) {
    return [collected.reaction.emoji.toString(), collected] as [
      string,
      CollectedReaction,
    ];
  }

  stop(reason?: string) {
    if (this.ended) return;

    this.client.off(Events.MessageReactionAdd, this._createCollectHandler);
    this.client.off(Events.MessageReactionRemove, this._createDisposeHandler);
    this.client.off(Events.ChannelDelete, this._handleChannelDelete);
    this.client.off(Events.GuildDelete, this._handleGuildDelete);
    this.client.off(Events.ThreadDelete, this._handleChannelDelete);
    this.client.off(Events.MessageDelete, this._handleMessageDelete);

    super.stop(reason);
  }
}
