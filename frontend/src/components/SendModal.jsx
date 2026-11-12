import React, { useState, useEffect, useRef } from 'react';
import { X, Wifi, Link as LinkIcon, Laptop, Smartphone, CheckCircle, Copy, QrCode, ArrowRight, Clock, Plus, Camera, RefreshCw, Image, ArrowDownCircle, CheckCircle2 } from 'lucide-react';
import { formatBytes, generateShareLink, generateFolderShareLink, getPairedDevices, getServerUrl, getPairingInfo, getDeviceId, getDeviceName, authenticateDevice } from '../api';
import { Html5QrcodeScanner, Html5Qrcode } from 'html5-qrcode';
import confetti from 'canvas-confetti';

export default function SendModal({ item, onClose, onStartTransfer }) {
  const [view, setView] = useState('menu'); // 'menu' | 'devices' | 'pairing' | 'link'
  const [loading, setLoading] = useState(false);
  const [linkData, setLinkData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [pairingData, setPairingData] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState(null);
  const [liveDownload, setLiveDownload] = useState(null); // { percent, status: 'waiting'|'downloading'|'completed' }
  const imageInputRef = useRef(null);

  const loadDevices = async () => {
    try {
      const devices = await getPairedDevices();
      setPairedDevices(devices || []);
    } catch (e) {
      setPairedDevices([]);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const openPairing = async () => {
    setView('pairing');
    try {
      const pair = await getPairingInfo();
      setPairingData(pair);
    } catch (e) {}
  };

  // Mobile camera scanner inside modal
  const processPairing = async (decodedText) => {
    try {
      const text = typeof decodedText === 'string' ? decodedText.trim() : JSON.stringify(decodedText);

      // Check if URL or link QR
      if (text.startsWith('http://') || text.startsWith('https://') || text.includes('/d/')) {
        try {
          const parsed = new URL(text);
          if (parsed.hostname && parsed.hostname !== 'localhost' && !parsed.hostname.includes('vercel.app')) {
            setServerUrl(parsed.origin);
          }
        } catch (e) {}
        setScanMessage('Detected Titan link! Server URL updated.');
        setScanning(false);
        await loadDevices();
        setTimeout(() => setView('devices'), 800);
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (e) {}

      if (payload && (payload.appName === 'Titan Plus Share' || payload.token || payload.ip)) {
        const laptopIp = payload.ip || (payload.ips && payload.ips[0]) || '127.0.0.1';
        const laptopPort = payload.port || 51733;
        setServerUrl(`http://${laptopIp}:${laptopPort}`);

        const localList = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
        const newDevice = {
          deviceId: payload.token || ('lap_' + (payload.name || 'host')),
          deviceName: payload.name || 'Laptop Server',
          deviceType: payload.type || 'laptop',
          ip: laptopIp,
          ips: payload.ips || [laptopIp],
          port: laptopPort,
          pairedAt: Date.now()
        };
        const updated = localList.filter(d => d.deviceId !== newDevice.deviceId && d.deviceName !== newDevice.deviceName);
        updated.push(newDevice);
        localStorage.setItem('titan_local_paired', JSON.stringify(updated));

        try {
          await authenticateDevice({
            deviceId: getDeviceId(),
            deviceName: getDeviceName(),
            deviceType: 'mobile',
            pairingToken: payload.token
          });
        } catch (e) {}

        setScanMessage(`Paired with ${payload.name || 'Device'} successfully!`);
        setScanning(false);
        await loadDevices();
        setTimeout(() => setView('devices'), 1000);
      } else {
        setScanMessage('Please scan a Titan Plus Share pairing QR code.');
      }
    } catch (e) {
      setScanMessage('Invalid pairing QR code.');
    }
  };

  useEffect(() => {
    if (!scanning || view !== 'pairing') return;

    let scanner = null;
    try {
      scanner = new Html5QrcodeScanner('modal-qr-reader', {
        fps: 10,
        qrbox: { width: 220, height: 220 },
        videoConstraints: {
          facingMode: { ideal: "environment" }
        }
      });

      scanner.render(
        async (decodedText) => {
          await processPairing(decodedText);
          try { scanner.clear(); } catch (e) {}
        },
        () => {}
      );
    } catch (e) {}

    return () => {
      if (scanner) {
        try { scanner.clear(); } catch (e) {}
      }
    };
  }, [scanning, view]);

  const handleScanFromImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const html5QrCode = new Html5Qrcode("modal-qr-image-decoder");
      const decodedText = await html5QrCode.scanFile(file, false);
      await processPairing(decodedText);
    } catch (err) {
      alert('Could not detect QR code in this photo. Please try camera scan.');
    }
    e.target.value = '';
  };

  const handleGenerateLink = async () => {
    setLoading(true);
    try {
      let res;
      if (item.type === 'folder' && item.files) {
        res = await generateFolderShareLink(item.files, item.name);
      } else if (item.type === 'text') {
        res = await generateShareLink(null, 'text', item.text);
      } else {
        res = await generateShareLink(item.file, item.type);
      }
      setLinkData(res);
      setLiveDownload({ status: 'waiting', percent: 0 });

      // Save to local link history
      try {
        const localHistory = JSON.parse(localStorage.getItem('titan_local_created_links') || '[]');
        const updated = [{
          token: res.token,
          fileName: res.fileName,
          fileSize: res.fileSize,
          url: res.url,
          qrCode: res.qrCode,
          createdAt: Date.now(),
          expiresAt: res.expiresAt,
          status: 'pending'
        }, ...localHistory.filter(l => l.token !== res.token)].slice(0, 50);
        localStorage.setItem('titan_local_created_links', JSON.stringify(updated));
      } catch (e) {}

      setView('link');
    } catch (err) {
      alert('Error generating link: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Listen for real-time recipient download progress on this generated link
  useEffect(() => {
    if (!linkData?.token) return;

    const handleProgress = (e) => {
      if (e.detail?.token === linkData.token) {
        setLiveDownload({
          percent: e.detail.percent || 0,
          bytesSent: e.detail.bytesSent || 0,
          totalBytes: e.detail.totalBytes || 0,
          status: e.detail.percent >= 100 ? 'completed' : 'downloading'
        });
      }
    };

    const handleCompleted = (e) => {
      if (e.detail?.token === linkData.token) {
        setLiveDownload({ percent: 100, status: 'completed' });
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
      }
    };

    window.addEventListener('titan-link-progress', handleProgress);
    window.addEventListener('titan-link-completed', handleCompleted);
    return () => {
      window.removeEventListener('titan-link-progress', handleProgress);
      window.removeEventListener('titan-link-completed', handleCompleted);
    };
  }, [linkData]);

  const handleCopy = () => {
    if (linkData?.url) {
      navigator.clipboard.writeText(linkData.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const getItemBadge = () => {
    if (item.type === 'folder') return 'DIR';
    if (item.type === 'text') return 'TXT';
    if (item.type === 'media') return 'IMG';
    const ext = item.name.split('.').pop()?.toUpperCase() || 'FILE';
    return ext.substring(0, 4);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-fadeIn">
      <div className="w-full sm:max-w-md bg-white rounded-t-[28px] sm:rounded-[26px] p-4 sm:p-6 shadow-modal border border-slate-100 max-h-[90vh] overflow-y-auto pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-6">
        
        {/* Selected Content Card */}
        <div className="flex items-center justify-between p-3.5 bg-slate-50/90 rounded-2xl border border-slate-100 mb-4 sm:mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs tracking-wider shrink-0 border border-blue-100">
              {getItemBadge()}
            </div>
            <div className="min-w-0">
              <h4 className="font-semibold text-slate-800 text-sm truncate">{item.name}</h4>
              <p className="text-xs text-slate-500 font-medium">
                {item.type === 'folder' 
                  ? `${item.fileCount || (item.files ? item.files.length : 1)} files • ${formatBytes(item.size)}`
                  : formatBytes(item.size)}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* View 1: Send How Menu */}
        {view === 'menu' && (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 px-1">Send How?</h3>
            <div className="space-y-3">
              
              {/* Option 1: Same Network */}
              <button
                onClick={() => setView('devices')}
                className="w-full flex items-center justify-between p-4 bg-blue-50/50 hover:bg-blue-50 border border-blue-100 rounded-2xl transition group text-left"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                    <Wifi className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">Same Network (Fast)</div>
                    <div className="text-xs text-slate-500">Send directly to paired devices on LAN</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition" />
              </button>

              {/* Option 2: Generate Link */}
              <button
                onClick={handleGenerateLink}
                disabled={loading}
                className="w-full flex items-center justify-between p-4 bg-slate-50/80 hover:bg-slate-100/70 border border-slate-100 rounded-2xl transition group text-left"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center">
                    <LinkIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800 text-sm">Generate Link (Anywhere)</div>
                    <div className="text-xs text-slate-500">Create a 3-hour download link to share</div>
                  </div>
                </div>
                {loading ? (
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-1" />
                ) : (
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* View 2: Device Selection (NO DUMMY DATA) */}
        {view === 'devices' && (
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-sm font-semibold text-slate-700">Select Device (Same Network)</h3>
              <button 
                onClick={() => setView('menu')}
                className="text-xs text-blue-600 font-semibold hover:underline"
              >
                Back
              </button>
            </div>

            {pairedDevices.length > 0 ? (
              <div className="space-y-2.5">
                {pairedDevices.map((dev) => (
                  <button
                    key={dev.deviceId}
                    onClick={() => onStartTransfer(dev, item)}
                    className="w-full flex items-center justify-between p-3.5 bg-white hover:bg-blue-50/50 border border-slate-100 hover:border-blue-200 rounded-2xl shadow-sm transition group text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-blue-600 group-hover:text-white text-slate-600 flex items-center justify-center transition duration-200">
                        {dev.deviceType === 'laptop' ? <Laptop className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 text-sm">{dev.deviceName}</span>
                          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-medium">
                          {dev.ip ? `${dev.ip} • Online` : 'Online'}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-0.5 transition" />
                  </button>
                ))}

                <button
                  onClick={openPairing}
                  className="w-full py-2.5 px-3 border border-dashed border-slate-200 hover:border-blue-300 rounded-xl text-xs font-semibold text-slate-500 hover:text-blue-600 flex items-center justify-center gap-1.5 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Pair Another Device</span>
                </button>
              </div>
            ) : (
              /* REAL EMPTY STATE WHEN NO DEVICES ARE PAIRED */
              <div className="p-6 bg-slate-50/80 rounded-2xl border border-slate-100 text-center">
                <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <QrCode className="w-7 h-7" />
                </div>
                <h4 className="font-bold text-slate-800 text-sm mb-1">No Paired Devices Found</h4>
                <p className="text-xs text-slate-500 mb-4 max-w-xs mx-auto">
                  Pair your PC and Mobile once using QR code to enable direct local network transfer.
                </p>
                <button
                  onClick={openPairing}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-md shadow-blue-500/25 transition"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Pair Device via QR Code</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* View 3: Pair Device QR View */}
        {view === 'pairing' && (
          <div className="text-center py-1">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-sm font-semibold text-slate-700">Pair Device via QR Code</h3>
              <button 
                onClick={() => setView('devices')}
                className="text-xs text-blue-600 font-semibold hover:underline"
              >
                Back
              </button>
            </div>

            {/* Hidden decoder container */}
            <div id="modal-qr-image-decoder" className="hidden"></div>
            <input 
              type="file" 
              ref={imageInputRef} 
              accept="image/*" 
              onChange={handleScanFromImage} 
              className="hidden" 
            />

            {/* Option to Scan with Camera or Image */}
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setScanning(!scanning)}
                  className="flex-1 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border border-blue-200 transition"
                >
                  <Camera className="w-4 h-4" />
                  <span>{scanning ? 'Close Camera' : 'Camera Scan'}</span>
                </button>
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="px-3.5 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
                >
                  <Image className="w-4 h-4 text-blue-600" />
                  <span>Choose Photo</span>
                </button>
              </div>

              {scanning && (
                <div className="mt-3 p-3 bg-slate-100 rounded-2xl">
                  <div id="modal-qr-reader" className="w-full max-w-xs mx-auto overflow-hidden rounded-xl"></div>
                </div>
              )}

              {scanMessage && (
                <div className="mt-3 p-2.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5">
                  <CheckCircle className="w-4 h-4" />
                  <span>{scanMessage}</span>
                </div>
              )}
            </div>

            {/* Display QR code for other device to scan */}
            {pairingData?.qrCode ? (
              <div className="p-3.5 sm:p-4 bg-slate-50 rounded-2xl border border-slate-100 inline-block mb-3 max-w-full overflow-hidden">
                <img src={pairingData.qrCode} alt="Pairing QR" className="w-36 sm:w-44 h-36 sm:h-44 max-w-full rounded-xl mx-auto shadow-sm border border-slate-200 object-contain" />
                <p className="text-[11px] text-slate-500 mt-2 font-medium truncate">
                  {pairingData.payload?.name} ({pairingData.payload?.ip})
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Scan this code using Titan Plus Share on your other device
                </p>
              </div>
            ) : (
              <div className="py-8">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto" />
              </div>
            )}

            <button
              onClick={async () => {
                await loadDevices();
                setView('devices');
              }}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition mt-2"
            >
              Done / Check Paired Devices
            </button>
          </div>
        )}

        {/* View 4: Download Link Generated */}
        {view === 'link' && linkData && (
          <div className="text-center py-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-semibold mb-4">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Download Link Generated</span>
            </div>

            {/* Link Box */}
            <div className="flex items-center gap-1.5 sm:gap-2 p-2 sm:p-2.5 bg-slate-50 border border-slate-200 rounded-2xl mb-4 min-w-0">
              <LinkIcon className="w-4 h-4 text-blue-600 shrink-0 ml-1" />
              <input 
                type="text" 
                readOnly 
                value={linkData.url}
                className="bg-transparent text-xs text-slate-700 font-medium flex-1 outline-none truncate min-w-0"
              />
              <button
                onClick={handleCopy}
                title="Copy Link"
                className="p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 transition shrink-0"
              >
                {copied ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setShowQr(!showQr)}
                title="Show QR Code"
                className="p-2 sm:px-3 sm:py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition shrink-0 flex items-center gap-1 text-xs font-semibold shadow-sm"
              >
                <QrCode className="w-4 h-4" />
                <span className="hidden sm:inline">QR</span>
              </button>
            </div>

            {/* QR Code expansion */}
            {showQr && (
              <div className="p-3.5 sm:p-4 bg-slate-50 rounded-2xl border border-slate-100 inline-block mb-4 animate-fadeIn max-w-full overflow-hidden">
                <img src={linkData.qrCode} alt="Download QR Code" className="w-36 sm:w-44 h-36 sm:h-44 max-w-full rounded-lg mx-auto object-contain" />
                <p className="text-[11px] text-slate-400 mt-2">Scan with camera to download on any device</p>
              </div>
            )}

            {/* Real-time Receiver Download Status Card */}
            <div className="mb-4 p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-left">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <ArrowDownCircle className="w-4 h-4 text-blue-600" />
                  <span>Receiver Download Status</span>
                </span>
                {liveDownload?.status === 'downloading' && (
                  <span className="text-xs font-bold text-blue-600 animate-pulse">{liveDownload.percent}%</span>
                )}
                {liveDownload?.status === 'completed' && (
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Completed</span>
                  </span>
                )}
                {(!liveDownload || liveDownload.status === 'waiting') && (
                  <span className="text-[11px] text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                    Waiting for receiver...
                  </span>
                )}
              </div>

              {liveDownload?.status === 'downloading' && (
                <div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden mb-1.5">
                    <div 
                      className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${liveDownload.percent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                    <span>Downloading to receiver device...</span>
                    <span>{formatBytes(liveDownload.bytesSent)} / {formatBytes(liveDownload.totalBytes)}</span>
                  </div>
                </div>
              )}

              {liveDownload?.status === 'completed' && (
                <p className="text-xs text-emerald-600 font-semibold mt-1">
                  Recipient has downloaded this file successfully!
                </p>
              )}

              {(!liveDownload || liveDownload.status === 'waiting') && (
                <p className="text-[11px] text-slate-500">
                  When recipient clicks your link or scans the QR, live progress will display here in real time.
                </p>
              )}
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-slate-400 mb-4">
              <Clock className="w-3.5 h-3.5" />
              <span>Expires in 3 hours automatically</span>
            </div>

            <button
              onClick={onClose}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition"
            >
              Done
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
