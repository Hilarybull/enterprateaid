import { useMemo, useRef, useState } from "react";
import Button from "./Button";
import { apiRequest } from "../api/client";
import { useWorkspaceStore } from "../store/workspace";

const STARTER_PROMPTS = [
  "What does my business do?",
  "What is my business registration status?",
  "Summarise my current services",
  "What do my latest simulations suggest?",
  "Who is my target market?",
  "What should I improve next?",
];

export default function BusinessAssistant() {
  const workspaceName = useWorkspaceStore((state) => state.workspaceName);
  const intro = `Hi - ask me anything about ${workspaceName || "your business"}. I'll answer from your workspace, documents, catalogue, financials, validations, registrations, and simulations.`;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([{ role: "assistant", content: intro }]);
  const listRef = useRef(null);

  const sendDisabled = !String(input || "").trim() || loading;
  const title = useMemo(() => workspaceName || "Business assistant", [workspaceName]);

  function resetConversation() {
    setMessages([{ role: "assistant", content: intro }]);
    setInput("");
  }

  async function send(prefilledQuestion = "") {
    const question = String(prefilledQuestion || input || "").trim();
    if (!question) return;

    const nextMessages = [...messages, { role: "user", content: question }];
    const trimmedMessages = nextMessages.slice(-20);
    setMessages(trimmedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await apiRequest("/business-assistant/chat", "POST", {
        messages: trimmedMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res?.answer || "I couldn't find a clear answer just yet." },
      ]);

      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error || "");
      let friendly = "I couldn't answer that right now. Please try again.";
      if (raw.includes("404") || raw.toLowerCase().includes("workspace not found")) {
        friendly = "It looks like you haven't set up a workspace yet. Create one first and I'll be able to answer questions about your business.";
      } else if (raw.includes("401") || raw.includes("403")) {
        friendly = "Your session may have expired. Try refreshing the page and signing in again.";
      } else if (error?.code === "NETWORK_ERROR" || raw === "NETWORK_ERROR" || raw.toLowerCase().includes("network") || raw.toLowerCase().includes("reach the server")) {
        friendly = "I can't reach the server right now. Check your connection and try again.";
      } else if (raw.includes("500")) {
        friendly = "Something went wrong on our end. Please try again in a moment.";
      }
      setMessages((prev) => [...prev, { role: "assistant", content: friendly }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {open ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+4.75rem)] z-40 flex h-[min(720px,calc(100vh-6rem))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 sm:inset-x-auto sm:bottom-20 sm:right-4 sm:w-[420px] lg:bottom-4 lg:w-[440px]">
          <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-brand-50 via-white to-accent-50 px-4 py-3 dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetConversation}
                className="rounded-xl p-2 text-slate-500 hover:bg-white dark:hover:bg-slate-900"
                aria-label="Reset conversation"
                title="Reset conversation"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v5h5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl p-2 text-slate-500 hover:bg-white dark:hover:bg-slate-900"
                aria-label="Close assistant"
                title="Close assistant"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m18 6-12 12" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>

          {messages.length <= 1 ? (
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Try asking</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div ref={listRef} className="flex-1 space-y-3 overflow-auto px-4 py-4">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  "max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm " +
                  (message.role === "user"
                    ? "ml-auto bg-brand-600 text-white"
                    : "border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100")
                }
              >
                {message.content}
              </div>
            ))}
            {loading ? (
              <div className="max-w-[88%] rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                Thinking...
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask about customers, revenue, simulations, registration, blueprints, or services..."
                className="min-h-[72px] flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-brand-200 focus:ring dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <Button onClick={() => void send()} disabled={sendDisabled}>
                Send
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-5 z-30 flex items-center overflow-hidden rounded-full bg-brand-600 p-4 text-sm font-semibold text-white shadow-lg transition-all duration-300 hover:bg-brand-700 sm:bottom-20 sm:right-6"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 group-hover:max-w-[200px] group-hover:ml-2">Ask about your business</span>
      </button>
    </>
  );
}
