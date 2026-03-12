'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<{ time: string; msg: string; type: 'info' | 'error' }[]>([]);

  const addLog = (msg: string, type: 'info' | 'error' = 'info') => {
    setLogs((prev) => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev]);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError('');
    addLog(`יום בשליחת הודעה ל-${phoneNumber}...`);

    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, message }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send');
      }

      setStatus('success');
      addLog(`ההודעה נשלחה בהצלחה! מזהה: ${data.idMessage}`);
      setMessage('');
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      addLog(`שגיאה: ${err.message}`, 'error');
    }
  };

  const [threadId, setThreadId] = useState('');

  useEffect(() => {
    setThreadId(`thread_${Math.random().toString(36).substr(2, 9)}`);
  }, []);

  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMsg = { role: 'user' as const, content: chatInput };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setIsChatting(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...chatMessages, userMsg], threadId }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      if (data.status === 'bot_bypassed') {
        addLog(`הבוט של רותם במצב עקיפה (התערבות אנושית).`);
      } else if (data.content) {
        setChatMessages((prev) => [...prev, { role: 'assistant', content: data.content }]);
      }
    } catch (err: any) {
      addLog(`Chat Error: ${err.message}`, 'error');
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0b141a] text-[#e9edef] font-sans selection:bg-[#00a884] selection:text-white pb-20">
      <div className="fixed inset-0 pointer-events-none bg-[url('https://static.whatsapp.net/rsrc.php/v3/y6/r/wa669ae5z23.png')] opacity-[0.03]"></div>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-12">
        <header className="mb-12 text-center">
          <div className="inline-flex items-center justify-center p-3 mb-4 rounded-2xl bg-[#202c33] shadow-xl border border-[#303c43] animate-bounce-slow">
             <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 4C11.163 4 4 11.163 4 20C4 22.827 4.733 25.485 6.014 27.794L4 35L11.458 33.028C13.882 34.28 16.848 35 20 35C28.837 35 36 27.837 36 20C36 11.163 28.837 4 20 4Z" fill="#25D366"/>
              <path d="M20 31.667C17.292 31.667 14.733 30.957 12.518 29.718L12.012 29.432L7.696 30.568L8.854 26.353L8.539 25.85C7.16 23.649 6.435 21.096 6.435 18.471C6.435 10.932 12.527 4.839 20.066 4.839C23.717 4.839 27.135 6.261 29.71 8.839C32.285 11.417 33.704 14.839 33.704 18.494C33.704 26.033 27.611 32.126 20.071 32.126L20 31.667Z" fill="white"/>
            </svg>
          </div>
          <h1 className="text-5xl font-extrabold mb-2 tracking-tighter bg-gradient-to-r from-[#25D366] to-[#00a884] bg-clip-text text-transparent">
            WhatsApp & AI Center
          </h1>
          <p className="text-[#8696a0] text-lg font-light tracking-wide">Mastra Agent & Green API Playground</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* WhatsApp Sender */}
          <section className="bg-[#111b21] p-8 rounded-3xl border border-[#202c33] shadow-2xl relative overflow-hidden h-fit">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-[#00a884]"></div>
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#00a884] shadow-[0_0_10px_#00a884]"></span>
              שליחת הודעה
            </h2>
            
            <form onSubmit={handleSend} className="space-y-6">
              <div className="group">
                <label className="block text-sm font-medium text-[#8696a0] mb-2 mr-1 transition-colors group-focus-within:text-[#00a884]">מספר טלפון</label>
                <input
                  type="text"
                  placeholder="972500000000"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full bg-[#202c33] border border-[#303c43] rounded-2xl px-5 py-4 text-white placeholder-[#667781] focus:outline-none focus:ring-2 focus:ring-[#00a884]/50 focus:border-[#00a884] transition-all shadow-inner"
                  required
                />
              </div>
              
              <div className="group">
                <label className="block text-sm font-medium text-[#8696a0] mb-2 mr-1 transition-colors group-focus-within:text-[#00a884]">תוכן ההודעה</label>
                <textarea
                  placeholder="מה נשלח?"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full bg-[#202c33] border border-[#303c43] rounded-2xl px-5 py-4 text-white placeholder-[#667781] focus:outline-none focus:ring-2 focus:ring-[#00a884]/50 focus:border-[#00a884] transition-all h-32 resize-none shadow-inner"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={status === 'sending'}
                className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all transform active:scale-[0.98] ${
                  status === 'sending' 
                    ? 'bg-[#202c33] text-[#667781] cursor-not-allowed' 
                    : 'bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] shadow-xl shadow-[#00a884]/20'
                }`}
              >
                {status === 'sending' ? (
                  <div className="w-6 h-6 border-3 border-[#667781] border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    שלח עכשיו
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M1.101 21.75L23.062 12 1.101 2.25l.011 7.587 15.602 2.163-15.602 2.163z" />
                    </svg>
                  </>
                )}
              </button>
            </form>
          </section>

          {/* AI Agent Chat (Rotem) */}
          <section className="lg:col-span-2 bg-[#111b21] p-8 rounded-3xl border border-[#202c33] shadow-2xl flex flex-col h-[700px] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1.5 h-full bg-[#fa7070]"></div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#fa7070]/20 flex items-center justify-center text-xl shadow-lg border border-[#fa7070]/30 animate-pulse">❤️</div>
                <div>
                  <div className="text-white">רותם (AI Agent)</div>
                  <div className="text-[10px] text-[#fa7070] font-mono tracking-widest uppercase">Cute & Kind Persona</div>
                </div>
              </h2>
              <button 
                onClick={() => setChatMessages([])}
                className="text-[#8696a0] hover:text-white transition-colors text-sm"
              >
                נקה שיחה
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 mb-6 pr-2 custom-scrollbar p-4 bg-[#0b141a]/50 rounded-2xl border border-[#202c33]">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#8696a0] space-y-4">
                  <div className="text-4xl">✨</div>
                  <p className="max-w-[200px] text-center text-sm">היי אהוב/ה! אני רותם, הסוכנת האישית שלך. בוא/י נדבר!</p>
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-5 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-[#005c4b] text-white rounded-tr-none' 
                        : 'bg-[#202c33] text-[#e9edef] rounded-tl-none border border-[#303c43]'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
              {isChatting && (
                <div className="flex justify-start">
                   <div className="bg-[#202c33] px-5 py-3 rounded-2xl rounded-tl-none border border-[#303c43] flex gap-1">
                      <div className="w-1.5 h-1.5 bg-[#fa7070] rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-[#fa7070] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-1.5 h-1.5 bg-[#fa7070] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                   </div>
                </div>
              )}
            </div>

            <form onSubmit={handleChat} className="relative">
              <input
                type="text"
                placeholder="תכתבו לי משהו חמוד..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={isChatting}
                className="w-full bg-[#202c33] border border-[#303c43] rounded-2xl px-6 py-4 text-white pr-16 focus:outline-none focus:ring-2 focus:ring-[#fa7070]/50 transition-all opacity-90"
              />
              <button
                type="submit"
                disabled={isChatting}
                className="absolute left-3 top-1/2 -translate-y-1/2 bg-[#fa7070] hover:bg-[#ff8585] text-white p-2.5 rounded-xl transition-all shadow-lg active:scale-90 disabled:opacity-50"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
                </svg>
              </button>
            </form>
          </section>
        </div>

        {/* Global Activity Log Overlay */}
        <section className="mt-8 bg-[#111b21]/80 backdrop-blur-md p-6 rounded-3xl border border-[#202c33] shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#8696a0] flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
               לוג מערכת
            </h3>
          </div>
          <div className="max-h-[150px] overflow-y-auto space-y-2 text-[12px] font-mono custom-scrollbar pr-2">
            {logs.length === 0 ? (
                <div className="text-[#667781] opacity-50">ממתין לפעולות...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`flex gap-4 p-2 rounded-lg ${log.type === 'error' ? 'text-red-400 bg-red-400/5' : 'text-[#00a884] bg-[#00a884]/5'}`}>
                  <span className="opacity-40 shrink-0">[{log.time}]</span>
                  <span className="break-all">{log.msg}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <footer className="mt-12 text-center">
          <p className="text-[#667781] text-xs">Built with ❤️ by Antigravity Agent • Powered by Grok & Mastra</p>
        </footer>
      </div>

      <style jsx global>{`
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 3s infinite ease-in-out;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #303c43;
          border-radius: 10px;
        }
      `}</style>
    </main>
  );
}
