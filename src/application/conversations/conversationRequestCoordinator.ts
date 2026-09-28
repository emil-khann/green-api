import type { AppError } from "@application/errors/AppError";
import type {
  ChatHistoryMessage,
  ChatSummary,
  ContactInfoResult,
  GreenApiPort,
  PortResult,
} from "@application/ports/GreenApiPort";
import type { ChatId } from "@domain/chatId";
import type { AppliedSession } from "@domain/connection";

export type RequestPriority = "background" | "active";

export interface RequestOptions {
  readonly priority?: RequestPriority;
  readonly refresh?: boolean;
}

export interface HistoryRequestOptions extends RequestOptions {
  readonly count?: number;
}

export type ConversationRequestEvent =
  | { readonly resource: "chats"; readonly status: "loading" }
  | {
      readonly resource: "chats";
      readonly status: "success";
      readonly value: readonly ChatSummary[];
    }
  | {
      readonly resource: "chats";
      readonly status: "error";
      readonly error: AppError;
    }
  | { readonly resource: "chats"; readonly status: "cancelled" }
  | {
      readonly resource: "history";
      readonly status: "loading";
      readonly chatId: ChatId;
    }
  | {
      readonly resource: "history";
      readonly status: "success";
      readonly chatId: ChatId;
      readonly value: readonly ChatHistoryMessage[];
    }
  | {
      readonly resource: "history";
      readonly status: "error";
      readonly chatId: ChatId;
      readonly error: AppError;
    }
  | {
      readonly resource: "history";
      readonly status: "cancelled";
      readonly chatId: ChatId;
    }
  | {
      readonly resource: "contact";
      readonly status: "loading";
      readonly chatId: ChatId;
    }
  | {
      readonly resource: "contact";
      readonly status: "success";
      readonly chatId: ChatId;
      readonly value: ContactInfoResult;
    }
  | {
      readonly resource: "contact";
      readonly status: "error";
      readonly chatId: ChatId;
      readonly error: AppError;
    }
  | {
      readonly resource: "contact";
      readonly status: "cancelled";
      readonly chatId: ChatId;
    };

export interface ConversationRequestCoordinatorOptions {
  readonly client: GreenApiPort;
  readonly onEvent: (event: ConversationRequestEvent) => void;
  readonly maxRetries?: number;
  readonly baseRetryDelayMs?: number;
  readonly random?: () => number;
  readonly contactTtlMs?: number;
}

type LaneName = "chats" | "history" | "contact";
type JobState = "queued" | "running" | "settled";

interface Lane {
  readonly intervalMs: number;
  readonly queue: Job<unknown>[];
  lastStartedAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  activeBurst: number;
}

interface Job<T> {
  readonly key: string;
  readonly lane: LaneName;
  readonly generation: number;
  readonly controller: AbortController;
  readonly execute: (signal: AbortSignal) => Promise<PortResult<T>>;
  readonly onSuccess: (value: T) => void;
  readonly onError: (error: AppError) => void;
  readonly onCancelled: () => void;
  resolve: (result: PortResult<T>) => void;
  priority: number;
  sequence: number;
  attempt: number;
  eligibleAt: number;
  state: JobState;
}

const ABORTED_ERROR: AppError = {
  kind: "aborted",
  safeMessage: "Операция отменена.",
  retryable: false,
};
const UNAVAILABLE_ERROR: AppError = {
  kind: "protocol",
  safeMessage: "Метод API недоступен.",
  retryable: false,
};
const UNEXPECTED_ERROR: AppError = {
  kind: "network",
  safeMessage: "Не удалось выполнить запрос.",
  retryable: true,
};

const PRIORITY: Readonly<Record<RequestPriority, number>> = {
  background: 0,
  active: 1,
};
const MAX_ACTIVE_BURST = 3;
const DEFAULT_CONTACT_TTL_MS = 60_000;

interface ContactCacheEntry {
  readonly value: ContactInfoResult;
  readonly cachedAt: number;
}

function normalizedRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

/** Session-scoped scheduler for GREEN-API conversation reads. It has no React dependency. */
export class ConversationRequestCoordinator {
  readonly #client: GreenApiPort;
  readonly #onEvent: (event: ConversationRequestEvent) => void;
  readonly #maxRetries: number;
  readonly #baseRetryDelayMs: number;
  readonly #random: () => number;
  readonly #contactTtlMs: number;
  readonly #lanes: Record<LaneName, Lane> = {
    chats: {
      intervalMs: 1_000,
      queue: [],
      lastStartedAt: Number.NEGATIVE_INFINITY,
      timer: undefined,
      activeBurst: 0,
    },
    history: {
      intervalMs: 1_000,
      queue: [],
      lastStartedAt: Number.NEGATIVE_INFINITY,
      timer: undefined,
      activeBurst: 0,
    },
    contact: {
      intervalMs: 100,
      queue: [],
      lastStartedAt: Number.NEGATIVE_INFINITY,
      timer: undefined,
      activeBurst: 0,
    },
  };

  readonly #jobs = new Map<string, Job<unknown>>();
  readonly #historyCache = new Map<ChatId, readonly ChatHistoryMessage[]>();
  readonly #contactCache = new Map<ChatId, ContactCacheEntry>();
  #chatsCache: readonly ChatSummary[] | undefined;
  #session: AppliedSession | undefined;
  #generation = 0;
  #sequence = 0;

  constructor(options: ConversationRequestCoordinatorOptions) {
    this.#client = options.client;
    this.#onEvent = options.onEvent;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#baseRetryDelayMs = options.baseRetryDelayMs ?? 500;
    this.#random = options.random ?? Math.random;
    this.#contactTtlMs = options.contactTtlMs ?? DEFAULT_CONTACT_TTL_MS;
  }

  startSession(session: AppliedSession): void {
    this.stopSession();
    this.#session = session;
  }

  stopSession(): void {
    this.#generation += 1;
    this.#session = undefined;
    for (const lane of Object.values(this.#lanes)) {
      if (lane.timer !== undefined) {
        clearTimeout(lane.timer);
      }
      lane.timer = undefined;
      lane.queue.length = 0;
      lane.lastStartedAt = Number.NEGATIVE_INFINITY;
      lane.activeBurst = 0;
    }
    for (const job of this.#jobs.values()) {
      job.controller.abort();
      job.onCancelled();
      this.#settleCancelled(job);
    }
    this.#jobs.clear();
    this.#chatsCache = undefined;
    this.#historyCache.clear();
    this.#contactCache.clear();
  }

  /** Stops only speculative work. Active requests and successful caches survive. */
  cancelBackgroundJobs(): void {
    const cancelled = [...this.#jobs.values()].filter(
      (job) => job.priority === PRIORITY.background,
    );
    for (const job of cancelled) {
      if (job.state === "queued") {
        const queue = this.#lanes[job.lane].queue;
        const index = queue.indexOf(job);
        if (index >= 0) {
          queue.splice(index, 1);
        }
      } else if (job.state === "running") {
        job.controller.abort();
      }
      this.#jobs.delete(job.key);
      job.onCancelled();
      this.#settleCancelled(job);
    }
    for (const laneName of Object.keys(this.#lanes) as LaneName[]) {
      this.#schedule(laneName);
    }
  }

  loadChats(
    options: RequestOptions = {},
  ): Promise<PortResult<readonly ChatSummary[]>> {
    const key = "chats";
    if (!options.refresh && this.#chatsCache !== undefined) {
      return Promise.resolve({ ok: true, value: this.#chatsCache });
    }
    if (options.refresh) {
      this.#chatsCache = undefined;
    }

    return this.#ensure({
      key,
      lane: "chats",
      priority: options.priority ?? "active",
      execute: (session, signal) =>
        this.#client.getChats?.(session, signal) ??
        Promise.resolve({ ok: false, error: UNAVAILABLE_ERROR }),
      loadingEvent: { resource: "chats", status: "loading" },
      successEvent: (value) => ({
        resource: "chats",
        status: "success",
        value,
      }),
      errorEvent: (error) => ({ resource: "chats", status: "error", error }),
      cancelledEvent: { resource: "chats", status: "cancelled" },
      cache: (value) => {
        this.#chatsCache = value;
      },
    });
  }

  ensureHistory(
    chatId: ChatId,
    options: HistoryRequestOptions = {},
  ): Promise<PortResult<readonly ChatHistoryMessage[]>> {
    const cached = this.#historyCache.get(chatId);
    if (!options.refresh && cached !== undefined) {
      return Promise.resolve({ ok: true, value: cached });
    }
    if (options.refresh) {
      this.#historyCache.delete(chatId);
    }

    return this.#ensure({
      key: `history:${chatId}`,
      lane: "history",
      priority: options.priority ?? "active",
      execute: (session, signal) =>
        this.#client.getChatHistory?.(session, chatId, options.count, signal) ??
        Promise.resolve({ ok: false, error: UNAVAILABLE_ERROR }),
      loadingEvent: { resource: "history", status: "loading", chatId },
      successEvent: (value) => ({
        resource: "history",
        status: "success",
        chatId,
        value,
      }),
      errorEvent: (error) => ({
        resource: "history",
        status: "error",
        chatId,
        error,
      }),
      cancelledEvent: { resource: "history", status: "cancelled", chatId },
      cache: (value) => {
        this.#historyCache.set(chatId, value);
      },
    });
  }

  ensureContact(
    chatId: ChatId,
    options: RequestOptions = {},
  ): Promise<PortResult<ContactInfoResult>> {
    const cached = this.#contactCache.get(chatId);
    const isFresh =
      cached !== undefined && Date.now() - cached.cachedAt < this.#contactTtlMs;
    if (!options.refresh && isFresh) {
      return Promise.resolve({ ok: true, value: cached.value });
    }

    return this.#ensure({
      key: `contact:${chatId}`,
      lane: "contact",
      priority: options.priority ?? "active",
      execute: (session, signal) =>
        this.#client.getContactInfo?.(session, chatId, signal) ??
        Promise.resolve({ ok: false, error: UNAVAILABLE_ERROR }),
      loadingEvent: { resource: "contact", status: "loading", chatId },
      successEvent: (value) => ({
        resource: "contact",
        status: "success",
        chatId,
        value,
      }),
      errorEvent: (error) => ({
        resource: "contact",
        status: "error",
        chatId,
        error,
      }),
      cancelledEvent: { resource: "contact", status: "cancelled", chatId },
      cache: (value) => {
        this.#contactCache.set(chatId, { value, cachedAt: Date.now() });
      },
    });
  }

  #ensure<T>(definition: {
    readonly key: string;
    readonly lane: LaneName;
    readonly priority: RequestPriority;
    readonly execute: (
      session: AppliedSession,
      signal: AbortSignal,
    ) => Promise<PortResult<T>>;
    readonly loadingEvent: ConversationRequestEvent;
    readonly successEvent: (value: T) => ConversationRequestEvent;
    readonly errorEvent: (error: AppError) => ConversationRequestEvent;
    readonly cancelledEvent?: ConversationRequestEvent;
    readonly cache: (value: T) => void;
  }): Promise<PortResult<T>> {
    const existing = this.#jobs.get(definition.key) as Job<T> | undefined;
    if (existing !== undefined) {
      existing.priority = Math.max(
        existing.priority,
        PRIORITY[definition.priority],
      );
      this.#schedule(existing.lane);

      return new Promise((resolve) => {
        const originalResolve = existing.resolve;
        existing.resolve = (result: PortResult<T>) => {
          originalResolve(result);
          resolve(result);
        };
      });
    }

    const session = this.#session;
    if (session === undefined) {
      return Promise.resolve({ ok: false, error: ABORTED_ERROR });
    }
    const generation = this.#generation;
    let resolvePromise: (result: PortResult<T>) => void = () => undefined;
    const promise = new Promise<PortResult<T>>((resolve) => {
      resolvePromise = resolve;
    });
    const job: Job<T> = {
      key: definition.key,
      lane: definition.lane,
      generation,
      controller: new AbortController(),
      execute: (signal) => definition.execute(session, signal),
      onSuccess: (value) => {
        definition.cache(value);
        this.#emit(definition.successEvent(value));
      },
      onError: (error) => {
        this.#emit(definition.errorEvent(error));
      },
      onCancelled: () => {
        if (definition.cancelledEvent) {
          this.#emit(definition.cancelledEvent);
        }
      },
      resolve: resolvePromise,
      priority: PRIORITY[definition.priority],
      sequence: this.#sequence,
      attempt: 0,
      eligibleAt: Date.now(),
      state: "queued",
    };
    this.#sequence += 1;
    this.#jobs.set(job.key, job as Job<unknown>);
    this.#lanes[job.lane].queue.push(job as Job<unknown>);
    this.#emit(definition.loadingEvent);
    this.#schedule(job.lane);

    return promise;
  }

  #schedule(laneName: LaneName): void {
    const lane = this.#lanes[laneName];
    if (lane.timer !== undefined) {
      clearTimeout(lane.timer);
      lane.timer = undefined;
    }
    if (lane.queue.length === 0) {
      return;
    }
    const now = Date.now();
    const laneReadyAt = lane.lastStartedAt + lane.intervalMs;
    const ready = lane.queue.filter((job) => job.eligibleAt <= now);
    if (ready.length > 0 && laneReadyAt <= now) {
      const oldestBackground =
        lane.activeBurst >= MAX_ACTIVE_BURST
          ? ready
              .filter((job) => job.priority === PRIORITY.background)
              .sort((left, right) => left.sequence - right.sequence)[0]
          : undefined;
      ready.sort(
        (left, right) =>
          right.priority - left.priority || left.sequence - right.sequence,
      );
      const job = oldestBackground ?? ready[0];
      if (job !== undefined) {
        this.#start(job, lane);
      }

      return;
    }
    const nextJobAt =
      ready.length > 0
        ? now
        : Math.min(...lane.queue.map((job) => job.eligibleAt));
    const delay = Math.max(0, laneReadyAt, nextJobAt) - now;
    lane.timer = setTimeout(() => {
      lane.timer = undefined;
      this.#schedule(laneName);
    }, delay);
  }

  #start(job: Job<unknown>, lane: Lane): void {
    const index = lane.queue.indexOf(job);
    if (index < 0) {
      return;
    }
    lane.queue.splice(index, 1);
    lane.lastStartedAt = Date.now();
    lane.activeBurst =
      job.priority === PRIORITY.active ? lane.activeBurst + 1 : 0;
    job.state = "running";
    this.#schedule(job.lane);
    void this.#run(job);
  }

  async #run(job: Job<unknown>): Promise<void> {
    let result: PortResult<unknown>;
    try {
      result = await job.execute(job.controller.signal);
    } catch {
      result = { ok: false, error: UNEXPECTED_ERROR };
    }
    if (!this.#isCurrent(job)) {
      this.#settleCancelled(job);

      return;
    }
    if (result.ok) {
      job.state = "settled";
      this.#jobs.delete(job.key);
      job.onSuccess(result.value);
      job.resolve(result);

      return;
    }
    if (result.error.retryable && job.attempt < this.#maxRetries) {
      const exponentialDelay =
        this.#baseRetryDelayMs *
        2 ** job.attempt *
        normalizedRandom(this.#random);
      const retryDelay = Math.max(
        exponentialDelay,
        result.error.retryAfterMs ?? 0,
      );
      job.attempt += 1;
      job.sequence = this.#sequence;
      this.#sequence += 1;
      job.eligibleAt = Date.now() + retryDelay;
      job.state = "queued";
      this.#lanes[job.lane].queue.push(job);
      this.#schedule(job.lane);

      return;
    }
    job.state = "settled";
    this.#jobs.delete(job.key);
    job.onError(result.error);
    job.resolve(result);
  }

  #isCurrent(job: Job<unknown>): boolean {
    return (
      job.generation === this.#generation &&
      this.#session !== undefined &&
      !job.controller.signal.aborted
    );
  }

  #settleCancelled(job: Job<unknown>): void {
    if (job.state === "settled") {
      return;
    }
    job.state = "settled";
    job.resolve({ ok: false, error: ABORTED_ERROR });
  }

  #emit(event: ConversationRequestEvent): void {
    try {
      this.#onEvent(event);
    } catch {
      // UI callbacks cannot break request scheduling.
    }
  }
}
