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
import { Capacitor } from '@capacitor/core';

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
    const checkNativeShare = async () => {
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
            } else if (item.type === 'files') {
              setSelectedItem({
                type: 'files',
                name: item.name || `${item.files?.length || 0} Files Selected`,
                size: item.size || 0,
                fileCount: item.fileCount || item.files?.length || 0,
                files: item.files || []
              });
            } else if (item.type === 'file') {
              let fileObj = null;
              if (item.cachePath) {
                try {
                  const fileSrc = Capacitor.convertFileSrc(item.cachePath);
                  const res = await fetch(fileSrc);
                  const blob = await res.blob();
                  fileObj = new File([blob], item.name, { type: blob.type || 'application/octet-stream' });
                } catch (e) {
                  console.warn('Capacitor convertFileSrc error:', e);
                }
              }
              setSelectedItem({
                type: 'file',
                name: item.name || 'Shared File',
                size: item.size || fileObj?.size || 0,
                file: fileObj,
                cachePath: item.cachePath,
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

    const handleIncomingShare = async (e) => {
      if (e.detail) {
        const { type, payload, name, size, files, fileCount } = e.detail;
        if (type === 'text') {
          setSelectedItem({
            type: 'text',
            name: name || 'Shared Text',
            size: payload.length,
            text: payload
          });
        } else if (type === 'files') {
          setSelectedItem({
            type: 'files',
            name: name || `${fileCount || files?.length || 0} Files Selected`,
            size: size || 0,
            fileCount: fileCount || files?.length || 0,
            files: files || []
          });
        } else {
          let fileObj = null;
          if (payload) {
            try {
              const fileSrc = Capacitor.convertFileSrc(payload);
              const res = await fetch(fileSrc);
              const blob = await res.blob();
              fileObj = new File([blob], name || 'Shared_File', { type: blob.type || 'application/octet-stream' });
            } catch (err) {
              console.warn('Capacitor convertFileSrc error:', err);
            }
          }
          setSelectedItem({
            type: 'file',
            name: name || 'Shared File',
            size: size || fileObj?.size || 1024 * 1024,
            file: fileObj,
            cachePath: payload,
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

  // Listen for Windows Explorer Context Menu Share events (Desktop Windows only)
  useEffect(() => {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || !!window.TitanNativeBridge;
    if (isMobile) return;

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

  // Handle Incoming Background Notification Transfer Tap & Native Server Config Sync
  useEffect(() => {
    const syncNativeConfig = () => {
      if (window.TitanNativeBridge && typeof window.TitanNativeBridge.setSavedServerConfig === 'function') {
        const srv = getServerUrl();
        const devId = getDeviceId();
        if (srv && !srv.includes('127.0.0.1') && !srv.includes('localhost')) {
          window.TitanNativeBridge.setSavedServerConfig(srv, devId);
        }
      }
    };
    syncNativeConfig();

    const checkPendingNotificationTransfer = () => {
      syncNativeConfig();
      if (window.TitanNativeBridge && typeof window.TitanNativeBridge.getPendingNotificationTransfer === 'function') {
        try {
          const raw = window.TitanNativeBridge.getPendingNotificationTransfer();
          if (raw) {
            const data = JSON.parse(raw);
            if (data.serverUrl) setServerUrl(data.serverUrl);
            setIncomingTransfer(data);
          }
        } catch (e) {}
      }
    };

    checkPendingNotificationTransfer();

    const handleIncomingNotification = (e) => {
      if (e.detail) {
        if (e.detail.serverUrl) setServerUrl(e.detail.serverUrl);
        setIncomingTransfer(e.detail);
      }
    };

    window.handleIncomingNotificationTransfer = (payload) => {
      if (payload) {
        if (payload.serverUrl) setServerUrl(payload.serverUrl);
        setIncomingTransfer(payload);
      }
    };

    window.addEventListener('titan-open-incoming-transfer', handleIncomingNotification);
    window.addEventListener('focus', checkPendingNotificationTransfer);

    return () => {
      window.removeEventListener('titan-open-incoming-transfer', handleIncomingNotification);
      window.removeEventListener('focus', checkPendingNotificationTransfer);
      delete window.handleIncomingNotificationTransfer;
    };
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
              const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || !!window.TitanNativeBridge;

              // Don't accept your own outgoing push!
              if (data.payload.senderId && data.payload.senderId === myId) {
                return;
              }

              // Accept if targeted to this device specifically, or if mobile broadcast
              const shouldAccept = data.payload.targetDeviceId
                ? data.payload.targetDeviceId === myId
                : (isMobile && (data.payload.targetDeviceType === 'mobile' || !data.payload.targetDeviceType));

              if (shouldAccept) {
                if (data.payload.serverUrl) {
                  setServerUrl(data.payload.serverUrl);
                }
                setIncomingTransfer(data.payload);
              }
            } else if (data.event === 'peer-transfer-progress') {
              window.dispatchEvent(new CustomEvent('titan-peer-progress', { detail: data.payload }));
              if (data.payload?.transferId) {
                window.dispatchEvent(new CustomEvent('titan-active-transfer-progress', {
                  detail: {
                    id: data.payload.transferId,
                    progress: data.payload.percent,
                    speed: data.payload.speed,
                    loaded: data.payload.loaded
                  }
                }));
              }
            } else if (data.event === 'transfer-completed') {
              window.dispatchEvent(new CustomEvent('titan-transfer-completed', { detail: data.payload }));
              if (data.payload?.transferId) {
                window.dispatchEvent(new CustomEvent('titan-active-transfer-complete', {
                  detail: { id: data.payload.transferId }
                }));
              }
            } else if (data.event === 'transfer-cancelled') {
              if (data.payload?.transferId) {
                window.dispatchEvent(new CustomEvent('titan-active-transfer-cancel', {
                  detail: { id: data.payload.transferId }
                }));
              }
            } else if (data.event === 'link-download-progress') {
              window.dispatchEvent(new CustomEvent('titan-link-progress', { detail: data.payload }));
            } else if (data.event === 'link-accessed') {
              window.dispatchEvent(new CustomEvent('titan-link-accessed', { detail: data.payload }));
            } else if (data.event === 'link-download-completed') {
              window.dispatchEvent(new CustomEvent('titan-link-completed', { detail: data.payload }));
              if (window.TitanNativeBridge && typeof window.TitanNativeBridge.showNotification === 'function') {
                window.TitanNativeBridge.showNotification('File Downloaded!', `Link download complete for: ${data.payload.fileName}`);
              }
            } else if (data.event === 'links-updated') {
              window.dispatchEvent(new CustomEvent('titan-links-updated', { detail: data.payload }));
            } else if (data.event === 'external-file-shared') {
              const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || !!window.TitanNativeBridge;
              if (!isMobile && data.payload) {
                setSelectedItem(data.payload);
              }
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
    const rawFiles = e.target.files;
    if (rawFiles && rawFiles.length > 0) {
      if (rawFiles.length === 1) {
        const file = rawFiles[0];
        setSelectedItem({
          type: 'file',
          name: file.name,
          size: file.size,
          file: file
        });
      } else {
        const filesArr = Array.from(rawFiles);
        let totalSize = 0;
        filesArr.forEach(f => { totalSize += f.size; });
        setSelectedItem({
          type: 'files',
          name: `${filesArr.length} Files Selected`,
          size: totalSize,
          fileCount: filesArr.length,
          files: filesArr
        });
      }
    }
    e.target.value = '';
  };

  const handleMediaPhotoChange = (e) => {
    const rawFiles = e.target.files;
    if (rawFiles && rawFiles.length > 0) {
      if (rawFiles.length === 1) {
        const file = rawFiles[0];
        setSelectedItem({
          type: 'media',
          name: file.name,
          size: file.size,
          file: file
        });
      } else {
        const filesArr = Array.from(rawFiles);
        let totalSize = 0;
        filesArr.forEach(f => { totalSize += f.size; });
        setSelectedItem({
          type: 'files',
          name: `${filesArr.length} Photos Selected`,
          size: totalSize,
          fileCount: filesArr.length,
          files: filesArr
        });
      }
    }
    e.target.value = '';
  };

  const handleMediaVideoChange = (e) => {
    const rawFiles = e.target.files;
    if (rawFiles && rawFiles.length > 0) {
      if (rawFiles.length === 1) {
        const file = rawFiles[0];
        setSelectedItem({
          type: 'media',
          name: file.name,
          size: file.size,
          file: file
        });
      } else {
        const filesArr = Array.from(rawFiles);
        let totalSize = 0;
        filesArr.forEach(f => { totalSize += f.size; });
        setSelectedItem({
          type: 'files',
          name: `${filesArr.length} Videos Selected`,
          size: totalSize,
          fileCount: filesArr.length,
          files: filesArr
        });
      }
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

  const handleOpenFilePicker = () => {
    if (window.TitanNativeBridge && typeof window.TitanNativeBridge.openNativeFilePicker === 'function') {
      window.TitanNativeBridge.openNativeFilePicker();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleOpenMediaPicker = (type) => {
    setShowMediaModal(false);
    if (type === 'photo') {
      if (window.TitanNativeBridge && typeof window.TitanNativeBridge.openNativeMediaPicker === 'function') {
        window.TitanNativeBridge.openNativeMediaPicker();
      } else {
        mediaPhotoInputRef.current?.click();
      }
    } else if (type === 'video') {
      if (window.TitanNativeBridge && typeof window.TitanNativeBridge.openNativeMediaPicker === 'function') {
        window.TitanNativeBridge.openNativeMediaPicker();
      } else {
        mediaVideoInputRef.current?.click();
      }
    }
  };

  const handleOpenFolderPicker = () => {
    if (window.TitanNativeBridge && typeof window.TitanNativeBridge.openNativeFolderPicker === 'function') {
      window.TitanNativeBridge.openNativeFolderPicker();
    } else {
      folderInputRef.current?.click();
    }
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
            <span className="w-2 h-2 rounded-full bg-[#5865E9] animate-pulse" />
            <span className="text-[11px] font-bold text-[#151B2D] uppercase tracking-wider">
              Ongoing Transfers ({activeTransfers.length})
            </span>
          </div>
          <span className="text-[10px] text-[#788395] font-medium">History active until complete</span>
        </div>
        {activeTransfers.map((t) => (
          <div
            key={t.id}
            className="p-4 bg-white rounded-[22px] border border-[#E8EBF3] shadow-titan flex items-center justify-between gap-3 transition-all"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${t.isDone ? 'bg-[#E8FAF0] text-[#16A05A]' : 'bg-[#EEF1FF] text-[#5865E9]'}`}>
                {t.isDone ? <CheckCircle2 className="w-5 h-5 text-[#16A05A]" /> : <FileText className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-[#151B2D] text-xs truncate max-w-[200px]">{t.name}</span>
                  <span className={`text-xs font-bold ml-2 ${t.isDone ? 'text-[#16A05A]' : 'text-[#5865E9]'}`}>
                    {t.isDone ? 'Completed ✓' : `${t.progress}%`}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#EEF1FF] rounded-full overflow-hidden mb-1">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${t.isDone ? 'bg-[#16A05A]' : 'bg-[#5865E9]'}`}
                    style={{ width: `${t.progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#788395]">
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
                className="w-7 h-7 rounded-lg text-[#788395] hover:text-[#F16B72] hover:bg-[#FFF0F2] flex items-center justify-center transition shrink-0"
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
    <div className="min-h-screen bg-[#F8F9FD] text-[#151B2D] flex flex-col font-sans select-none relative overflow-x-hidden">
      
      {/* Ambient soft background glow */}
      <div className="ambient-bg" />

      {/* Hidden inputs */}
      <input type="file" ref={fileInputRef} multiple onChange={handleFileChange} className="hidden" />
      <input type="file" ref={mediaPhotoInputRef} accept="image/*" multiple onChange={handleMediaPhotoChange} className="hidden" />
      <input type="file" ref={mediaVideoInputRef} accept="video/*" multiple onChange={handleMediaVideoChange} className="hidden" />
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
            <aside className="w-68 bg-white border-r border-[#E8EBF3] p-6 flex flex-col justify-between shadow-[2px_0_12px_rgba(21,27,45,0.02)]">
              <div>
                {/* Branding */}
                <div className="flex items-center gap-3.5 mb-8 px-1">
                  <img src="/logo.png" alt="Titan Plus Share" className="w-12 h-12 rounded-[18px] shadow-titan-sm object-cover" />
                  <div>
                    <h1 className="font-extrabold text-[#151B2D] text-base leading-tight">Titan Plus Share</h1>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`w-2 h-2 rounded-full ${serverOnline ? 'bg-[#16A05A] animate-pulse' : 'bg-amber-500'}`} />
                      <span className="text-[11px] text-[#788395] font-medium">
                        {serverOnline ? 'Server Active' : 'Connecting...'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Nav Links */}
                <nav className="space-y-2">
                  <button
                    onClick={() => setActiveTab('home')}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-[20px] text-xs font-semibold transition ${
                      activeTab === 'home'
                        ? 'bg-[#EEF1FF] text-[#5865E9] shadow-sm'
                        : 'text-[#788395] hover:text-[#151B2D] hover:bg-[#F8F9FD]'
                    }`}
                  >
                    <HomeIcon className="w-4 h-4" />
                    <span>Home</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('links')}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-[20px] text-xs font-semibold transition ${
                      activeTab === 'links'
                        ? 'bg-[#EEF1FF] text-[#5865E9] shadow-sm'
                        : 'text-[#788395] hover:text-[#151B2D] hover:bg-[#F8F9FD]'
                    }`}
                  >
                    <LinkIcon className="w-4 h-4" />
                    <span>Links</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('settings')}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-[20px] text-xs font-semibold transition ${
                      activeTab === 'settings'
                        ? 'bg-[#EEF1FF] text-[#5865E9] shadow-sm'
                        : 'text-[#788395] hover:text-[#151B2D] hover:bg-[#F8F9FD]'
                    }`}
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span>Settings</span>
                  </button>
                </nav>
              </div>

              {/* View Switcher for convenience */}
              <div className="pt-4 border-t border-[#E8EBF3] flex items-center justify-between text-[11px] text-[#788395]">
                <span>Display View:</span>
                <button 
                  onClick={() => setIsDesktopMode(false)}
                  className="px-3 py-1.5 bg-[#EEF1FF] text-[#5865E9] hover:bg-[#5865E9] hover:text-white rounded-xl font-semibold transition"
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
                  <div className="flex flex-col items-center text-center mb-10">
                    <img src="/logo.png" alt="Titan Plus Share" className="w-24 h-24 rounded-[32px] shadow-titan-lg object-cover mb-4 transform hover:scale-105 transition duration-300" />
                    <h2 className="text-3xl font-extrabold text-[#151B2D] tracking-tight mb-1.5">Titan Plus Share</h2>
                    <p className="text-sm text-[#788395] font-medium">Fast • Simple • Anywhere</p>
                  </div>

                  {/* Active Ongoing Transfers History */}
                  {renderOngoingTransfers(true)}

                  {/* 1x4 Horizontal Row of Cards */}
                  <div className="grid grid-cols-4 gap-6 w-full max-w-3xl">
                    
                    {/* File Card */}
                    <button
                      onClick={handleOpenFilePicker}
                      className="group bg-white hover:bg-[#F8F9FD]/60 p-7 rounded-[28px] border border-[#E8EBF3] shadow-titan hover:shadow-titan-md flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:-translate-y-1"
                    >
                      <div className="w-16 h-16 rounded-full bg-[#EEF1FF] text-[#5865E9] group-hover:scale-110 flex items-center justify-center transition duration-300">
                        <FileText className="w-7 h-7" />
                      </div>
                      <span className="font-bold text-[#151B2D] text-base">File</span>
                    </button>

                    {/* Media Card */}
                    <button
                      onClick={() => setShowMediaModal(true)}
                      className="group bg-white hover:bg-[#F8F9FD]/60 p-7 rounded-[28px] border border-[#E8EBF3] shadow-titan hover:shadow-titan-md flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:-translate-y-1"
                    >
                      <div className="w-16 h-16 rounded-full bg-[#FFF0F2] text-[#F16B72] group-hover:scale-110 flex items-center justify-center transition duration-300">
                        <Image className="w-7 h-7" />
                      </div>
                      <span className="font-bold text-[#151B2D] text-base">Media</span>
                    </button>

                    {/* Text Card */}
                    <button
                      onClick={() => setShowTextModal(true)}
                      className="group bg-white hover:bg-[#F8F9FD]/60 p-7 rounded-[28px] border border-[#E8EBF3] shadow-titan hover:shadow-titan-md flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:-translate-y-1"
                    >
                      <div className="w-16 h-16 rounded-full bg-[#F4EFFF] text-[#8755E8] group-hover:scale-110 flex items-center justify-center transition duration-300">
                        <AlignLeft className="w-7 h-7" />
                      </div>
                      <span className="font-bold text-[#151B2D] text-base">Text</span>
                    </button>

                    {/* Folder Card */}
                    <button
                      onClick={handleOpenFolderPicker}
                      className="group bg-white hover:bg-[#F8F9FD]/60 p-7 rounded-[28px] border border-[#E8EBF3] shadow-titan hover:shadow-titan-md flex flex-col items-center justify-center gap-4 transition-all duration-300 hover:-translate-y-1"
                    >
                      <div className="w-16 h-16 rounded-full bg-[#E8FAF0] text-[#16A05A] group-hover:scale-110 flex items-center justify-center transition duration-300">
                        <Folder className="w-7 h-7" />
                      </div>
                      <span className="font-bold text-[#151B2D] text-base">Folder</span>
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
            <div className="flex items-center gap-3.5 min-w-0">
              <img src="/logo.png" alt="Titan Plus Share" className="w-11 h-11 rounded-[16px] shadow-titan-sm object-cover shrink-0" />
              <div className="min-w-0">
                <h1 className="font-extrabold text-[#151B2D] text-base leading-tight truncate">Titan Plus Share</h1>
                <p className="text-xs text-[#788395] font-medium truncate">Fast • Simple • Anywhere</p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('settings')}
              className="w-11 h-11 rounded-2xl bg-white border border-[#E8EBF3] shadow-titan-sm flex items-center justify-center text-[#788395] hover:text-[#5865E9] transition shrink-0"
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

                {/* 2x2 Grid of Large Rounded White Cards */}
                <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
                  
                  {/* Card 1: File */}
                  <button
                    onClick={handleOpenFilePicker}
                    className="aspect-square bg-white hover:bg-[#F8F9FD] p-5 sm:p-6 rounded-[26px] border border-[#E8EBF3] shadow-titan flex flex-col items-center justify-center gap-3 transition-all active:scale-95"
                  >
                    <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-[#EEF1FF] text-[#5865E9] flex items-center justify-center">
                      <FileText className="w-6 h-6 sm:w-7 sm:h-7" />
                    </div>
                    <span className="font-bold text-[#151B2D] text-sm">File</span>
                  </button>

                  {/* Card 2: Media */}
                  <button
                    onClick={() => setShowMediaModal(true)}
                    className="aspect-square bg-white hover:bg-[#F8F9FD] p-5 sm:p-6 rounded-[26px] border border-[#E8EBF3] shadow-titan flex flex-col items-center justify-center gap-3 transition-all active:scale-95"
                  >
                    <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-[#FFF0F2] text-[#F16B72] flex items-center justify-center">
                      <Image className="w-6 h-6 sm:w-7 sm:h-7" />
                    </div>
                    <span className="font-bold text-[#151B2D] text-sm">Media</span>
                  </button>

                  {/* Card 3: Text */}
                  <button
                    onClick={() => setShowTextModal(true)}
                    className="aspect-square bg-white hover:bg-[#F8F9FD] p-5 sm:p-6 rounded-[26px] border border-[#E8EBF3] shadow-titan flex flex-col items-center justify-center gap-3 transition-all active:scale-95"
                  >
                    <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-[#F4EFFF] text-[#8755E8] flex items-center justify-center">
                      <AlignLeft className="w-6 h-6 sm:w-7 sm:h-7" />
                    </div>
                    <span className="font-bold text-[#151B2D] text-sm">Text</span>
                  </button>

                  {/* Card 4: Folder */}
                  <button
                    onClick={handleOpenFolderPicker}
                    className="aspect-square bg-white hover:bg-[#F8F9FD] p-5 sm:p-6 rounded-[26px] border border-[#E8EBF3] shadow-titan flex flex-col items-center justify-center gap-3 transition-all active:scale-95"
                  >
                    <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-[#E8FAF0] text-[#16A05A] flex items-center justify-center">
                      <Folder className="w-6 h-6 sm:w-7 sm:h-7" />
                    </div>
                    <span className="font-bold text-[#151B2D] text-sm">Folder</span>
                  </button>

                </div>
              </div>
            )}

            {activeTab === 'links' && <LinksView />}
            {activeTab === 'settings' && <SettingsView isMobileMode={true} onNavigate={setActiveTab} />}
          </div>

          {/* Mobile Bottom Navigation Bar */}
          <div className="mobile-bottom-nav fixed bottom-0 left-0 right-0 max-w-md mx-auto z-40 px-3 pb-3">
            <div className="bg-white/95 backdrop-blur-md rounded-[26px] border border-[#E8EBF3] shadow-titan-lg p-1.5 flex items-center justify-around">
              
              <button
                onClick={() => setActiveTab('home')}
                className={`flex-1 py-2.5 rounded-[20px] flex flex-col items-center gap-1 transition ${
                  activeTab === 'home'
                    ? 'bg-[#EEF1FF] text-[#5865E9] font-semibold'
                    : 'text-[#788395] hover:text-[#151B2D]'
                }`}
              >
                <HomeIcon className="w-4 h-4" />
                <span className="text-[10px]">Home</span>
              </button>

              <button
                onClick={() => setActiveTab('links')}
                className={`flex-1 py-2.5 rounded-[20px] flex flex-col items-center gap-1 transition ${
                  activeTab === 'links'
                    ? 'bg-[#EEF1FF] text-[#5865E9] font-semibold'
                    : 'text-[#788395] hover:text-[#151B2D]'
                }`}
              >
                <LinkIcon className="w-4 h-4" />
                <span className="text-[10px]">Links</span>
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`flex-1 py-2.5 rounded-[20px] flex flex-col items-center gap-1 transition ${
                  activeTab === 'settings'
                    ? 'bg-[#EEF1FF] text-[#5865E9] font-semibold'
                    : 'text-[#788395] hover:text-[#151B2D]'
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
          onSelectType={handleOpenMediaPicker}
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
