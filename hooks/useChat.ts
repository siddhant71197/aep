'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readNdjson } from '@/lib/ndjson';
import type { ChatMessage, ChatRequest, StreamEvent, UserProfile } from '@/lib/types';

const STORAGE_KEY = 'aep-chat-v1';

interface PersistedChat {
  messages: ChatMessage[];
  profile: UserProfile;
}

const FRIENDLY_NETWORK_ERROR =
  "I couldn't reach the server. Please check your connection and try again.";
const FRIENDLY_SERVER_ERROR = 'Something went wrong on our end. Please try again in a moment.';

function loadPersisted(): PersistedChat | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedChat>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      profile: parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : {},
    };
  } catch {
    return null;
  }
}

function savePersisted(data: PersistedChat) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable (private mode) — non-fatal.
  }
}

function clearPersisted() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export interface UseChat {
  messages: ChatMessage[];
  profile: UserProfile;
  isStreaming: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  dismissError: () => void;
}

export function useChat(): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profile, setProfile] = useState<UserProfile>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const profileRef = useRef<UserProfile>(profile);
  const streamingRef = useRef(false);
  const greetingStartedRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Load persisted chat after mount so server and first client render match.
  useEffect(() => {
    const saved = loadPersisted();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage */
    if (saved) {
      setMessages(saved.messages);
      setProfile(saved.profile);
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Persist whenever a turn settles (skip per-delta writes while streaming).
  useEffect(() => {
    if (!hydrated || isStreaming) return;
    if (messages.length === 0 && Object.keys(profile).length === 0) {
      clearPersisted();
      return;
    }
    savePersisted({ messages, profile });
  }, [messages, profile, isStreaming, hydrated]);

  // Abort any in-flight request on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * POST `body` to the chat API and stream the reply into the assistant message
   * `assistantId` (already present in state as an empty placeholder).
   */
  const streamReply = useCallback(async (body: ChatRequest, assistantId: string) => {
    setError(null);
    setIsStreaming(true);
    streamingRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    const updateAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

    const applyEvent = (ev: StreamEvent) => {
      switch (ev.type) {
        case 'text':
          if (ev.delta) updateAssistant((m) => ({ ...m, content: m.content + ev.delta }));
          break;
        case 'profile':
          setProfile(ev.profile ?? {});
          break;
        case 'suggestions':
          updateAssistant((m) => ({
            ...m,
            suggestions: ev.items,
            suggestionSource: ev.source,
          }));
          break;
        case 'error':
          setError(ev.message || FRIENDLY_SERVER_ERROR);
          break;
        case 'meta':
        case 'done':
          break;
      }
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError(
          res.status === 429
            ? "You're sending messages a little fast. Please wait a moment and try again."
            : FRIENDLY_SERVER_ERROR,
        );
        return;
      }

      for await (const ev of readNdjson(res.body)) {
        if (controller.signal.aborted) break;
        applyEvent(ev);
        if (ev.type === 'done') break;
      }
    } catch (err) {
      if (!isAbortError(err) && !controller.signal.aborted) {
        setError(err instanceof TypeError ? FRIENDLY_NETWORK_ERROR : FRIENDLY_SERVER_ERROR);
      }
    } finally {
      // Only the current request owns the streaming flags (reset() may already have started a new one).
      if (abortRef.current === controller) {
        abortRef.current = null;
        streamingRef.current = false;
        setIsStreaming(false);
      }
      // Drop the placeholder if nothing arrived (error / immediate stop).
      setMessages((prev) =>
        prev.filter(
          (m) =>
            m.id !== assistantId ||
            m.content.trim().length > 0 ||
            (m.suggestions && m.suggestions.length > 0),
        ),
      );
    }
  }, []);

  /** Ask Gemini for the opening greeting (empty conversation). */
  const startConversation = useCallback(() => {
    if (streamingRef.current) return;
    const assistantId = newId();
    const placeholder: ChatMessage = { id: assistantId, role: 'assistant', content: '', createdAt: Date.now() };
    messagesRef.current = [placeholder];
    setMessages([placeholder]);
    void streamReply({ messages: [], profile: {}, start: true }, assistantId);
  }, [streamReply]);

  // Open a fresh conversation with a Gemini greeting once hydration finds no saved chat.
  // The ref guards against React StrictMode invoking the effect twice.
  useEffect(() => {
    if (!hydrated || greetingStartedRef.current) return;
    greetingStartedRef.current = true;
    if (messagesRef.current.length === 0) startConversation();
  }, [hydrated, startConversation]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streamingRef.current) return;

      const now = Date.now();
      const userMsg: ChatMessage = { id: newId(), role: 'user', content, createdAt: now };
      const assistantId = newId();
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now + 1,
      };

      // Full history, suggestions included — the server derives cadence from them.
      const history = [...messagesRef.current, userMsg];
      const next = [...history, placeholder];
      messagesRef.current = next;
      setMessages(next);
      await streamReply({ messages: history, profile: profileRef.current }, assistantId);
    },
    [streamReply],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingRef.current = false;
    messagesRef.current = [];
    profileRef.current = {};
    setMessages([]);
    setProfile({});
    setIsStreaming(false);
    setError(null);
    clearPersisted();
    startConversation();
  }, [startConversation]);

  const dismissError = useCallback(() => setError(null), []);

  return { messages, profile, isStreaming, error, send, stop, reset, dismissError };
}
