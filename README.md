# GREEN-API MAX Chat

[Русская версия](README.ru.md)

A web client for private MAX chats powered by GREEN-API. Built with React 19, TypeScript, and Vite.

## Features

- multiple private conversations;
- text and image messaging;
- chat creation by Russian or Belarusian phone number;
- chat search and a dedicated unread view;
- unread conversation and message counters;
- contact name, avatar, and last-seen status;
- automatic light or dark theme based on system preferences;
- responsive layout.

Groups, channels, and calls are not supported.

## Development

Requires Node.js 24 and pnpm 10.

```bash
nvm use
pnpm install
pnpm dev
```

Available commands:

```bash
pnpm build       # TypeScript check and production build
pnpm lint        # ESLint
pnpm typecheck   # TypeScript check
pnpm test --run  # Vitest test suite
pnpm test:e2e    # Playwright smoke test
```

## GREEN-API setup

1. Create and authorize a MAX instance in the [GREEN-API Console](https://console.green-api.com/).
2. Enable incoming notifications in the instance settings.
3. Keep `webhookUrl` empty: the client receives messages through HTTP API polling.
4. Enter `apiUrl`, `idInstance`, and `apiTokenInstance` in the application.
5. Select **Connect**.

After connecting, select `+` to create a chat by phone number. Russian numbers with country code `7` and Belarusian numbers with country code `375` are supported.

The client uses these GREEN-API methods:

- `CheckAccount` to validate a number and obtain its MAX `chatId`;
- `GetContactInfo` to load the contact name, avatar, and `lastSeen`;
- `SendMessage` and `SendFileByUpload` to send content;
- `ReceiveNotification` and `DeleteNotification` to receive and acknowledge notifications.

## Data storage

Credentials, chats, and messages are stored only in the current tab's memory. Reloading the page or reconnecting clears the application state.

Sending and receiving pause while the device is offline and resume when the connection is restored. There is no offline queue or background delivery.

Never publish real API tokens in the repository, `.env` files, screenshots, or logs. A backend or proxy is recommended for production because a browser client cannot hide a token from DevTools or extensions.

## Architecture

The codebase is divided into `domain`, `application`, `infrastructure`, and `presentation` layers. GREEN-API is accessed through the `GreenApiPort`; external responses are validated with Zod schemas, and conversation data is stored in a normalized reducer.

See the [architecture overview](docs/architecture.md) and [ADRs](docs/adr/) for details.
