import { z } from "zod";

export const sendResponseSchema = z.object({ idMessage: z.string().trim().min(1) });
export const checkAccountResponseSchema = z.object({
  exist: z.boolean(),
  chatId: z.string(),
  fromCache: z.boolean().optional(),
});
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
