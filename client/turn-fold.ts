import { useEffect, useSyncExternalStore } from "react";
import { useAgent, usePaseo } from "@getpaseo/plugin/client";

/**
 * Folds a finished turn's work (tool calls, reasoning, task lists and interim
 * replies) under one "Worked for" row, leaving the prompt and the final reply
 * on screen.
 *
 * A timeline renderer sees only its own item, so the turn structure comes from
 * the daemon's timeline instead: every entry carries its timestamp, and each
 * row places itself in a turn by its own. The timeline is re-read whenever the
 * agent's status changes, which is when a turn starts or ends.
 *
 * The header is drawn by the turn's first folded row, not by the prompt, so it
 * survives a prompt the host draws itself. A turn whose work the plugin does
 * not draw has nothing to anchor the header to and is never folded, so work is
 * never hidden without a way back to it.
 */

export type FoldKind = "tool" | "reasoning" | "todo" | "reply";

interface Entry {
  type: string;
  at: number;
  callId?: string;
}

/** The subset of a timeline page this module reads. */
interface TimelinePage {
  entries: ReadonlyArray<{
    item: { type: string; callId?: string | null; text?: string };
    timestamp: string;
  }>;
}

export interface TurnSpan {
  startAt: number;
  endAt: number;
  /** The newest work entry. Replies after it are the answer. */
  lastWorkAt: number;
  workCount: number;
  /** The first work entry the plugin draws; it carries the header. */
  anchor: { kind: FoldKind; at: number; callId?: string };
}

/** Live timestamps can trail or lead the daemon's by a moment. */
const SLACK_MS = 2000;
/** Bounds the payload: every entry carries its full tool output. */
const PAGE_LIMIT = 500;

const entriesByAgent = new Map<string, Entry[]>();
const fetchedStatus = new Map<string, string>();
const inflight = new Set<string>();
const expanded = new Set<string>();
const turnCache = new Map<string, { source: Entry[]; replies: boolean; turns: TurnSpan[] }>();
const listeners = new Set<() => void>();
let version = 0;

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

function toEntries(page: TimelinePage): Entry[] {
  const entries: Entry[] = [];
  for (const { item, timestamp } of page.entries) {
    const at = Date.parse(timestamp);
    if (Number.isNaN(at)) continue;
    // The plugin leaves empty replies to the host, so they cannot fold.
    if (item.type === "assistant_message" && !item.text?.trim()) continue;
    entries.push({
      type: item.type,
      at,
      ...(item.type === "tool_call" && item.callId ? { callId: item.callId } : {}),
    });
  }
  return entries;
}

function foldKind(type: string, replies: boolean): FoldKind | null {
  switch (type) {
    case "tool_call":
      return "tool";
    case "reasoning":
      return "reasoning";
    case "todo":
      return "todo";
    case "assistant_message":
      return replies ? "reply" : null;
    default:
      return null;
  }
}

/**
 * Splits entries into turns at each prompt. `replies` says whether the plugin
 * draws assistant replies; when it does not, the host draws them and interim
 * replies cannot be hidden.
 */
export function buildTurns(entries: Entry[], replies: boolean): TurnSpan[] {
  const turns: TurnSpan[] = [];
  let start: number | null = null;
  let group: Entry[] = [];

  const close = () => {
    if (start === null) return;
    const work = group.filter((entry) => foldKind(entry.type, true) !== null);
    const lastWorkAt = Math.max(
      start,
      ...work.filter((entry) => entry.type !== "assistant_message").map((entry) => entry.at),
    );
    const folded = work.filter((entry) => {
      const kind = foldKind(entry.type, replies);
      if (kind === null) return false;
      return kind !== "reply" || entry.at <= lastWorkAt;
    });
    const first = folded[0];
    const endAt = Math.max(start, ...group.map((entry) => entry.at));
    if (first && lastWorkAt > start) {
      turns.push({
        startAt: start,
        endAt,
        lastWorkAt,
        workCount: folded.length,
        anchor: {
          kind: foldKind(first.type, replies) as FoldKind,
          at: first.at,
          ...(first.callId ? { callId: first.callId } : {}),
        },
      });
    }
  };

  for (const entry of entries) {
    if (entry.type === "user_message") {
      close();
      start = entry.at;
      group = [];
    } else if (start !== null) {
      group.push(entry);
    }
  }
  close();
  return turns;
}

function turnsFor(agentId: string, replies: boolean): TurnSpan[] {
  const source = entriesByAgent.get(agentId);
  if (!source) return [];
  const cached = turnCache.get(agentId);
  if (cached && cached.source === source && cached.replies === replies) return cached.turns;
  const turns = buildTurns(source, replies);
  turnCache.set(agentId, { source, replies, turns });
  return turns;
}

function load(paseo: ReturnType<typeof usePaseo>, agentId: string, status: string): void {
  if (fetchedStatus.get(agentId) === status || inflight.has(agentId)) return;
  inflight.add(agentId);
  paseo.agents
    .ref(agentId)
    .timeline.refetch({ direction: "tail", limit: PAGE_LIMIT })
    .then((page: TimelinePage) => {
      entriesByAgent.set(agentId, toEntries(page));
      fetchedStatus.set(agentId, status);
      publish();
    })
    .catch(() => {
      // Without the timeline nothing folds; the chat renders as it always has.
    })
    .finally(() => {
      inflight.delete(agentId);
    });
}

function findTurn(turns: TurnSpan[], at: number): TurnSpan | null {
  for (const turn of turns) {
    if (at >= turn.startAt && at <= turn.endAt + SLACK_MS) return turn;
  }
  return null;
}

function isAnchor(turn: TurnSpan, kind: FoldKind, at: number, callId?: string): boolean {
  const { anchor } = turn;
  if (anchor.kind !== kind) return false;
  if (anchor.callId || callId) return anchor.callId === callId;
  return Math.abs(anchor.at - at) <= SLACK_MS;
}

function turnKey(agentId: string, turn: TurnSpan): string {
  return `${agentId}:${turn.startAt}`;
}

export function toggleTurn(agentId: string, turn: TurnSpan): void {
  const key = turnKey(agentId, turn);
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  publish();
}

export interface TurnFold {
  /** The row's own content is folded away. */
  hidden: boolean;
  /** The row carries the turn's "Worked for" header. */
  header: { turn: TurnSpan; expanded: boolean } | null;
}

const VISIBLE: TurnFold = { hidden: false, header: null };

interface UseTurnFoldOptions {
  agentId: string;
  timestamp: Date;
  kind: FoldKind;
  callId?: string;
  enabled: boolean;
  /** Whether the plugin draws assistant replies. */
  replies: boolean;
}

export function useTurnFold({
  agentId,
  timestamp,
  kind,
  callId,
  enabled,
  replies,
}: UseTurnFoldOptions): TurnFold {
  const paseo = usePaseo();
  const status = useAgent(agentId, (agent) => agent.status);
  useSyncExternalStore(subscribe, getVersion, getVersion);

  useEffect(() => {
    if (enabled && status) load(paseo, agentId, status);
  }, [enabled, paseo, agentId, status]);

  if (!enabled) return VISIBLE;
  const turns = turnsFor(agentId, replies);
  const at = timestamp.getTime();
  const turn = findTurn(turns, at);
  if (!turn) return VISIBLE;
  // A running agent is working on its newest turn, which stays open.
  if (status === "running" && turn === turns[turns.length - 1]) return VISIBLE;
  if (kind === "reply" && at > turn.lastWorkAt) return VISIBLE;

  const open = expanded.has(turnKey(agentId, turn));
  const header = isAnchor(turn, kind, at, callId) ? { turn, expanded: open } : null;
  return { hidden: !open, header };
}

export function formatWorkedDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
