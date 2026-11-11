import React, { useState } from 'react';
import { X, Send, Clipboard } from 'lucide-react';

export default function TextModal({ onClose, onSendText }) {
  const [text, setText] = useState('');

  const handlePaste = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      setText(clipText);
    } catch (e) {
      alert('Clipboard access denied');
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    onSendText(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-fadeIn">
      <div className="w-full sm:max-w-md bg-white rounded-t-[28px] sm:rounded-[26px] p-6 shadow-modal border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800 text-base">Share Text or Note</h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative mb-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or paste text, links, or notes here..."
            rows={6}
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition resize-none"
          />
          <button
            onClick={handlePaste}
            className="absolute right-3 bottom-4 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-50 transition shadow-sm"
          >
            <Clipboard className="w-3.5 h-3.5" />
            <span>Paste</span>
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400 mb-5 px-1">
          <span>{text.length} characters</span>
          <span>Fast direct transfer</span>
        </div>

        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30"
        >
          <Send className="w-4 h-4" />
          <span>Send Text</span>
        </button>
      </div>
    </div>
  );
}
