import { FetchGreenApiClient } from "@infrastructure/greenApi/FetchGreenApiClient";
import type { GreenApiPort } from "@application/ports/GreenApiPort";
import { useState } from "react";
import { ConversationProvider, useConversationState } from "@presentation/ConversationProvider";
import { ChatHeader } from "@presentation/components/ChatHeader";
import { ConnectionForm } from "@presentation/components/ConnectionForm";
import { ConversationList } from "@presentation/components/ConversationList";
import { MessageComposer } from "@presentation/components/MessageComposer";
import { MessageList } from "@presentation/components/MessageList";
import { NewChatForm } from "@presentation/components/NewChatForm";
import { StatusBanner } from "@presentation/components/StatusBanner";

const productionClient = new FetchGreenApiClient();

function ChatApplication() {
  const { session, state } = useConversationState();
  const [mobileListVisible, setMobileListVisible] = useState(true);
  if (!session) return <main className="connection-page"><ConnectionForm /></main>;
  return <main className={mobileListVisible ? "app-shell show-list" : "app-shell show-chat"}>
    <aside className="sidebar"><div className="sidebar-top"><div className="brand compact"><span className="brand-mark" aria-hidden="true">G</span><strong>GREEN Chat</strong></div><NewChatForm /><details className="connection-settings"><summary>Настроить подключение</summary><ConnectionForm /></details></div><ConversationList onSelect={() => { setMobileListVisible(false); }} /></aside>
    <section className="chat-pane"><ChatHeader onBack={() => { setMobileListVisible(true); }} /><StatusBanner /><div className="message-scroll"><MessageList /></div><MessageComposer /></section>
    <span className="sr-only" aria-live="polite">{state.activeChatId ? "Чат выбран" : "Чат не выбран"}</span>
  </main>;
}

export function App({ client = productionClient }: { readonly client?: GreenApiPort }) {
  return <ConversationProvider client={client}><ChatApplication /></ConversationProvider>;
}
