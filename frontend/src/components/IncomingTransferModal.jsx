import React, { useState, useEffect } from 'react';
import { Download, CheckCircle2, FileText, ArrowDownLeft, X, FolderCheck } from 'lucide-react';
import { formatBytes, getServerUrl } from '../api';
import confetti from 'canvas-confetti';
import { playNotificationSound } from '../utils/audio';

export default function IncomingTransferModal({ incoming, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(incoming.isCompleted || false);
  const [savePath, setSavePath] = useState(
    localStorage.getItem('titan_save_path') || 
    (/Android|iPhone|iPad/i.test(navigator.userAgent) 
      ? '/storage/emulated/0/Download/TitanPlusShare' 
      : 'C:\\Users\\Public\\Downloads\\TitanPlusShare')
  );

  useEffect(() => {
    playNotificationSound();

    // If incoming transfer is already on laptop (saved by server), mark done immediately
    if (incoming.filePath || incoming.isCompleted) {
      setCompleted(true);
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      return;
    }

    // If mobile receiving a push from laptop with downloadUrl: auto start pull
    if (incoming.downloadUrl) {
      startPull(incoming.downloadUrl, incoming.fileName);
    }
  }, [incoming]);

  const startPull = (downloadUrl, fileName) => {
    setDownloading(true);
    setProgress(15);

    const xhr = new XMLHttpRequest();
    xhr.open('GET', downloadUrl, true);
    xhr.responseType = 'blob';

    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100);
        setCompleted(true);
        setDownloading(false);
        confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });

        // Trigger browser / Android download save
        const blob = xhr.response;
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Send ACK back to server
        if (incoming.transferId) {
          fetch(`${getServerUrl()}/api/transfer/ack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transferId: incoming.transferId, success: true })
          }).catch(() => {});
        }
      } else {
        setDownloading(false);
      }
    };

    xhr.onerror = () => {
      setDownloading(false);
    };

    xhr.send();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-white rounded-[26px] p-6 shadow-modal border border-slate-100 text-center relative overflow-hidden">
        
        {/* Top Notification Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full mb-4 border border-blue-100">
          <ArrowDownLeft className="w-3.5 h-3.5" />
          <span>{completed ? 'Transfer Complete' : 'Incoming Transfer'}</span>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Graphic */}
        <div className="my-3">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-blue-50 border border-blue-100 flex items-center justify-center shadow-inner">
            {completed ? (
              <CheckCircle2 className="w-10 h-10 text-emerald-500 animate-scaleIn" />
            ) : (
              <FileText className="w-9 h-9 text-blue-600 animate-bounce" />
            )}
          </div>
        </div>

        {/* Content Details */}
        <h3 className="font-bold text-slate-900 text-base mb-1 truncate px-4">{incoming.fileName}</h3>
        <p className="text-xs text-slate-500 font-medium mb-4">
          From {incoming.senderName || 'Paired Device'} • {formatBytes(incoming.fileSize)}
        </p>

        {/* Progress bar if downloading */}
        {downloading && (
          <div className="mb-4">
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mb-1.5">
              <div 
                className="bg-blue-600 h-full rounded-full transition-all duration-200" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <p className="text-[11px] text-blue-600 font-semibold">Receiving... {progress}%</p>
          </div>
        )}

        {/* Saved location notice */}
        {completed && (
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 mb-5 text-left flex items-start gap-2.5">
            <FolderCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-700">Saved to Folder:</div>
              <div className="text-[10px] text-slate-500 truncate font-mono">{savePath}</div>
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={onClose}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl transition shadow-md shadow-blue-500/25"
        >
          {completed ? 'Done' : 'Cancel Transfer'}
        </button>

      </div>
    </div>
  );
}

