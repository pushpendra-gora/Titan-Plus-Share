import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, ArrowUpRight, Laptop, Smartphone, AlertCircle, RefreshCw } from 'lucide-react';
import { formatBytes, getServerUrl } from '../api';
import confetti from 'canvas-confetti';
import JSZip from 'jszip';

export default function TransferProgressModal({ targetDevice, item, onClose }) {
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState('0 MB/s');
  const [transferredBytes, setTransferredBytes] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const xhrRef = useRef(null);

  const startRealTransfer = async () => {
    setError(null);
    setProgress(0);
    setTransferredBytes(0);
    setIsDone(false);
    setStatusMessage('');

    const targetHost = targetDevice.ip ? `http://${targetDevice.ip}:${targetDevice.port || 51733}` : getServerUrl();
    const formData = new FormData();
    formData.append('senderId', localStorage.getItem('titan_device_id') || 'dev');
    formData.append('senderName', localStorage.getItem('titan_device_name') || 'Device');

    if (item.type === 'text') {
      const blob = new Blob([item.text || ''], { type: 'text/plain' });
      formData.append('file', blob, 'Shared_Note.txt');
      formData.append('originalName', 'Shared_Note.txt');
    } else if (item.type === 'folder' && item.files && item.files.length > 0) {
      setStatusMessage('Packaging folder into zip archive...');
      try {
        const zip = new JSZip();
        for (let i = 0; i < item.files.length; i++) {
          const f = item.files[i];
          zip.file(f.webkitRelativePath || f.name, f);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
          setProgress(Math.round(meta.percent / 2)); // 0-50% for zipping
        });
        const zipName = item.name.endsWith('.zip') ? item.name : `${item.name}.zip`;
        formData.append('file', zipBlob, zipName);
        formData.append('originalName', zipName);
        setStatusMessage('Sending folder to device...');
      } catch (err) {
        setError('Failed to zip folder: ' + err.message);
        return;
      }
    } else if (item.file) {
      formData.append('file', item.file);
      formData.append('originalName', item.name);
    } else if (item.files && item.files[0]) {
      formData.append('file', item.files[0]);
      formData.append('originalName', item.name);
    } else {
      const blob = new Blob([item.name || ''], { type: 'text/plain' });
      formData.append('file', blob, item.name || 'file.dat');
    }

    const startTime = Date.now();
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.open('POST', `${targetHost}/api/transfer/send`, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const basePct = item.type === 'folder' ? 50 : 0;
        const uploadPct = Math.round((e.loaded / e.total) * (item.type === 'folder' ? 50 : 100));
        setProgress(basePct + uploadPct);
        setTransferredBytes(e.loaded);

        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 0.1) {
          const mbps = ((e.loaded / (1024 * 1024)) / elapsed).toFixed(1);
          setSpeed(`${mbps} MB/s`);
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100);
        setIsDone(true);
        confetti({
          particleCount: 60,
          spread: 60,
          origin: { y: 0.6 }
        });
      } else {
        setError(`Transfer failed (HTTP ${xhr.status})`);
      }
    };

    xhr.onerror = () => {
      setError(`Cannot reach ${targetDevice.deviceName} at ${targetHost}. Ensure both are on the same Wi-Fi.`);
    };

    xhr.send(formData);
  };

  useEffect(() => {
    startRealTransfer();
    return () => {
      if (xhrRef.current) {
        try { xhrRef.current.abort(); } catch (e) {}
      }
    };
  }, [item, targetDevice]);

  const handleCancel = () => {
    if (xhrRef.current) {
      try { xhrRef.current.abort(); } catch (e) {}
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md bg-white rounded-[26px] p-6 shadow-modal border border-slate-100 text-center">
        
        {/* Device Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              {targetDevice.deviceType === 'laptop' ? <Laptop className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
            </div>
            <div className="text-left">
              <h4 className="text-sm font-semibold text-slate-800">{targetDevice.deviceName}</h4>
              <p className="text-[11px] text-emerald-500 font-medium">Direct LAN Stream</p>
            </div>
          </div>
          {(isDone || error) && (
            <button 
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Status Graphic */}
        <div className="my-6">
          <div className="relative w-24 h-24 mx-auto flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-100"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className={error ? 'text-rose-500' : 'text-blue-600 transition-all duration-200'}
                strokeDasharray={`${progress}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {error ? (
                <AlertCircle className="w-8 h-8 text-rose-500" />
              ) : isDone ? (
                <CheckCircle2 className="w-9 h-9 text-emerald-500 animate-scaleIn" />
              ) : (
                <span className="text-xl font-bold text-slate-800">{progress}%</span>
              )}
            </div>
          </div>
        </div>

        {/* File & Transfer Info */}
        <div className="mb-6">
          <h4 className="font-semibold text-slate-800 text-sm mb-1 truncate px-4">{item.name}</h4>
          
          {error ? (
            <p className="text-xs text-rose-500 font-medium px-4">{error}</p>
          ) : (
            <>
              <p className="text-xs text-slate-500 font-medium">
                {statusMessage ? statusMessage : `${formatBytes(transferredBytes)} / ${formatBytes(item.size)}`}
              </p>
              {!isDone && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full text-[11px] font-semibold text-slate-600">
                  <ArrowUpRight className="w-3 h-3 text-blue-600" />
                  <span>Real Speed: {speed}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom Button */}
        {error ? (
          <div className="flex gap-2">
            <button
              onClick={startRealTransfer}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl transition flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
            <button
              onClick={onClose}
              className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs rounded-xl transition"
            >
              Close
            </button>
          </div>
        ) : isDone ? (
          <button
            onClick={onClose}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition shadow-lg shadow-blue-500/25"
          >
            Transfer Completed
          </button>
        ) : (
          <button
            onClick={handleCancel}
            className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium text-xs rounded-xl transition"
          >
            Cancel Transfer
          </button>
        )}

      </div>
    </div>
  );
}
