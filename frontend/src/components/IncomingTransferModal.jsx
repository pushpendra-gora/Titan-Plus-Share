import React, { useState, useEffect } from 'react';
import { Download, CheckCircle2, FileText, ArrowDownLeft, X, FolderCheck, Copy, Check, AlignLeft } from 'lucide-react';
import { formatBytes, getServerUrl } from '../api';
import confetti from 'canvas-confetti';
import { playNotificationSound } from '../utils/audio';

export default function IncomingTransferModal({ incoming, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transferredBytes, setTransferredBytes] = useState(0);
  const [completed, setCompleted] = useState(incoming.isCompleted || incoming.transferType === 'text');
  const [copied, setCopied] = useState(false);
  
  const isText = incoming.transferType === 'text' || !!incoming.textContent;

  const savePath = localStorage.getItem('titan_save_path') || 
    (/Android|iPhone|iPad/i.test(navigator.userAgent) 
      ? '/storage/emulated/0/Download/TitanPlusShare' 
      : 'C:\\Users\\Public\\Downloads\\TitanPlusShare');

  useEffect(() => {
    // 1. Play offline audio chime
    playNotificationSound();

    // 2. Trigger native Android top status bar notification if in background or foreground
    if (window.TitanNativeBridge && typeof window.TitanNativeBridge.showNotification === 'function') {
      const title = isText ? 'Incoming Text Note' : 'Incoming File Transfer';
      const msg = isText 
        ? `From ${incoming.senderName || 'Device'}: "${(incoming.textContent || '').substring(0, 40)}..."` 
        : `From ${incoming.senderName || 'Device'}: ${incoming.fileName} (${formatBytes(incoming.fileSize)})`;
      window.TitanNativeBridge.showNotification(title, msg);
    }

    // 3. If it's a text message, complete immediately
    if (isText) {
      setCompleted(true);
      confetti({ particleCount: 40, spread: 50, origin: { y: 0.6 } });
      return;
    }

    // 4. If laptop already received file directly via server, mark completed
    if (incoming.filePath || incoming.isCompleted) {
      setCompleted(true);
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      return;
    }

    // 5. If mobile receiving a file push with downloadUrl: auto start pull
    if (incoming.downloadUrl) {
      startPull(incoming.downloadUrl, incoming.fileName);
    }
  }, [incoming]);

  const startPull = (downloadUrl, fileName) => {
    setDownloading(true);
    setProgress(0);
    setTransferredBytes(0);

    const xhr = new XMLHttpRequest();
    xhr.open('GET', downloadUrl, true);
    xhr.responseType = 'blob';

    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setProgress(pct);
        setTransferredBytes(e.loaded);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100);
        setCompleted(true);
        setDownloading(false);
        confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });

        const blob = xhr.response;

        // Native Android saving via TitanNativeBridge (saves to Downloads/TitanPlusShare)
        if (window.TitanNativeBridge && typeof window.TitanNativeBridge.saveBase64ToDownloads === 'function') {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            window.TitanNativeBridge.saveBase64ToDownloads(base64data, fileName);
          };
          reader.readAsDataURL(blob);
        } else {
          // Web / Desktop fallback
          const link = document.createElement('a');
          link.href = window.URL.createObjectURL(blob);
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }

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

  const handleCopyText = () => {
    if (incoming.textContent) {
      navigator.clipboard.writeText(incoming.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-white rounded-[26px] p-6 shadow-modal border border-slate-100 text-center relative overflow-hidden">
        
        {/* Top Notification Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full mb-4 border border-blue-100">
          <ArrowDownLeft className="w-3.5 h-3.5" />
          <span>{isText ? 'Text Message Received' : completed ? 'File Received' : 'Receiving File...'}</span>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Graphic */}
        <div className="my-2">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-blue-50 border border-blue-100 flex items-center justify-center shadow-inner">
            {isText ? (
              <AlignLeft className="w-10 h-10 text-blue-600" />
            ) : completed ? (
              <CheckCircle2 className="w-10 h-10 text-emerald-500 animate-scaleIn" />
            ) : (
              <FileText className="w-9 h-9 text-blue-600 animate-bounce" />
            )}
          </div>
        </div>

        {/* Text Message Display (NO FILE CREATED) */}
        {isText ? (
          <div className="my-3">
            <h3 className="font-bold text-slate-900 text-base mb-1">
              Shared by {incoming.senderName || 'Paired Device'}
            </h3>
            <p className="text-[11px] text-slate-400 mb-3 font-medium">
              {(incoming.textContent || '').length} characters
            </p>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-left text-xs text-slate-800 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto mb-4 select-text">
              {incoming.textContent}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCopyText}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl transition flex items-center justify-center gap-2 shadow-md shadow-blue-500/25"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied to Clipboard!' : 'Copy Text'}</span>
              </button>
              <button
                onClick={onClose}
                className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs rounded-xl transition"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          /* File Transfer Display */
          <div className="my-3">
            <h3 className="font-bold text-slate-900 text-base mb-1 truncate px-4">{incoming.fileName}</h3>
            <p className="text-xs text-slate-500 font-medium mb-4">
              From {incoming.senderName || 'Paired Device'} • {formatBytes(incoming.fileSize)}
            </p>

            {/* Real-time Percentage & Bytes */}
            {downloading && (
              <div className="mb-4">
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mb-1.5">
                  <div 
                    className="bg-blue-600 h-full rounded-full transition-all duration-200" 
                    style={{ width: `${progress}%` }} 
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 px-1">
                  <span>{formatBytes(transferredBytes)} / {formatBytes(incoming.fileSize)}</span>
                  <span className="text-blue-600 font-bold">{progress}%</span>
                </div>
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
        )}

      </div>
    </div>
  );
}
