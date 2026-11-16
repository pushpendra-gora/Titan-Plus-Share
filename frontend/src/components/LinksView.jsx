import React, { useState, useEffect, useRef } from 'react';
import { Link as LinkIcon, Download, CheckCircle, Clock, FileText, AlertCircle, RefreshCw, QrCode, Clipboard, Camera, X, Trash2, Copy, CheckCircle2, ArrowDownCircle, ExternalLink, Check, AlignLeft, Wifi, Eye } from 'lucide-react';
import { getLinkInfo, formatBytes, getServerUrl, getLinksList, deleteLink, getDeviceId } from '../api';
import { Html5Qrcode } from 'html5-qrcode';
import confetti from 'canvas-confetti';

export default function LinksView() {
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [myLinks, setMyLinks] = useState([]);
  const [copiedToken, setCopiedToken] = useState(null);
  const [viewQrLink, setViewQrLink] = useState(null);
  const [textCopied, setTextCopied] = useState(false);
  const scannerDomId = useRef(`link-qr-reader-${Math.random().toString(36).substring(2, 7)}`);

  // Load ONLY links created by this current device (Sender only)
  const loadLinksHistory = async () => {
    try {
      const myId = getDeviceId();
      const serverList = await getLinksList();
      const localList = JSON.parse(localStorage.getItem('titan_local_created_links') || '[]');
      
      const map = new Map();
      // Server links that belong to this device
      (serverList || [])
        .filter(item => item.creatorDeviceId === myId)
        .forEach(item => map.set(item.id, item));

      // Local links that belong to this device
      localList
        .filter(item => !item.creatorDeviceId || item.creatorDeviceId === myId)
        .forEach(item => {
          const id = item.token || item.id;
          if (!map.has(id)) {
            map.set(id, {
              id,
              fileName: item.fileName,
              fileSize: item.fileSize,
              type: item.type || 'file',
              createdAt: item.createdAt,
              expiresAt: item.expiresAt,
              status: Date.now() > item.expiresAt ? 'expired' : (item.status || 'pending'),
              downloadProgress: item.downloadProgress || 0,
              url: item.url,
              qrCode: item.qrCode
            });
          }
        });

      setMyLinks(Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
    } catch (e) {
      console.warn('Could not load links list:', e);
    }
  };

  useEffect(() => {
    loadLinksHistory();

    const handleProgress = (e) => {
      if (e.detail?.token) {
        setMyLinks(prev => prev.map(l => {
          if (l.id === e.detail.token) {
            return {
              ...l,
              status: e.detail.percent >= 100 ? 'downloaded' : 'downloading',
              downloadProgress: e.detail.percent
            };
          }
          return l;
        }));
      }
    };

    const handleAccessed = (e) => {
      if (e.detail?.token) {
        setMyLinks(prev => prev.map(l => {
          if (l.id === e.detail.token && l.status !== 'downloaded') {
            return {
              ...l,
              status: 'accessed'
            };
          }
          return l;
        }));
      }
    };

    const handleCompleted = (e) => {
      if (e.detail?.token) {
        setMyLinks(prev => prev.map(l => {
          if (l.id === e.detail.token) {
            return {
              ...l,
              status: 'downloaded',
              downloadProgress: 100,
              downloadCount: (l.downloadCount || 0) + 1,
              lastDownloadedAt: e.detail.downloadedAt || Date.now()
            };
          }
          return l;
        }));
      }
    };

    const handleLinksUpdated = () => {
      loadLinksHistory();
    };

    window.addEventListener('titan-link-progress', handleProgress);
    window.addEventListener('titan-link-accessed', handleAccessed);
    window.addEventListener('titan-link-completed', handleCompleted);
    window.addEventListener('titan-links-updated', handleLinksUpdated);

    const intv = setInterval(loadLinksHistory, 5000);

    return () => {
      window.removeEventListener('titan-link-progress', handleProgress);
      window.removeEventListener('titan-link-accessed', handleAccessed);
      window.removeEventListener('titan-link-completed', handleCompleted);
      window.removeEventListener('titan-links-updated', handleLinksUpdated);
      clearInterval(intv);
    };
  }, []);

  // Check if a link was passed from scanner or other view
  useEffect(() => {
    const pending = localStorage.getItem('titan_pending_download_link');
    if (pending) {
      localStorage.removeItem('titan_pending_download_link');
      setUrlInput(pending);
      validateLink(pending);
    }
  }, []);

  // Handle Mobile hardware / gesture back button
  useEffect(() => {
    if (typeof window.registerTitanBackHandler === 'function') {
      return window.registerTitanBackHandler(() => {
        if (showScanner) {
          setShowScanner(false);
          return true;
        }
        if (fileInfo) {
          setFileInfo(null);
          return true;
        }
        return false;
      });
    }
  }, [showScanner, fileInfo]);

  const validateLink = async (linkToValidate) => {
    const target = (linkToValidate || urlInput).trim();
    setError(null);
    setFileInfo(null);
    setDownloadSuccess(false);
    if (!target) {
      setError('Please enter a valid link or token');
      return;
    }

    setLoading(true);
    try {
      const info = await getLinkInfo(target);
      if (info && info.type === 'text' && !info.textContent) {
        const downloadUrl = info.publicUrl || info.directUrl || `${getServerUrl()}/api/links/download/${info.token}`;
        try {
          const txt = await fetch(downloadUrl).then(r => r.text());
          info.textContent = txt;
        } catch (e) {}
      }
      setFileInfo(info);

      // Instantly notify sender that the link was validated/opened
      sendLinkAck(info, 'validate');
      if (info && info.type === 'text') {
        sendLinkAck(info, 'download');
      }
    } catch (err) {
      setError(err.message || 'Link expired or not reachable. Ensure the host laptop is online.');
    } finally {
      setLoading(false);
    }
  };

  const sendLinkAck = (info, action = 'download') => {
    if (!info) return;
    const token = info.token || info.id;
    if (!token) return;

    // 1. Direct Edge Tunnel ACK to host laptop (works across Cellular 5G/4G & external Wi-Fi)
    if (info.publicUrl) {
      try {
        const tunnelOrigin = new URL(info.publicUrl).origin;
        fetch(`${tunnelOrigin}/api/links/ack?token=${encodeURIComponent(token)}&action=${encodeURIComponent(action)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, action })
        }).catch(() => {});
      } catch (e) {}
    }

    // 2. Direct LAN ACK to host laptop (for same-network Wi-Fi / Hotspot)
    if (info.laptopIp && info.laptopIp !== '127.0.0.1' && info.laptopIp !== 'localhost') {
      const port = info.laptopPort || 51733;
      fetch(`http://${info.laptopIp}:${port}/api/links/ack?token=${encodeURIComponent(token)}&action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action })
      }).catch(() => {});
    }

    // 3. Direct to current configured server URL
    try {
      fetch(`${getServerUrl()}/api/links/ack?token=${encodeURIComponent(token)}&action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action })
      }).catch(() => {});
    } catch (e) {}

    // 4. Direct to Vercel cloud relay
    fetch(`https://titan-plus-share.vercel.app/api/links/ack?token=${encodeURIComponent(token)}&action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action })
    }).catch(() => {});
  };

  const handleCopyTextNote = (text, token) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setTextCopied(true);
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
    sendLinkAck(fileInfo || { token });
    setTimeout(() => setTextCopied(false), 3000);
  };

  const handleValidate = () => validateLink(urlInput);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrlInput(text.trim());
        validateLink(text.trim());
      }
    } catch (e) {
      setError('Clipboard access denied. Please paste manually.');
    }
  };

  // Live Direct Camera QR Scanner for Link (Instant Camera View - Zero intermediate dashboard)
  useEffect(() => {
    if (!showScanner) return;
    let qrCodeInstance = null;
    let isStopped = false;

    const startDirectCamera = async () => {
      try {
        const domId = scannerDomId.current;
        const targetEl = document.getElementById(domId);
        if (!targetEl) return;

        qrCodeInstance = new Html5Qrcode(domId);
        const config = {
          fps: 15,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const boxSize = Math.max(50, Math.floor(minEdge * 0.72));
            return { width: boxSize, height: boxSize };
          }
        };

        const onScanSuccess = async (decodedText) => {
          if (isStopped) return;
          isStopped = true;
          try {
            if (qrCodeInstance && qrCodeInstance.isScanning) {
              await qrCodeInstance.stop();
            }
          } catch (e) {}
          setUrlInput(decodedText.trim());
          setShowScanner(false);
          validateLink(decodedText.trim());
        };

        // Immediately start back camera directly without any buttons or dropdowns
        try {
          await qrCodeInstance.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
        } catch (camErr) {
          try {
            // Fallback to front camera if back camera not available
            await qrCodeInstance.start({ facingMode: "user" }, config, onScanSuccess, () => {});
          } catch (frontErr) {
            try {
              const cameras = await Html5Qrcode.getCameras();
              if (cameras && cameras.length > 0) {
                await qrCodeInstance.start(cameras[0].id, config, onScanSuccess, () => {});
              } else {
                throw new Error('No camera found');
              }
            } catch (allErr) {
              setError('Camera permission required. Please allow camera access in app settings.');
              setShowScanner(false);
            }
          }
        }
      } catch (e) {
        console.warn('Camera direct start error:', e);
        setError('Could not start camera. Please verify camera permissions.');
        setShowScanner(false);
      }
    };

    // Small delay to ensure DOM element is mounted
    const timer = setTimeout(startDirectCamera, 80);

    return () => {
      isStopped = true;
      clearTimeout(timer);
      if (qrCodeInstance) {
        try {
          if (qrCodeInstance.isScanning) {
            qrCodeInstance.stop().then(() => {
              try { qrCodeInstance.clear(); } catch (e) {}
            }).catch(() => {});
          } else {
            try { qrCodeInstance.clear(); } catch (e) {}
          }
        } catch (e) {}
      }
    };
  }, [showScanner]);

  // Bulletproof Multi-platform Download
  const handleStartDownload = () => {
    if (!fileInfo) return;
    setError(null);
    setDownloading(true);
    setProgress(5);
    setDownloadSuccess(false);

    // Priority: Public HTTPS Cloudflare Tunnel URL works across ALL networks (Cellular 5G/4G & external Wi-Fi)
    // Fallback: Direct LAN IP URL for same-network streaming
    const downloadUrl = fileInfo.publicUrl || fileInfo.directUrl || `${getServerUrl()}/api/links/download/${fileInfo.token}`;

    // Handle Text Note directly
    if (fileInfo.type === 'text') {
      const textToSave = fileInfo.textContent || '';
      if (textToSave) {
        navigator.clipboard.writeText(textToSave);
        setProgress(100);
        setDownloading(false);
        setDownloadSuccess(true);
        confetti({ particleCount: 50, spread: 50, origin: { y: 0.6 } });
        // Save as file if native bridge is available
        if (window.TitanNativeBridge && typeof window.TitanNativeBridge.saveBase64ToDownloads === 'function') {
          const b64 = btoa(unescape(encodeURIComponent(textToSave)));
          window.TitanNativeBridge.saveBase64ToDownloads(b64, 'Shared_Text.txt');
        } else {
          const blob = new Blob([textToSave], { type: 'text/plain;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'Shared_Text.txt';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        if (fileInfo.token) {
          fetch(`${getServerUrl()}/api/links/download/${fileInfo.token}`).catch(() => {});
          fetch(`https://titan-plus-share.vercel.app/api/links/ack?token=${fileInfo.token}`).catch(() => {});
        }
        return;
      }
    }

    // Native Android direct stream using MediaStore.Downloads
    if (window.TitanNativeBridge && typeof window.TitanNativeBridge.downloadDirect === 'function') {
      const handleNativeProgress = (e) => {
        if (e.detail?.percent !== undefined) {
          setProgress(e.detail.percent);
        }
      };

      const handleNativeComplete = () => {
        setProgress(100);
        setDownloading(false);
        setDownloadSuccess(true);
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
        sendLinkAck(fileInfo, 'download');
        window.removeEventListener('titan-native-download-progress', handleNativeProgress);
        window.removeEventListener('titan-native-download-complete', handleNativeComplete);
      };

      const handleNativeError = async (e) => {
        const errMsg = e.detail?.error || 'Download failed on device';
        
        // Auto-heal on DNS expiration or network change:
        if (errMsg.includes('Unable to resolve host') || errMsg.includes('No address associated') || errMsg.includes('UnknownHostException')) {
          try {
            const vRes = await fetch(`https://titan-plus-share.vercel.app/api/links/info/${fileInfo.token}`, { signal: AbortSignal.timeout(3000) });
            if (vRes.ok) {
              const freshInfo = await vRes.json();
              if (freshInfo && freshInfo.publicUrl && freshInfo.publicUrl !== downloadUrl) {
                setFileInfo(freshInfo);
                window.TitanNativeBridge.downloadDirect(freshInfo.publicUrl, freshInfo.fileName);
                return;
              }
            }
          } catch (retryErr) {}
        }

        setError(errMsg);
        setDownloading(false);
        window.removeEventListener('titan-native-download-progress', handleNativeProgress);
        window.removeEventListener('titan-native-download-error', handleNativeError);
      };

      window.addEventListener('titan-native-download-progress', handleNativeProgress);
      window.addEventListener('titan-native-download-complete', handleNativeComplete);
      window.addEventListener('titan-native-download-error', handleNativeError);

      window.TitanNativeBridge.downloadDirect(downloadUrl, fileInfo.fileName);
      return;
    }

    // Standard HTTP XHR stream fallback with real-time byte tracking
    const xhr = new XMLHttpRequest();
    xhr.open('GET', downloadUrl, true);
    xhr.responseType = 'blob';

    xhr.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100);
        setDownloading(false);
        setDownloadSuccess(true);
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
        sendLinkAck(fileInfo, 'download');

        const blob = xhr.response;

        if (window.TitanNativeBridge && typeof window.TitanNativeBridge.saveBase64ToDownloads === 'function') {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            window.TitanNativeBridge.saveBase64ToDownloads(base64data, fileInfo.fileName);
          };
          reader.readAsDataURL(blob);
        } else {
          const a = document.createElement('a');
          a.href = window.URL.createObjectURL(blob);
          a.download = fileInfo.fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } else {
        setError(`Download failed (HTTP ${xhr.status}). Host may have stopped sharing.`);
        setDownloading(false);
      }
    };

    xhr.onerror = () => {
      setError('Cannot connect to Host Laptop. Ensure both devices are on the same Wi-Fi / Hotspot.');
      setDownloading(false);
    };

    xhr.send();
  };

  const handleDeleteHistoryLink = async (tokenId) => {
    await deleteLink(tokenId);
    const local = JSON.parse(localStorage.getItem('titan_local_created_links') || '[]')
      .filter(l => (l.token || l.id) !== tokenId);
    localStorage.setItem('titan_local_created_links', JSON.stringify(local));
    loadLinksHistory();
  };

  const handleCopyHistoryLink = (url, id) => {
    if (url) {
      navigator.clipboard.writeText(url);
      setCopiedToken(id);
      setTimeout(() => setCopiedToken(null), 2000);
    }
  };

  const formatRemaining = (seconds) => {
    if (seconds <= 0) return 'Expired';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m remaining`;
  };

  return (
    <div className="w-full max-w-xl mx-auto px-2 sm:px-4 py-3 sm:py-6 animate-fadeIn overflow-x-hidden">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex items-center justify-between">
        <div className="min-w-0 pr-2">
          <h2 className="text-lg sm:text-xl font-bold text-[#151B2D] truncate">Remote Downloads</h2>
          <p className="text-[11px] sm:text-xs text-[#788395] truncate">Paste or scan any Titan Plus Share link</p>
        </div>
        <button
          onClick={() => setShowScanner(!showScanner)}
          className="px-3.5 py-2 bg-[#EEF1FF] hover:bg-[#5865E9] text-[#5865E9] hover:text-white rounded-2xl text-xs font-semibold flex items-center gap-1.5 transition shrink-0"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>{showScanner ? 'Close Scanner' : 'Scan QR'}</span>
        </button>
      </div>

      {/* Direct Instant Camera Scanner */}
      {showScanner && (
        <div className="bg-white rounded-[28px] p-5 sm:p-6 shadow-titan border border-[#E8EBF3] mb-5 animate-fadeIn text-center">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-[#151B2D] flex items-center gap-1.5">
              <Camera className="w-4 h-4 text-[#5865E9] animate-pulse" />
              <span>Scanning for QR Code...</span>
            </h4>
            <button 
              onClick={() => setShowScanner(false)} 
              className="text-[#788395] hover:text-[#151B2D] p-1.5 hover:bg-[#F8F9FD] rounded-xl transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-black aspect-square max-w-[260px] mx-auto shadow-inner">
            <div id={scannerDomId.current} className="w-full h-full min-h-[240px]"></div>
            {/* Viewfinder Aiming Overlay */}
            <div className="absolute inset-0 border-2 border-[#5865E9]/40 rounded-2xl pointer-events-none flex items-center justify-center">
              <div className="w-48 h-48 border border-white/40 rounded-xl relative">
                <div className="absolute -top-0.5 -left-0.5 w-4 h-4 border-t-2 border-l-2 border-[#5865E9] rounded-tl"></div>
                <div className="absolute -top-0.5 -right-0.5 w-4 h-4 border-t-2 border-r-2 border-[#5865E9] rounded-tr"></div>
                <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 border-b-2 border-l-2 border-[#5865E9] rounded-bl"></div>
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 border-b-2 border-r-2 border-[#5865E9] rounded-br"></div>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-[#788395] mt-2.5">Point camera directly at the laptop's Download QR</p>
        </div>
      )}

      {/* Input Card */}
      <div className="bg-white rounded-[28px] p-5 sm:p-6 shadow-titan border border-[#E8EBF3] mb-5">
        <label className="block text-xs font-semibold text-[#151B2D] mb-2.5">Download Link</label>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="flex-1 min-w-0 flex items-center gap-2.5 px-3.5 py-3 bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl focus-within:ring-2 focus-within:ring-[#5865E9]/20 focus-within:border-[#5865E9] transition">
            <LinkIcon className="w-4 h-4 text-[#5865E9] shrink-0" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste Titan Plus link here..."
              className="bg-transparent text-xs text-[#151B2D] font-medium w-full outline-none min-w-0 placeholder:text-[#788395]/60"
            />
            <button
              onClick={handlePaste}
              title="Paste from clipboard"
              className="px-2.5 py-1 text-[11px] font-semibold text-[#5865E9] hover:bg-[#EEF1FF] rounded-lg shrink-0 flex items-center gap-1 transition"
            >
              <Clipboard className="w-3 h-3" />
              <span>Paste</span>
            </button>
          </div>
          <button
            onClick={handleValidate}
            disabled={loading || !urlInput.trim()}
            className="w-full sm:w-auto px-6 py-3 bg-[#5865E9] hover:bg-[#4c57d8] disabled:opacity-40 text-white rounded-2xl text-xs font-semibold transition shrink-0 flex items-center justify-center gap-1.5 shadow-titan-sm"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Validate'}
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-[#F16B72] font-medium break-words">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* File / Text Metadata Preview Card */}
      {fileInfo && (
        <div className="bg-white rounded-[28px] p-5 sm:p-6 shadow-titan border border-[#E8EBF3] animate-scaleIn mb-5">
          {fileInfo.type === 'text' ? (
            <div>
              <div className="flex items-center gap-3.5 mb-4 min-w-0">
                <div className="w-12 h-12 rounded-full bg-[#F4EFFF] text-[#8755E8] flex items-center justify-center font-bold text-sm shrink-0">
                  <AlignLeft className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-[#151B2D] text-sm truncate">Shared Text Note</h3>
                  <p className="text-xs text-[#788395]">{(fileInfo.textContent || '').length} characters</p>
                </div>
              </div>

              {/* Text Note Preview Box */}
              <div className="bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl p-4 text-xs font-mono text-[#151B2D] max-h-56 overflow-y-auto whitespace-pre-wrap select-text leading-relaxed mb-4">
                {fileInfo.textContent || 'No text content'}
              </div>

              <div className="flex items-center justify-between p-3.5 bg-[#F8F9FD] rounded-2xl border border-[#E8EBF3] mb-4 text-xs text-[#788395]">
                <div className="flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5 text-[#5865E9]" />
                  <span>Link Expiry</span>
                </div>
                <span className="font-semibold text-[#151B2D]">{formatRemaining(fileInfo.remainingSeconds)}</span>
              </div>

              {/* 1-Click Copy Button */}
              <button
                onClick={() => handleCopyTextNote(fileInfo.textContent, fileInfo.token)}
                disabled={fileInfo.isExpired}
                className="w-full py-3.5 bg-[#5865E9] hover:bg-[#4c57d8] disabled:opacity-40 text-white font-semibold text-xs sm:text-sm rounded-2xl transition flex items-center justify-center gap-2 shadow-titan-sm mb-2.5"
              >
                {textCopied ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <span>Copied to Clipboard! ✓</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Text</span>
                  </>
                )}
              </button>

              <div className="text-center">
                <button
                  onClick={handleStartDownload}
                  className="text-[11px] text-[#788395] hover:text-[#5865E9] transition underline"
                >
                  Download as .txt file
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3.5 mb-5 min-w-0">
                <div className="w-12 h-12 rounded-full bg-[#EEF1FF] text-[#5865E9] flex items-center justify-center font-bold text-sm shrink-0">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-[#151B2D] text-sm truncate">{fileInfo.fileName}</h3>
                  <p className="text-xs text-[#788395]">{formatBytes(fileInfo.fileSize)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-[#F8F9FD] rounded-2xl border border-[#E8EBF3] mb-3.5 text-xs text-[#788395]">
                <div className="flex items-center gap-1.5 font-medium">
                  <Clock className="w-3.5 h-3.5 text-[#5865E9]" />
                  <span>Link Expiry</span>
                </div>
                <span className="font-semibold text-[#151B2D]">{formatRemaining(fileInfo.remainingSeconds)}</span>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-[#16A05A] bg-[#E8FAF0] px-3.5 py-2.5 rounded-2xl border border-[#c9f2dc] mb-4">
                <Wifi className="w-3.5 h-3.5 shrink-0" />
                <span>{fileInfo.publicUrl ? 'Direct Remote & LAN Stream (Available Across All Networks & Cellular)' : 'Direct High-Speed Stream (Same Wi-Fi or Mobile Hotspot)'}</span>
              </div>

              {downloading && (
                <div className="mb-4">
                  <div className="h-2 w-full bg-[#EEF1FF] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#5865E9] transition-all duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#788395] text-center mt-1.5">Preparing download stream...</p>
                </div>
              )}

              <button
                onClick={handleStartDownload}
                disabled={downloading || fileInfo.isExpired}
                className="w-full py-3.5 bg-[#5865E9] hover:bg-[#4c57d8] disabled:opacity-40 text-white font-semibold text-xs sm:text-sm rounded-2xl transition flex items-center justify-center gap-2 shadow-titan-sm"
              >
                <Download className="w-4 h-4" />
                <span>{downloading ? 'Downloading...' : 'Download File'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Section: Active Shared Links & History (Only visible on sender device that created links) */}
      {myLinks.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-sm font-bold text-[#151B2D] flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-[#5865E9]" />
              <span>Shared Links History</span>
            </h3>
            <span className="text-xs text-[#788395] font-medium">{myLinks.length} total</span>
          </div>

          <div className="space-y-3">
            {myLinks.map((link) => {
              const isExpired = link.isExpired || (link.expiresAt && Date.now() > link.expiresAt);
              const isDownloaded = link.status === 'downloaded' || (link.downloadCount > 0);
              const isDownloading = link.status === 'downloading';
              const progress = link.downloadProgress || 0;

              return (
                <div 
                  key={link.id}
                  className="p-4 bg-white rounded-[24px] border border-[#E8EBF3] shadow-titan hover:border-[#5865E9]/40 transition"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-full bg-[#EEF1FF] text-[#5865E9] flex items-center justify-center shrink-0">
                        {link.type === 'text' ? <AlignLeft className="w-5 h-5 text-[#8755E8]" /> : <FileText className="w-5 h-5 text-[#5865E9]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-semibold text-[#151B2D] truncate">{link.type === 'text' ? 'Shared Text Note' : link.fileName}</h4>
                        <p className="text-[11px] text-[#788395] font-medium">
                          {formatBytes(link.fileSize)} • {link.remainingSeconds > 0 ? formatRemaining(link.remainingSeconds) : 'Expired'}
                        </p>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">
                      {isDownloading ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-[#EEF1FF] text-[#5865E9] animate-pulse">
                          Downloading {progress}%
                        </span>
                      ) : isDownloaded ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-[#E8FAF0] text-[#16A05A] border border-[#c9f2dc]">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Downloaded</span>
                        </span>
                      ) : link.status === 'accessed' ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-[#F4EFFF] text-[#8755E8] border border-[#e8dcfc]">
                          <Eye className="w-3 h-3" />
                          <span>Opened</span>
                        </span>
                      ) : isExpired ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-[#F8F9FD] text-[#788395] border border-[#E8EBF3]">
                          Expired
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-600 border border-amber-200">
                          <Clock className="w-3 h-3" />
                          <span>Waiting</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Live Progress Bar if actively downloading */}
                  {isDownloading && (
                    <div className="mt-2 mb-2">
                      <div className="w-full bg-[#EEF1FF] h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-[#5865E9] h-full transition-all duration-300 rounded-full"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Actions Row */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#E8EBF3] mt-2 text-xs">
                    <span className="text-[11px] text-[#788395]">
                      {isDownloaded 
                        ? `Downloaded ${link.downloadCount || 1} time(s)` 
                        : (isExpired ? 'Link Expired' : 'Active for download')}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleCopyHistoryLink(link.url, link.id)}
                        className="px-2.5 py-1 text-[11px] font-semibold text-[#788395] hover:text-[#5865E9] hover:bg-[#EEF1FF] rounded-lg flex items-center gap-1 transition"
                      >
                        {copiedToken === link.id ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-[#16A05A]" />
                            <span className="text-[#16A05A]">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      {link.qrCode && (
                        <button
                          onClick={() => setViewQrLink(link)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-[#788395] hover:text-[#5865E9] hover:bg-[#EEF1FF] rounded-lg flex items-center gap-1 transition"
                        >
                          <QrCode className="w-3 h-3" />
                          <span>QR</span>
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteHistoryLink(link.id)}
                        title="Delete Link"
                        className="p-1 text-[#788395] hover:text-[#F16B72] hover:bg-[#FFF0F2] rounded-lg transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* QR Code Popup Modal */}
      {viewQrLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#151B2D]/40 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm bg-white rounded-[32px] p-6 shadow-titan-modal border border-[#E8EBF3] text-center animate-scaleIn">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-bold text-[#151B2D] truncate pr-2">{viewQrLink.fileName}</h4>
              <button onClick={() => setViewQrLink(null)} className="text-[#788395] hover:text-[#151B2D] p-1 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <img src={viewQrLink.qrCode} alt="QR Code" className="w-48 h-48 mx-auto rounded-2xl shadow-sm border border-[#E8EBF3] mb-3" />
            <p className="text-xs text-[#788395] mb-4">Scan with any phone camera to download</p>
            <button
              onClick={() => setViewQrLink(null)}
              className="w-full py-3 bg-[#EEF1FF] hover:bg-[#5865E9] text-[#5865E9] hover:text-white font-semibold text-xs rounded-2xl transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
