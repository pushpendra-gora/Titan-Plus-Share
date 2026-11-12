import React from 'react';
import { X, Image, Video } from 'lucide-react';

export default function MediaModal({ onClose, onSelectType }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-fadeIn">
      <div className="w-full sm:max-w-md bg-white rounded-t-[28px] sm:rounded-[26px] p-4 sm:p-6 shadow-modal border border-slate-100 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-slate-800 text-base">Select Media Type</h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3.5 mb-2">
          <button
            onClick={() => onSelectType('photo')}
            className="p-5 bg-blue-50/70 hover:bg-blue-100/60 border border-blue-100 rounded-2xl flex flex-col items-center justify-center gap-3 transition group"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20 group-hover:scale-105 transition">
              <Image className="w-6 h-6" />
            </div>
            <span className="font-semibold text-slate-800 text-sm">Choose Photos</span>
          </button>

          <button
            onClick={() => onSelectType('video')}
            className="p-5 bg-sky-50/70 hover:bg-sky-100/60 border border-sky-100 rounded-2xl flex flex-col items-center justify-center gap-3 transition group"
          >
            <div className="w-12 h-12 rounded-xl bg-sky-500 text-white flex items-center justify-center shadow-md shadow-sky-500/20 group-hover:scale-105 transition">
              <Video className="w-6 h-6" />
            </div>
            <span className="font-semibold text-slate-800 text-sm">Choose Videos</span>
          </button>
        </div>
      </div>
    </div>
  );
}
