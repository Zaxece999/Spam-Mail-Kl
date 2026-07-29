import type { Api, Context, SessionFlavor } from "grammy";
import type { ConversationFlavor } from "@grammyjs/conversations";
import type { CommandsFlavor } from "@grammyjs/commands";
import type { HydrateFlavor, HydrateApiFlavor } from "@grammyjs/hydrate";
import type {
  FileApiFlavor,
  FileFlavor,
} from "@grammyjs/files";
import type { Message } from "@grammyjs/types";

export type ReplyOrEdit = (
  ...args: Parameters<Context["reply"]>
) => Promise<Message.TextMessage | true | undefined>;

export interface SessionData {
  step: string;
}

export type CustomContext = HydrateFlavor<
  FileFlavor<
    Context &
      SessionFlavor<SessionData> &
      CommandsFlavor<Context> &
      ConversationFlavor<Context> & {
        replyOrEdit: ReplyOrEdit;
      }
  >
>;

export type CustomApi = HydrateApiFlavor<Api & FileApiFlavor<Api>>;
