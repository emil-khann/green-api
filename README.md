# GREEN Chat

Одностраничный multi-chat клиент GREEN-API на React 19, Vite и TypeScript. Интерфейс позволяет подключить один GREEN-API instance, вести несколько личных текстовых диалогов, отправлять сообщения и получать входящие через HTTP API polling. Проект не обращается к каким-либо демонстрационным backend-сервисам и не содержит реальных реквизитов.

## Возможности

- несколько диалогов в одной сессии и unread-счётчики;
- автоматическое создание неактивного диалога для нового валидного личного отправителя;
- отправка и получение только текстовых сообщений;
- проверка номера через `CheckAccount` перед созданием чата;
- поддержка номеров России и Беларуси по правилам MAX;
- ограничение текста: от 1 до 4000 Unicode code points (эмодзи считается одной точкой кода);
- последовательный long polling с обязательным подтверждением каждого receipt;
- безопасные пользовательские ошибки без сырых API-ответов, URL и токена;
- адаптивный интерфейс, доступные labels/roles и проверка в Chromium.

Архитектура разделена на `domain → application`, infrastructure-адаптер, реализующий application port, и React presentation/composition root. История нормализована в reducer; один session-wide pump принимает события независимо от открытого чата. Подробнее: [docs/architecture.md](docs/architecture.md) и [ADR](docs/adr/).

## Требования и запуск

- Node.js **24.x** (версия зафиксирована в `.nvmrc`);
- pnpm **10.x**.

```bash
nvm use
pnpm install
pnpm dev
```

Команды проекта:

```bash
pnpm build       # typecheck и production bundle
pnpm lint        # ESLint без warnings
pnpm typecheck   # строгая проверка TypeScript
pnpm test --run  # unit/component/contract тесты одним запуском
pnpm test:e2e    # Playwright smoke в Chromium
```

Перед первым e2e-запуском установите браузер Playwright, если его ещё нет:

```bash
pnpm exec playwright install chromium
```

## Настройка GREEN-API

1. Создайте или откройте MAX instance в [личном кабинете GREEN-API](https://console.green-api.com/) и авторизуйте его.
2. Скопируйте из карточки instance значения `apiUrl`, `idInstance` и `apiTokenInstance` в форму приложения.
3. В настройках instance включите получение входящих уведомлений (`incomingWebhook`).
4. Оставьте `webhookUrl` пустым: приложение использует HTTP API polling (`ReceiveNotification`), а не push webhook на собственный сервер.
5. Нажмите «Подключиться», затем создайте чат по номеру телефона.

Официальные методы API:

- [SendMessage](https://green-api.com/v3/docs/api/sending/SendMessage/)
- CheckAccount
- [ReceiveNotification](https://green-api.com/v3/docs/api/receiving/technology-http-api/ReceiveNotification/)
- [DeleteNotification](https://green-api.com/v3/docs/api/receiving/technology-http-api/DeleteNotification/)

### Правила номера и диалогов

Введите номер России (11 цифр с префиксом `7`) или Беларуси (12 цифр с префиксом `375`). Допускаются цифры, пробелы, `+`, скобки и дефисы. `8XXXXXXXXXX` нормализуется в `7XXXXXXXXXX`, а десятизначный российский номер, начинающийся с `9`, получает код `7`. Другие страны текущим MAX `CheckAccount` не поддерживаются.

Перед созданием диалога приложение вызывает `CheckAccount` и сохраняет возвращённый положительный числовой MAX `chatId`. `phoneNumber@c.us` не используется как identity: этот устаревший send-only формат не позволяет надёжно сопоставлять входящие сообщения. Повторный номер, разрешившийся в тот же `chatId`, открывает существующий диалог. Входящее личное текстовое сообщение (`senderData.chatType: "user"`) от неизвестного числового `chatId` автоматически создаёт новый неактивный чат и увеличивает unread. История, диалоги, реквизиты и дедупликация существуют только в памяти вкладки: перезагрузка или смена реквизитов очищает их.

## Offline-поведение

При потере сети polling приостанавливается, а отправка и применение новых реквизитов блокируются. После восстановления сети получение возобновляется. Сообщения не помещаются в скрытую offline-очередь и не отправляются позднее без явного действия пользователя. Service worker, Cache Storage, IndexedDB и persistent cache намеренно отсутствуют.

## Безопасность и ограничения браузера

- Приложение не сохраняет токен в `localStorage`, IndexedDB, cookies или файлы и не логирует его своим кодом.
- Браузерный frontend не может скрыть `apiTokenInstance` от пользователя DevTools, установленных расширений или скомпрометированного окружения. Для production нужен контролируемый backend/proxy, который хранит секрет, ограничивает доступ и работает только через HTTPS.
- Не добавляйте реальные секреты в репозиторий, `.env`, fixtures, screenshots или issue-тексты. E2E использует вымышленный домен и перехватывает все GREEN-API запросы на сетевом уровне.
- Доступ из браузера зависит от CORS-политики конкретного API endpoint/окружения. CORS — внешнее ограничение, которое нельзя исправить клиентским кодом. Не отключайте browser security и не запускайте браузер с небезопасными флагами; используйте корректно настроенный HTTPS backend/proxy.

Приложение учебное: оно не заменяет серверную авторизацию, долговременное хранилище, аудит или гарантию exactly-once доставки.
