import React from 'react';
import { X, Image, Video } from 'lucide-react';

export default function MediaModal({ onClose, onSelectType }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#151B2D]/40 backdrop-blur-sm animate-fadeIn">
      <div className="w-full sm:max-w-md bg-white rounded-t-[32px] sm:rounded-[32px] p-5 sm:p-7 shadow-titan-modal border border-[#E8EBF3] pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-7">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-[#151B2D] text-base">Select Media Type</h3>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#788395] hover:text-[#151B2D] hover:bg-[#F8F9FD] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-2">
          <button
            onClick={() => onSelectType('photo')}
            className="p-6 bg-[#FFF0F2] hover:bg-[#ffe5e8] border border-[#ffe0e4] rounded-[24px] flex flex-col items-center justify-center gap-3 transition group active:scale-95"
          >
            <div className="w-14 h-14 rounded-full bg-white text-[#F16B72] flex items-center justify-center shadow-titan-sm group-hover:scale-105 transition">
              <Image className="w-7 h-7" />
            </div>
            <span className="font-bold text-[#151B2D] text-sm">Photos</span>
          </button>

          <button
            onClick={() => onSelectType('video')}
            className="p-6 bg-[#EEF1FF] hover:bg-[#e4e8ff] border border-[#dce1ff] rounded-[24px] flex flex-col items-center justify-center gap-3 transition group active:scale-95"
          >
            <div className="w-14 h-14 rounded-full bg-white text-[#5865E9] flex items-center justify-center shadow-titan-sm group-hover:scale-105 transition">
              <Video className="w-7 h-7" />
            </div>
            <span className="font-bold text-[#151B2D] text-sm">Videos</span>
          </button>
        </div>
      </div>
    </div>
  );
}
