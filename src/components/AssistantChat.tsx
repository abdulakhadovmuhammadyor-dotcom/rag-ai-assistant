'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Sparkles, X } from 'lucide-react';

interface Source {
  id: string;
  title?: string;
  similarity: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
}

interface ChatApiResponse {
  answer?: string;
  sources?: Source[];
  error?: string;
}

const STORAGE_KEY = 'aura-assistant-chat-v1';
const MAX_HISTORY = 20;

const SUGGESTIONS = [
  'Сколько стоит IELTS?',
  'Как записаться на пробный урок?',
  'График работы центра',
];

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content:
    'Здравствуйте! Я — ассистент AURA Academy. Подскажу цены, расписание, условия обучения и помогу записаться на бесплатный пробный урок.',
};

export const AssistantChat: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      const restored = parsed
        .filter(
          (item): item is ChatMessage =>
            Boolean(
              item &&
                (item.role === 'user' || item.role === 'assistant') &&
                typeof item.content === 'string'
            )
        )
        .slice(-MAX_HISTORY);
      if (restored.length > 0) setMessages(restored);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    if (messages.length <= 1) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(messages.slice(-MAX_HISTORY))
      );
    } catch {
      return;
    }
  }, [messages]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, messages, loading]);

  const send = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || loading) return;

    const history = messages
      .slice(1)
      .slice(-MAX_HISTORY)
      .map(({ role, content }) => ({ role, content }));

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });

      const data: ChatApiResponse = await response.json().catch(() => ({}));

      if (!response.ok || !data.answer) {
        throw new Error(data.error || 'Не удалось получить ответ.');
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer as string,
          sources: data.sources,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            error instanceof Error
              ? `Не получилось ответить: ${error.message}`
              : 'Не получилось ответить. Попробуйте ещё раз.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Закрыть чат' : 'Открыть чат с ассистентом'}
        className="fixed bottom-6 right-5 sm:right-6 z-50 inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-3.5 text-sm font-bold text-slate-950 shadow-2xl shadow-amber-500/25 transition-all hover:bg-amber-400 hover:scale-105 active:scale-95"
      >
        {open ? (
          <X className="w-5 h-5" />
        ) : (
          <>
            <MessageCircle className="w-5 h-5" />
            <span className="hidden sm:inline">Спросить ассистента</span>
            <Sparkles className="w-4 h-4" />
          </>
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 flex w-[calc(100vw-2rem)] max-w-[410px] flex-col overflow-hidden rounded-3xl border border-amber-500/25 bg-[#0b1120]/98 shadow-2xl shadow-black/60 backdrop-blur-md">
          <div className="flex items-center gap-3 border-b border-slate-800/80 bg-slate-900/80 px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">
                AURA Assistant
              </p>
              <p className="truncate text-[11px] text-slate-400">
                RAG · gemini-3.5-flash-lite
              </p>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 max-h-[46vh]">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-amber-500 text-slate-950 rounded-br-md font-medium'
                      : 'bg-slate-800/80 text-slate-100 rounded-bl-md border border-slate-700/60'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>

                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-slate-700/60 pt-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Источники
                      </p>
                      {message.sources.map((source) => (
                        <p
                          key={source.id}
                          className="flex items-center justify-between gap-2 text-[11px] text-slate-400"
                        >
                          <span className="truncate">{source.title}</span>
                          <span className="shrink-0 text-amber-400/80">
                            {source.similarity}%
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-700/60 bg-slate-800/80 px-4 py-3 text-sm text-slate-300">
                  <span className="h-2 w-2 animate-ping rounded-full bg-amber-400" />
                  Ищу ответ в базе знаний…
                </div>
              </div>
            )}

            {messages.length === 1 && !loading && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:border-amber-500/40 hover:text-amber-400"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="border-t border-slate-800/80 bg-slate-900/70 p-3">
            <div className="flex items-end gap-2 rounded-2xl border border-slate-700 bg-slate-950/80 px-3 py-2 focus-within:border-amber-500/50">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Задайте вопрос о курсах, ценах…"
                className="max-h-28 flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={loading || !input.trim()}
                aria-label="Отправить сообщение"
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-500">
              Ответы формируются по прайс-листу, FAQ и графику работы
            </p>
          </div>
        </div>
      )}
    </>
  );
};
