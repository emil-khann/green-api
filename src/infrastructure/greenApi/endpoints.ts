import type { AppliedSession } from "@domain/connection";

const segment = (value: string): string => encodeURIComponent(value);

function instanceBase(session: AppliedSession): string {
  return `${session.apiUrl}/waInstance${segment(session.idInstance)}`;
}

export function sendMessageEndpoint(session: AppliedSession): string {
  return `${instanceBase(session)}/sendMessage/${segment(session.apiTokenInstance)}`;
}

export function sendImageEndpoint(session: AppliedSession): string {
  return `${instanceBase(session)}/sendFileByUpload/${segment(session.apiTokenInstance)}`;
}

export function checkAccountEndpoint(session: AppliedSession): string {
  return `${instanceBase(session)}/checkAccount/${segment(session.apiTokenInstance)}`;
}

export function receiveNotificationEndpoint(session: AppliedSession, receiveTimeout: number): string {
  const url = new URL(`${instanceBase(session)}/receiveNotification/${segment(session.apiTokenInstance)}`);
  url.searchParams.set("receiveTimeout", String(receiveTimeout));
  return url.toString();
}

export function deleteNotificationEndpoint(session: AppliedSession, receiptId: number): string {
  return `${instanceBase(session)}/deleteNotification/${segment(session.apiTokenInstance)}/${String(receiptId)}`;
}
