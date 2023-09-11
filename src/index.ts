import {
  API,
  Client,
  Message,
  PluginManager,
  PluginObject,
  TextBasedChannel,
} from "darkcord";
import {
  CollectedReaction,
  CollectorOptions,
  InteractionCollector,
  InteractionCollectorOptions,
  MessageCollector,
  ReactionCollector,
} from "./Collector";

declare module "darkcord" {
  export interface TextBasedChannel {
    createMessageCollector(
      options?: CollectorOptions<Message>,
    ): MessageCollector;
    createComponentInteractionCollector(
      options?: Omit<
        InteractionCollectorOptions<API.InteractionType.MessageComponent>,
        "interactionType"
      >,
    ): InteractionCollector<API.InteractionType.MessageComponent>;
    createModalSubmitCollector(
      options?: Omit<
        InteractionCollectorOptions<API.InteractionType.ModalSubmit>,
        "interactionType"
      >,
    ): InteractionCollector<API.InteractionType.ModalSubmit>;
  }

  export interface Message {
    createReactionCollector(
      options?: CollectorOptions<CollectedReaction>,
    ): ReactionCollector;
  }
}

export function CollectorPlugin(manager: PluginManager): PluginObject {
  return {
    name: "darkcord/collectors",
    version: require("../package.json").version,
    load() {
      manager.extendsMultiple(
        [
          "TextBasedChannel",
          "GuildTextChannel",
          "VoiceChannel",
          "StageChannel",
          "DMChannel",
        ],
        (X: typeof TextBasedChannel) =>
          class TextBasedChannel extends X {
            createMessageCollector(options: CollectorOptions<Message> = {}) {
              return new MessageCollector(this._client as Client, {
                channelId: this.id,
                guildId: this.isGuildChannel() ? this.guildId : undefined,
                ...options,
              });
            }

            createComponentInteractionCollector(
              options: Omit<
                InteractionCollectorOptions<API.InteractionType.MessageComponent>,
                "interactionType"
              > = {},
            ) {
              return new InteractionCollector(this._client as Client, {
                channelId: this.id,
                guildId: this.isGuildChannel() ? this.guildId : undefined,
                interactionType: API.InteractionType.MessageComponent,
                ...options,
              });
            }

            createModalSubmitCollector(
              options: Omit<
                InteractionCollectorOptions<API.InteractionType.ModalSubmit>,
                "interactionType"
              > = {},
            ) {
              return new InteractionCollector(this._client as Client, {
                channelId: this.id,
                guildId: this.isGuildChannel() ? this.guildId : undefined,
                interactionType: API.InteractionType.ModalSubmit,
                ...options,
              });
            }
          },
      );

      manager.extends(
        "Message",
        (X: typeof Message) =>
          class Message extends X {
            createReactionCollector(
              options: CollectorOptions<CollectedReaction> = {},
            ) {
              return new ReactionCollector(this._client as Client, {
                guildId: this.guildId,
                messageId: this.id,
                channelId: this.channelId,
                ...options,
              });
            }
          },
      );
    },
    onStart() {},
  };
}

export default CollectorPlugin;
