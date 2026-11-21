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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#151B2D]/40 backdrop-blur-sm animate-fadeIn">
      <div className="w-full sm:max-w-md bg-white rounded-t-[32px] sm:rounded-[32px] p-5 sm:p-7 shadow-titan-modal border border-[#E8EBF3] pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-7">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-[#151B2D] text-base">Share Text or Note</h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#788395] hover:text-[#151B2D] hover:bg-[#F8F9FD] transition"
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
            className="w-full p-4 bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl text-sm text-[#151B2D] focus:outline-none focus:ring-2 focus:ring-[#5865E9]/20 focus:border-[#5865E9] transition resize-none placeholder:text-[#788395]/60"
          />
          <button
            onClick={handlePaste}
            className="absolute right-3.5 bottom-4 px-3 py-1.5 bg-white border border-[#E8EBF3] text-[#5865E9] rounded-xl text-xs font-semibold flex items-center gap-1.5 hover:bg-[#EEF1FF] transition shadow-titan-sm"
          >
            <Clipboard className="w-3.5 h-3.5" />
            <span>Paste</span>
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-[#788395] mb-5 px-1 font-medium">
          <span>{text.length} characters</span>
          <span>Fast direct transfer</span>
        </div>

        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className="w-full py-3.5 bg-[#5865E9] hover:bg-[#4c57d8] disabled:opacity-40 text-white font-semibold text-sm rounded-2xl transition flex items-center justify-center gap-2 shadow-titan-sm"
        >
          <Send className="w-4 h-4" />
          <span>Send Text</span>
        </button>
      </div>
    </div>
  );
}
