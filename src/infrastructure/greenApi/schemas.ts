import { z } from "zod";

const optionalHttpUrlSchema = z.unknown().transform((value): string | undefined => {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}).optional();

export const sendResponseSchema = z.object({ idMessage: z.string().trim().min(1) });
export const checkAccountResponseSchema = z.object({
  exist: z.boolean(),
  chatId: z.string(),
  fromCache: z.boolean().optional(),
});
export const contactInfoResponseSchema = z.object({
  lastSeen: z.union([z.number(), z.string(), z.literal(false)]).nullable().optional(),
  avatar: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
});
export const chatSummarySchema = z.looseObject({
  chatId: z.string(),
  name: z.string(),
  type: z.enum(["user", "group", "channel", "bot"]),
  phoneNumber: z.number(),
});
export const chatsResponseSchema = z.array(chatSummarySchema);
export const chatHistoryMessageSchema = z.looseObject({
  type: z.enum(["incoming", "outgoing"]),
  idMessage: z.string().trim().min(1),
  timestamp: z.number().int().nonnegative(),
  typeMessage: z.string(),
  chatId: z.string(),
  textMessage: z.string().optional(),
  downloadUrl: optionalHttpUrlSchema,
  downloadUrlJpeg: optionalHttpUrlSchema,
  caption: z.string().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  extendedTextMessage: z.looseObject({ text: z.string().optional() }).optional(),
});
export type ChatHistoryResponseItem = z.output<typeof chatHistoryMessageSchema>;
export const chatHistoryResponseSchema = z.array(chatHistoryMessageSchema);
export const deleteResponseSchema = z.object({ result: z.boolean() });
export const notificationEnvelopeSchema = z.object({
  receiptId: z.number().int().nonnegative(),
  body: z.unknown(),
});

const senderDataSchema = z.looseObject({
  chatId: z.string().optional(),
  chatType: z.string().optional(),
  chatName: z.string().optional(),
});
const messageDataSchema = z.looseObject({
  typeMessage: z.string().optional(),
  textMessage: z.string().optional(),
  textMessageData: z.looseObject({ textMessage: z.string().optional() }).optional(),
  fileMessageData: z.looseObject({
    downloadUrl: z.url().optional(),
    downloadUrlJpeg: z.url().optional(),
    caption: z.string().optional(),
    fileName: z.string().optional(),
    mimeType: z.string().optional(),
  }).optional(),
});

export const notificationBodySchema = z.looseObject({
  typeWebhook: z.string().optional(),
  timestamp: z.number().int().nonnegative().max(8_640_000_000_000).optional(),
  idMessage: z.string().optional(),
  senderData: senderDataSchema.optional(),
  messageData: messageDataSchema.optional(),
});
