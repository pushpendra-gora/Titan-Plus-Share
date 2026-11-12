import React, { useState, useRef, useEffect } from 'react';
import { 
  FileText, 
  Image, 
  AlignLeft, 
  Folder, 
  Settings as SettingsIcon, 
  Home as HomeIcon, 
  Link as LinkIcon, 
  Send,
  Minimize2,
  Maximize2,
  X as CloseIcon,
  Laptop,
  Smartphone,
  CheckCircle2,
  Radio,
  Power
} from 'lucide-react';

import SendModal from './components/SendModal';
import TextModal from './components/TextModal';
import MediaModal from './components/MediaModal';
import TransferProgressModal from './components/TransferProgressModal';
import LinksView from './components/LinksView';
import SettingsView from './components/SettingsView';
import IncomingTransferModal from './components/IncomingTransferModal';
import { getServerUrl, setServerUrl, getDeviceId, getDeviceName, formatBytes } from './api';

export default function App() {
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'links' | 'settings'
  const [selectedItem, setSelectedItem] = useState(null);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [transferTarget, setTransferTarget] = useState(null);
  const [incomingTransfer, setIncomingTransfer] = useState(null);
  const [serverOnline, setServerOnline] = useState(true);
  const [activeTransfers, setActiveTransfers] = useState([]);
  
  // Detect Desktop vs Mobile view
  const [isDesktopMode, setIsDesktopMode] = useState(window.innerWidth >= 768);

  useEffect(() => {
    const handleResize = () => setIsDesktopMode(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Listen for active transfers and keep live ongoing history until success
  useEffect(() => {
    const handleAdd = (e) => {
      const item = e.detail;
      setActiveTransfers((prev) => {
        const filtered = prev.filter((t) => t.id !== item.id && t.name !== item.name);
        return [item, ...filtered];
      });
    };

    const handleProgress = (e) => {
      const { id, progress, speed, loaded } = e.detail;
      setActiveTransfers((prev) =>
        prev.map((t) => {
          if (t.id === id || t.name === id) {
            return { ...t, progress, speed: speed || t.speed, loaded: loaded || t.loaded };
          }
          return t;
        })
      );
    };

    const handleComplete = (e) => {
      const { id } = e.detail;
      setActiveTransfers((prev) =>
        prev.map((t) => {
          if (t.id === id || t.name === id) {
            return { ...t, progress: 100, isDone: true };
          }
          return t;
        })
      );
      // Automatically clear from active transfers 4 seconds after 100% completion
      setTimeout(() => {
        setActiveTransfers((prev) => prev.filter((t) => t.id !== id && t.name !== id));
      }, 4000);
    };

    const handleCancel = (e) => {
      const { id } = e.detail;
      setActiveTransfers((prev) => prev.filter((t) => t.id !== id && t.name !== id));
    };

    window.addEventListener('titan-active-transfer', handleAdd);
    window.addEventListener('titan-active-transfer-progress', handleProgress);
    window.addEventListener('titan-active-transfer-complete', handleComplete);
    window.addEventListener('titan-active-transfer-cancel', handleCancel);

    return () => {
      window.removeEventListener('titan-active-transfer', handleAdd);
      window.removeEventListener('titan-active-transfer-progress', handleProgress);
      window.removeEventListener('titan-active-transfer-complete', handleComplete);
      window.removeEventListener('titan-active-transfer-cancel', handleCancel);
    };
  }, []);

  // Keep stateRef in sync for Android back press handler
  const stateRef = useRef({
    activeTab,
    selectedItem,
    showTextModal,
    showMediaModal,
    transferTarget,
    incomingTransfer
  });

  useEffect(() => {
    stateRef.current = {
      activeTab,
      selectedItem,
      showTextModal,
      showMediaModal,
      transferTarget,
      incomingTransfer
    };
  }, [activeTab, selectedItem, showTextModal, showMediaModal, transferTarget, incomingTransfer]);

  // Android Native Hardware / Gesture Back Press Handler
  useEffect(() => {
    if (!window.__titanBackStack) {
      window.__titanBackStack = [];
    }

    window.registerTitanBackHandler = (fn) => {
      window.__titanBackStack.push(fn);
      return () => {
        window.__titanBackStack = window.__titanBackStack.filter(h => h !== fn);
      };
    };

    window.handleTitanBackPress = () => {
      // 1. Check custom modal/scanner handlers registered in stack
      if (window.__titanBackStack && window.__titanBackStack.length > 0) {
        for (let i = window.__titanBackStack.length - 1; i >= 0; i--) {
          try {
            const handled = window.__titanBackStack[i]();
            if (handled) return true;
          } catch (e) {}
        }
      }

      // 2. Check open root modals
      const s = stateRef.current;
      if (s.incomingTransfer) {
        setIncomingTransfer(null);
        return true;
      }
      if (s.transferTarget) {
        setTransferTarget(null);
        return true;
      }
      if (s.selectedItem) {
        setSelectedItem(null);
        return true;
      }
      if (s.showMediaModal) {
        setShowMediaModal(false);
        return true;
      }
      if (s.showTextModal) {
        setShowTextModal(false);
        return true;
      }

      // 3. If on Links or Settings, navigate back to Home
      if (s.activeTab !== 'home') {
        setActiveTab('home');
        return true;
      }

      // 4. At root home screen with no modals
      return false;
    };

    return () => {
      window.handleTitanBackPress = null;
    };
  }, []);

  // Check server health
  useEffect(() => {
    const checkServer = async () => {
      try {
        const res = await fetch(`${getServerUrl()}/api/status`, { signal: AbortSignal.timeout(2000) });
        setServerOnline(res.ok);
      } catch (e) {
        setServerOnline(false);
      }
    };
    checkServer();
    const interval = setInterval(checkServer, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen for Android System Share events (when shared from other apps on mobile)
  useEffect(() => {
    const checkNativeShare = () => {
      if (window.TitanNativeBridge && typeof window.TitanNativeBridge.getPendingSharedItem === 'function') {
        try {
          const raw = window.TitanNativeBridge.getPendingSharedItem();
          if (raw) {
            const item = JSON.parse(raw);
            if (item.type === 'text') {
              setSelectedItem({
                type: 'text',
                name: item.name || 'Shared Note',
                size: item.text?.length || 0,
                text: item.text
              });
            } else if (item.type === 'file') {
              let fileObj = null;
              if (item.cachePath && window.TitanNativeBridge.readCachedFileBase64) {
                try {
                  const b64 = window.TitanNativeBridge.readCachedFileBase64(item.cachePath);
                  if (b64) {
                    const byteChars = atob(b64);
                    const byteNums = new Array(byteChars.length);
                    for (let i = 0; i < byteChars.length; i++) {
                      byteNums[i] = byteChars.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNums);
                    fileObj = new File([byteArray], item.name, { type: 'application/octet-stream' });
                  }
                } catch (e) {}
              }
              setSelectedItem({
                type: 'file',
                name: item.name || 'Shared File',
                size: item.size || fileObj?.size || 0,
                file: fileObj,
                uri: item.cachePath
              });
            }
          }
        } catch (e) {}
      }
    };

    checkNativeShare();
    const sharePoll = setInterval(checkNativeShare, 1200);
    window.addEventListener('focus', checkNativeShare);

    const handleIncomingShare = (e) => {
      if (e.detail) {
        const { type, payload, name, size } = e.detail;
        if (type === 'text') {
          setSelectedItem({
            type: 'text',
            name: name || 'Shared Text',
            size: payload.length,
            text: payload
          });
        } else {
          setSelectedItem({
            type: 'file',
            name: name || 'Shared File',
            size: size || 1024 * 1024,
            uri: payload
          });
        }
      }
    };
    window.addEventListener('incoming-share', handleIncomingShare);

    return () => {
      clearInterval(sharePoll);
      window.removeEventListener('focus', checkNativeShare);
      window.removeEventListener('incoming-share', handleIncomingShare);
    };
  }, []);

  // Listen for Windows Explorer Context Menu Share events
  useEffect(() => {
    const checkPendingShare = async () => {
      try {
        const res = await fetch(`${getServerUrl()}/api/cli/pending-share`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.item) {
            setSelectedItem(data.item);
          }
        }
      } catch (e) {}
    };

    checkPendingShare();
    const interval = setInterval(checkPendingShare, 2500);
    return () => clearInterval(interval);
  }, []);

  // WebSocket Live Peer & File Transfer Notification Connection
  useEffect(() => {
    let ws = null;
    let reconnectTimer = null;

    const connectWs = () => {
      try {
        const srv = getServerUrl();
        const wsUrl = srv.replace(/^http/, 'ws') + '/ws';
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          const idPayload = {
            type: 'identify',
            deviceId: getDeviceId(),
            deviceName: getDeviceName(),
            deviceType: /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'laptop'
          };
          ws.send(JSON.stringify(idPayload));

          // Also check for any pending pushes staged while this client was disconnected/closed
          fetch(`${getServerUrl()}/api/transfer/pending?deviceId=${getDeviceId()}`)
            .then(r => r.json())
            .then(pending => {
              if (pending && pending.length > 0) {
                setIncomingTransfer(pending[0]);
              }
            })
            .catch(() => {});
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event === 'incoming-file-push') {
              const myId = getDeviceId();
              const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
              const shouldAccept = !data.payload.targetDeviceId || 
                                   data.payload.targetDeviceId === myId ||
                                   (isMobile && (data.payload.targetDeviceType === 'mobile' || !data.payload.targetDeviceType));

              if (shouldAccept) {
                if (data.payload.serverUrl) {
                  setServerUrl(data.payload.serverUrl);
                }
                setIncomingTransfer(data.payload);
              }
            } else if (data.event === 'peer-transfer-progress') {
              window.dispatchEvent(new CustomEvent('titan-peer-progress', { detail: data.payload }));
            } else if (data.event === 'transfer-completed') {
              window.dispatchEvent(new CustomEvent('titan-transfer-completed', { detail: data.payload }));
            } else if (data.event === 'link-download-progress') {
              window.dispatchEvent(new CustomEvent('titan-link-progress', { detail: data.payload }));
            } else if (data.event === 'link-download-completed') {
              window.dispatchEvent(new CustomEvent('titan-link-completed', { detail: data.payload }));
              if (window.TitanNativeBridge && typeof window.TitanNativeBridge.showNotification === 'function') {
                window.TitanNativeBridge.showNotification('File Downloaded!', `Link download complete for: ${data.payload.fileName}`);
              }
            } else if (data.event === 'links-updated') {
              window.dispatchEvent(new CustomEvent('titan-links-updated', { detail: data.payload }));
            } else if (data.event === 'incoming-transfer') {
              const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
              if (!isMobile) {
                setIncomingTransfer({ ...data.payload, isCompleted: true });
              }
            }
          } catch (e) {}
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connectWs, 3500);
        };
      } catch (err) {
        reconnectTimer = setTimeout(connectWs, 3500);
      }
    };

    connectWs();

    // Mobile fallback poller: guarantees no pushed text/file is missed even if network fluctuated
    let pollInterval = null;
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      pollInterval = setInterval(() => {
        const srv = getServerUrl();
        if (!srv || srv.includes('127.0.0.1')) return;
        fetch(`${srv}/api/transfer/pending?deviceId=${getDeviceId()}&deviceType=mobile`, { signal: AbortSignal.timeout(2000) })
          .then(r => r.json())
          .then(pending => {
            if (pending && pending.length > 0) {
              setIncomingTransfer(prev => prev ? prev : pending[0]);
            }
          })
          .catch(() => {});
      }, 3000);
    }

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  // Hidden native file pickers
  const fileInputRef = useRef(null);
  const mediaPhotoInputRef = useRef(null);
  const mediaVideoInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // File Picker Handlers
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedItem({
        type: 'file',
        name: file.name,
        size: file.size,
        file: file
      });
    }
    e.target.value = '';
  };

  const handleMediaPhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedItem({
        type: 'media',
        name: file.name,
        size: file.size,
        file: file
      });
    }
    e.target.value = '';
  };

  const handleMediaVideoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedItem({
        type: 'media',
        name: file.name,
        size: file.size,
        file: file
      });
    }
    e.target.value = '';
  };

  const handleFolderChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      let totalSize = 0;
      for (let i = 0; i < files.length; i++) {
        totalSize += files[i].size;
      }
      const folderName = files[0].webkitRelativePath?.split('/')[0] || 'Selected Folder';
      setSelectedItem({
        type: 'folder',
        name: folderName,
        size: totalSize,
        fileCount: files.length,
        files: files
      });
    }
    e.target.value = '';
  };

  const handleSendText = (text) => {
    setShowTextModal(false);
    setSelectedItem({
      type: 'text',
      name: 'Shared Text Note',
      size: text.length,
      text: text
    });
  };

  const handleStartLanTransfer = (device, item) => {
    setSelectedItem(null);
    setTransferTarget({ device, item });
  };

  const renderOngoingTransfers = (isDesktop) => {
    if (!activeTransfers || activeTransfers.length === 0) return null;
    return (
      <div className={`w-full ${isDesktop ? 'max-w-3xl mb-8' : 'mb-4'} space-y-2.5 animate-fadeIn`}>
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
              Ongoing Transfers ({activeTransfers.length})
            </span>
          </div>
          <span className="text-[10px] text-slate-400 font-medium">History active until complete</span>
        </div>
        {activeTransfers.map((t) => (
          <div
            key={t.id}
            className="p-3.5 bg-white/95 backdrop-blur-md rounded-2xl border border-blue-100 shadow-sm flex items-center justify-between gap-3 transition-all"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${t.isDone ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                {t.isDone ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <FileText className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-800 text-xs truncate max-w-[200px]">{t.name}</span>
                  <span className={`text-xs font-bold ml-2 ${t.isDone ? 'text-emerald-600' : 'text-blue-600'}`}>
                    {t.isDone ? 'Completed ✓' : `${t.progress}%`}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${t.isDone ? 'bg-emerald-500' : 'bg-blue-600'}`}
                    style={{ width: `${t.progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{t.type === 'sending' ? `Sending to ${t.target || 'Device'}` : `Receiving from ${t.target || 'Device'}`}</span>
                  <span>{t.speed || (t.isDone ? 'Finished' : 'Transferring...')}</span>
                </div>
              </div>
            </div>
            {!t.isDone && (
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('titan-active-transfer-cancel', { detail: { id: t.id } }));
                }}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 flex items-center justify-center transition shrink-0"
                title="Cancel Transfer"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f8faff] text-slate-800 flex flex-col font-sans select-none relative overflow-x-hidden">
      
      {/* Ambient blue background glow */}
      <div className="ambient-bg" />

      {/* Hidden inputs */}
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
      <input type="file" ref={mediaPhotoInputRef} accept="image/*" onChange={handleMediaPhotoChange} className="hidden" />
      <input type="file" ref={mediaVideoInputRef} accept="video/*" onChange={handleMediaVideoChange} className="hidden" />
      <input 
        type="file" 
        ref={folderInputRef} 
        onChange={handleFolderChange} 
        webkitdirectory="" 
        directory="" 
        multiple 
        className="hidden" 
      />

      {/* DESKTOP VIEW */}
      {isDesktopMode ? (
        <div className="flex-1 flex flex-col h-screen z-10">
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar Navigation */}
            <aside className="w-64 bg-white/70 backdrop-blur-md border-r border-slate-100 p-5 flex flex-col justify-between">
              <div>
                {/* Branding */}
                <div className="flex items-center gap-3 mb-8 px-2">
                  <img src="/logo.png" alt="Titan Plus Share" className="w-11 h-11 rounded-2xl shadow-md shadow-blue-500/25 object-cover" />
                  <div>
                    <h1 className="font-bold text-slate-900 text-sm leading-tight">Titan Plus Share</h1>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${serverOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                      <span className="text-[11px] text-slate-400 font-medium">
                        {serverOnline ? 'Server Active' : 'Connecting...'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Nav Links */}
                <nav className="space-y-1.5">
                  <button
                    onClick={() => setActiveTab('home')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold transition ${
                      activeTab === 'home'
                        ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <HomeIcon className="w-4 h-4" />
                    <span>Home</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('links')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold transition ${
                      activeTab === 'links'
                        ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <LinkIcon className="w-4 h-4" />
                    <span>Links</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('settings')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold transition ${
                      activeTab === 'settings'
                        ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span>Settings</span>
                  </button>
                </nav>
              </div>

              {/* View Switcher for convenience */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span>Display View:</span>
                <button 
                  onClick={() => setIsDesktopMode(false)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 rounded-lg font-medium transition"
                >
                  Mobile View
                </button>
              </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto p-8 flex flex-col justify-center items-center">
              {activeTab === 'home' && (
                <div className="w-full max-w-4xl flex flex-col items-center justify-center animate-fadeIn py-6">
                  
                  {/* Central Titan Plus Share Emblem */}
                  <div className="flex flex-col items-center text-center mb-8">
                    <img src="/logo.png" alt="Titan Plus Share" className="w-24 h-24 rounded-[30px] shadow-2xl shadow-blue-500/35 object-cover mb-4 transform hover:scale-105 transition duration-300" />
                    <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">Titan Plus Share</h2>
                    <p className="text-sm text-slate-400 font-medium">PC & Mobile File Sharing</p>
                  </div>

                  {/* Active Ongoing Transfers History */}
                  {renderOngoingTransfers(true)}

                  {/* 1x4 Horizontal Row of Cards */}
                  <div className="grid grid-cols-4 gap-6 w-full max-w-3xl">
                    
                    {/* File Card */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="group bg-white hover:bg-slate-50/50 p-7 rounded-[24px] border border-slate-100 shadow-card hover:shadow-card-hover flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:-translate-y-1"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 group-hover:scale-110 flex items-center justify-center transition duration-300 border border-blue-100">
                        <FileText className="w-7 h-7" />
                      </div>
                      <span className="font-bold text-slate-800 text-base">File</span>
                    </button>

                    {/* Media Card */}
                    <button
                      onClick={() => setShowMediaModal(true)}
                      className="group bg-white hover:bg-slate-50/50 p-7 rounded-[24px] border border-slate-100 shadow-card hover:shadow-card-hover flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:-translate-y-1"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 group-hover:scale-110 flex items-center justify-center transition duration-300 border border-blue-100">
                        <Image className="w-7 h-7" />
                      </div>
                      <span className="font-bold text-slate-800 text-base">Media</span>
                    </button>

                    {/* Text Card */}
                    <button
                      onClick={() => setShowTextModal(true)}
                      className="group bg-white hover:bg-slate-50/50 p-7 rounded-[24px] border border-slate-100 shadow-card hover:shadow-card-hover flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:-translate-y-1"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 group-hover:scale-110 flex items-center justify-center transition duration-300 border border-blue-100">
                        <AlignLeft className="w-7 h-7" />
                      </div>
                      <span className="font-bold text-slate-800 text-base">Text</span>
                    </button>

                    {/* Folder Card */}
                    <button
                      onClick={() => folderInputRef.current?.click()}
                      className="group bg-white hover:bg-slate-50/50 p-7 rounded-[24px] border border-slate-100 shadow-card hover:shadow-card-hover flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:-translate-y-1"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 group-hover:scale-110 flex items-center justify-center transition duration-300 border border-blue-100">
                        <Folder className="w-7 h-7" />
                      </div>
                      <span className="font-bold text-slate-800 text-base">Folder</span>
                    </button>

                  </div>

                </div>
              )}

              {activeTab === 'links' && <LinksView />}
              {activeTab === 'settings' && <SettingsView isMobileMode={false} onNavigate={setActiveTab} />}
            </main>
          </div>

        </div>
      ) : (
        /* MOBILE VIEW */
        <div className="mobile-safe-container flex-1 flex flex-col justify-between max-w-md mx-auto w-full min-h-screen z-10">
          
          {/* Mobile Top Header */}
          <div className="flex items-center justify-between mb-6 pt-1">
            <div className="flex items-center gap-3 min-w-0">
              <img src="/logo.png" alt="Titan Plus Share" className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl shadow-md shadow-blue-500/25 object-cover shrink-0" />
              <div className="min-w-0">
                <h1 className="font-bold text-slate-900 text-sm sm:text-base leading-tight truncate">Titan Plus Share</h1>
                <p className="text-[11px] sm:text-xs text-slate-400 font-medium truncate">Fast • Simple • Anywhere</p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('settings')}
              className="w-10 h-10 rounded-2xl bg-white border border-slate-100 shadow-sm flex items-center justify-center text-slate-500 hover:text-blue-600 transition shrink-0"
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile Tab Content */}
          <div className="flex-1 flex flex-col justify-center w-full min-w-0">
            {activeTab === 'home' && (
              <div className="animate-fadeIn my-auto w-full">
                {/* Active Ongoing Transfers History */}
                {renderOngoingTransfers(false)}

                {/* 2x2 Grid of White Cards */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  
                  {/* Card 1: File */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square bg-white hover:bg-slate-50/60 p-4 sm:p-6 rounded-[22px] border border-slate-100 shadow-card flex flex-col items-center justify-center gap-2.5 sm:gap-3.5 transition-all active:scale-95"
                  >
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                      <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <span className="font-bold text-slate-800 text-xs sm:text-sm">File</span>
                  </button>

                  {/* Card 2: Media */}
                  <button
                    onClick={() => setShowMediaModal(true)}
                    className="aspect-square bg-white hover:bg-slate-50/60 p-4 sm:p-6 rounded-[22px] border border-slate-100 shadow-card flex flex-col items-center justify-center gap-2.5 sm:gap-3.5 transition-all active:scale-95"
                  >
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                      <Image className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <span className="font-bold text-slate-800 text-xs sm:text-sm">Media</span>
                  </button>

                  {/* Card 3: Text */}
                  <button
                    onClick={() => setShowTextModal(true)}
                    className="aspect-square bg-white hover:bg-slate-50/60 p-4 sm:p-6 rounded-[22px] border border-slate-100 shadow-card flex flex-col items-center justify-center gap-2.5 sm:gap-3.5 transition-all active:scale-95"
                  >
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                      <AlignLeft className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <span className="font-bold text-slate-800 text-xs sm:text-sm">Text</span>
                  </button>

                  {/* Card 4: Folder */}
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    className="aspect-square bg-white hover:bg-slate-50/60 p-4 sm:p-6 rounded-[22px] border border-slate-100 shadow-card flex flex-col items-center justify-center gap-2.5 sm:gap-3.5 transition-all active:scale-95"
                  >
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                      <Folder className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <span className="font-bold text-slate-800 text-xs sm:text-sm">Folder</span>
                  </button>

                </div>
              </div>
            )}

            {activeTab === 'links' && <LinksView />}
            {activeTab === 'settings' && <SettingsView isMobileMode={true} onNavigate={setActiveTab} />}
          </div>

          {/* Mobile Bottom Navigation Bar */}
          <div className="mobile-bottom-nav fixed bottom-0 left-0 right-0 max-w-md mx-auto z-40">
            <div className="bg-white/95 backdrop-blur-md rounded-[22px] border border-slate-100 shadow-modal p-1.5 flex items-center justify-around">
              
              <button
                onClick={() => setActiveTab('home')}
                className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 transition ${
                  activeTab === 'home'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <HomeIcon className="w-4 h-4" />
                <span className="text-[10px]">Home</span>
              </button>

              <button
                onClick={() => setActiveTab('links')}
                className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 transition ${
                  activeTab === 'links'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <LinkIcon className="w-4 h-4" />
                <span className="text-[10px]">Links</span>
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`flex-1 py-2 rounded-xl flex flex-col items-center gap-1 transition ${
                  activeTab === 'settings'
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <SettingsIcon className="w-4 h-4" />
                <span className="text-[10px]">Settings</span>
              </button>

            </div>
          </div>

        </div>
      )}

      {/* MODALS */}
      {selectedItem && (
        <SendModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onStartTransfer={handleStartLanTransfer}
        />
      )}

      {showTextModal && (
        <TextModal
          onClose={() => setShowTextModal(false)}
          onSendText={handleSendText}
        />
      )}

      {showMediaModal && (
        <MediaModal
          onClose={() => setShowMediaModal(false)}
          onSelectType={(type) => {
            setShowMediaModal(false);
            if (type === 'photo') mediaPhotoInputRef.current?.click();
            if (type === 'video') mediaVideoInputRef.current?.click();
          }}
        />
      )}

      {transferTarget && (
        <TransferProgressModal
          targetDevice={transferTarget.device}
          item={transferTarget.item}
          onClose={() => setTransferTarget(null)}
        />
      )}

      {incomingTransfer && (
        <IncomingTransferModal
          incoming={incomingTransfer}
          onClose={() => setIncomingTransfer(null)}
        />
      )}

    </div>
  );
}
