import React, { useState } from 'react';
import { Link as LinkIcon, Download, CheckCircle, Clock, FileText, AlertCircle, RefreshCw } from 'lucide-react';
import { getLinkInfo, formatBytes, getServerUrl } from '../api';

export default function LinksView() {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const extractToken = (text) => {
    const trimmed = text.trim();
    if (trimmed.includes('/d/')) {
      return trimmed.split('/d/')[1].split('/')[0].split('?')[0];
    }
    return trimmed;
  };

  const handleValidate = async () => {
    setError(null);
    setFileInfo(null);
    if (!urlInput.trim()) {
      setError('Please enter a valid link or token');
      return;
    }

    setLoading(true);
    try {
      const info = await getLinkInfo(urlInput);
      setFileInfo(info);
    } catch (err) {
      setError(err.message || 'Link expired or not reachable. Ensure the host laptop is online.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartDownload = () => {
    if (!fileInfo) return;
    setDownloading(true);
    setProgress(20);

    const downloadUrl = fileInfo.directUrl || `${getServerUrl()}/api/links/download/${fileInfo.token}`;
    
    // Animate progress then trigger browser download
    const intv = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(intv);
          setDownloading(false);
          window.location.href = downloadUrl;
          return 100;
        }
        return p + 25;
      });
    }, 150);
  };

  const formatRemaining = (seconds) => {
    if (seconds <= 0) return 'Expired';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m remaining`;
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 animate-fadeIn">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Remote Downloads</h2>
        <p className="text-xs text-slate-500">Paste any Titan Plus Share link to download securely</p>
      </div>

      {/* Input Card */}
      <div className="bg-white rounded-[22px] p-5 shadow-card border border-slate-100 mb-6">
        <label className="block text-xs font-semibold text-slate-600 mb-2">Download Link</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500 transition">
            <LinkIcon className="w-4 h-4 text-blue-600 shrink-0" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste Titan Plus link here..."
              className="bg-transparent text-xs text-slate-800 font-medium w-full outline-none"
            />
          </div>
          <button
            onClick={handleValidate}
            disabled={loading || !urlInput.trim()}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition shrink-0 flex items-center gap-1.5 shadow-md shadow-blue-500/25"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Validate'}
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-rose-500 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* File Metadata Preview Card */}
      {fileInfo && (
        <div className="bg-white rounded-[22px] p-6 shadow-card border border-slate-100 animate-scaleIn">
          <div className="flex items-center gap-3.5 mb-5">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center font-bold text-sm shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-800 text-sm truncate">{fileInfo.fileName}</h3>
              <p className="text-xs text-slate-500">{formatBytes(fileInfo.fileSize)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 mb-5 text-xs text-slate-500">
            <div className="flex items-center gap-1.5 font-medium">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>Link Expiry</span>
            </div>
            <span className="font-semibold text-slate-700">{formatRemaining(fileInfo.remainingSeconds)}</span>
          </div>

          {downloading && (
            <div className="mb-4">
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-400 text-center mt-1.5">Preparing download stream...</p>
            </div>
          )}

          <button
            onClick={handleStartDownload}
            disabled={downloading || fileInfo.isExpired}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30"
          >
            <Download className="w-4 h-4" />
            <span>{downloading ? 'Downloading...' : 'Download File'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
