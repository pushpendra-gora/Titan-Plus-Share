import React, { useState, useEffect, useRef } from 'react';
import { QrCode, Smartphone, Laptop, Trash2, Camera, Check, Server, HardDrive, Info, RefreshCw, Folder, Image, Wifi, Radio, Copy, CheckCircle2, ShieldCheck, X } from 'lucide-react';
import { getDeviceId, getDeviceName, setDeviceName, getPairingInfo, getPairedDevices, removePairedDevice, authenticateDevice, getServerUrl, setServerUrl, autoDiscoverLaptopServer } from '../api';
import { Html5Qrcode } from 'html5-qrcode';

export default function SettingsView({ isMobileMode, onNavigate }) {
  const [deviceName, setDevName] = useState(getDeviceName());
  const [savedName, setSavedName] = useState(false);
  const [pairingData, setPairingData] = useState(null);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [hostUrl, setHostUrl] = useState(getServerUrl());
  const [hostConnected, setHostConnected] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  // Save Path State
  const defaultPath = isMobileMode 
    ? '/storage/emulated/0/Download/TitanPlusShare' 
    : 'C:\\Users\\Public\\Downloads\\TitanPlusShare';
  const [savePath, setSavePath] = useState(localStorage.getItem('titan_save_path') || defaultPath);
  const [savedPath, setSavedPath] = useState(false);

  const fileInputRef = useRef(null);

  const testHostConnection = async (url) => {
    try {
      const target = (url || getServerUrl()).replace(/\/$/, '');
      const res = await fetch(`${target}/api/status`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        setHostConnected(true);
        return true;
      }
    } catch (e) {}
    setHostConnected(false);
    return false;
  };

  const reloadData = async () => {
    try {
      const pair = await getPairingInfo();
      setPairingData(pair);
    } catch (e) {}

    try {
      const devices = await getPairedDevices();
      setPairedDevices(devices || []);
    } catch (e) {}

    testHostConnection(getServerUrl());
  };

  useEffect(() => {
    reloadData();
    const timer = setInterval(() => testHostConnection(getServerUrl()), 5000);
    return () => clearInterval(timer);
  }, []);

  // Handle Mobile hardware / gesture back button
  useEffect(() => {
    if (typeof window.registerTitanBackHandler === 'function') {
      return window.registerTitanBackHandler(() => {
        if (scanning) {
          setScanning(false);
          return true;
        }
        return false;
      });
    }
  }, [scanning]);

  const handleSaveHostUrl = async () => {
    if (!hostUrl) return;
    let clean = hostUrl.trim().replace(/\/$/, '');
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `http://${clean}`;
    }
    if (!clean.includes(':', 7)) {
      clean = `${clean}:51733`;
    }
    setHostUrl(clean);
    setServerUrl(clean);
    const ok = await testHostConnection(clean);
    if (ok) {
      setScanResult('Connected to Laptop Server at ' + clean);
    } else {
      setScanResult('Saved server address. Ensure Laptop is running Titan Plus Share.');
    }
    reloadData();
  };

  const handleAutoDiscover = async () => {
    setDiscovering(true);
    setScanResult('Scanning local Wi-Fi & Hotspot for Laptop...');
    try {
      const found = await autoDiscoverLaptopServer();
      if (found) {
        setHostUrl(found);
        setHostConnected(true);
        setScanResult(`Laptop found & connected at ${found}!`);
        await reloadData();
      } else {
        setScanResult('Laptop not found automatically. Check that both devices are on same Hotspot / Wi-Fi.');
      }
    } catch (e) {
      setScanResult('Discovery error: ' + e.message);
    } finally {
      setDiscovering(false);
    }
  };

  const handleSaveDeviceName = () => {
    setDeviceName(deviceName);
    setSavedName(true);
    setTimeout(() => setSavedName(false), 2000);
  };

  const handleSavePath = async () => {
    localStorage.setItem('titan_save_path', savePath);
    setSavedPath(true);
    try {
      await fetch(`${getServerUrl()}/api/settings/save-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ savePath })
      });
    } catch (e) {}
    setTimeout(() => setSavedPath(false), 2000);
  };

  const handleRemoveDevice = async (id) => {
    await removePairedDevice(id);
    reloadData();
  };

  const processPairingPayload = async (decodedText) => {
    try {
      const text = typeof decodedText === 'string' ? decodedText.trim() : JSON.stringify(decodedText);

      // 1. Check if user scanned a download link QR code
      if (text.startsWith('http://') || text.startsWith('https://') || text.includes('/d/')) {
        try {
          const parsed = new URL(text);
          if (parsed.hostname && parsed.hostname !== 'localhost' && !parsed.hostname.includes('vercel.app')) {
            setServerUrl(parsed.origin);
            setHostUrl(parsed.origin);
          }
        } catch (e) {}

        localStorage.setItem('titan_pending_download_link', text);
        setScanResult('Detected Titan Plus Share Download link! Switching to Remote Downloads...');
        setScanning(false);
        setTimeout(() => {
          if (typeof onNavigate === 'function') onNavigate('links');
        }, 800);
        return;
      }

      // 2. Check if JSON pairing payload
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (e) {}

      if (payload && (payload.appName === 'Titan Plus Share' || payload.token || payload.ip)) {
        const laptopIp = payload.ip || (payload.ips && payload.ips[0]) || '127.0.0.1';
        const laptopPort = payload.port || 51733;
        const laptopUrl = `http://${laptopIp}:${laptopPort}`;
        
        setServerUrl(laptopUrl);
        setHostUrl(laptopUrl);

        // Save paired device locally immediately
        const localList = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
        const newDevice = {
          deviceId: payload.token || ('lap_' + (payload.name || 'host')),
          deviceName: payload.name || 'Host Laptop',
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

        setScanResult(`Paired successfully with ${payload.name || 'Laptop'} (${laptopIp})!`);
        setScanning(false);
        await reloadData();
        return;
      }

      // 3. Fallback: check if plain IP was scanned
      const ipMatch = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/);
      if (ipMatch) {
        const rawHost = ipMatch[0];
        const fullHost = rawHost.includes(':') ? `http://${rawHost}` : `http://${rawHost}:51733`;
        setServerUrl(fullHost);
        setHostUrl(fullHost);
        setScanResult(`Target Laptop server set to ${fullHost}`);
        setScanning(false);
        await reloadData();
        return;
      }

      setScanResult('Not recognized as Titan pairing code. Scan QR from Laptop Settings.');
    } catch (err) {
      console.error('Pairing QR parse error:', err);
      setScanResult('Could not parse QR code. Please try again.');
    }
  };

  // Unique scanner DOM element ID
  const settingsScannerDomId = useRef(`qr-reader-${Math.random().toString(36).substring(2, 7)}`);

  // Live Direct Camera Scanner (Instant Camera View - Zero intermediate dashboard)
  useEffect(() => {
    if (!scanning) return;

    let qrCodeInstance = null;
    let isStopped = false;

    const startDirectCamera = async () => {
      try {
        const domId = settingsScannerDomId.current;
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
          setScanning(false);
          await processPairingPayload(decodedText);
        };

        // Immediately start back camera directly without any buttons or dropdowns
        try {
          await qrCodeInstance.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
        } catch (camErr) {
          try {
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
              setScanResult('Camera permission required. Please allow camera access in app settings.');
              setScanning(false);
            }
          }
        }
      } catch (e) {
        console.warn('Settings camera direct start error:', e);
        setScanResult('Could not open camera.');
        setScanning(false);
      }
    };

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
  }, [scanning]);

  // Decode QR from Image / Photo
  const handleScanFromImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const html5QrCode = new Html5Qrcode("qr-image-decoder");
      const decodedText = await html5QrCode.scanFile(file, false);
      await processPairingPayload(decodedText);
    } catch (err) {
      setScanResult('Could not detect a valid QR code in this photo. Please try camera scan.');
    }
    e.target.value = '';
  };

  // ==========================================
  // DESKTOP / LAPTOP LAYOUT (!isMobileMode)
  // ==========================================
  if (!isMobileMode) {
    return (
      <div className="w-full max-w-7xl mx-auto px-6 py-4 space-y-6 animate-fadeIn pb-12">
        {/* Top Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-900">System & Server Settings</h2>
              <span className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full border border-blue-100">
                Laptop Server
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Configure host streaming server, local save directories, and paired mobile devices
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3.5 py-2 bg-white rounded-xl border border-slate-200 shadow-sm text-xs">
              <span className={`w-2 h-2 rounded-full ${hostConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span className="font-semibold text-slate-700">{hostConnected ? 'Laptop Server Active' : 'Connecting...'}</span>
              <span className="text-slate-400 font-mono font-medium">Port 51733</span>
            </div>
            <button
              onClick={reloadData}
              className="p-2.5 bg-white hover:bg-slate-50 text-slate-600 rounded-xl border border-slate-200 shadow-sm transition"
              title="Refresh Server Status"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Desktop Grid: 8 Cols Left + 4 Cols Right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT COLUMN: 8 COLS */}
          <div className="lg:col-span-8 space-y-6">

            {/* Section 1: Host Server & Device Identity */}
            <div className="bg-white rounded-[24px] p-6 shadow-card border border-slate-100">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                  <Laptop className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Laptop Server & Identity</h3>
                  <p className="text-xs text-slate-400">Network streaming address and device identity broadcast</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Laptop Device Name</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={deviceName}
                      onChange={(e) => setDevName(e.target.value)}
                      className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                    <button
                      onClick={handleSaveDeviceName}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shrink-0"
                    >
                      {savedName ? <Check className="w-4 h-4" /> : 'Save'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Host Server Address</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={hostUrl}
                      onChange={(e) => setHostUrl(e.target.value)}
                      className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                    <button
                      onClick={handleSaveHostUrl}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shrink-0"
                    >
                      Update
                    </button>
                  </div>
                </div>
              </div>

              {/* Network Chips */}
              <div className="mt-5 pt-4 border-t border-slate-50 flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2 text-slate-500">
                  <Wifi className="w-3.5 h-3.5 text-blue-600" />
                  <span>Primary LAN IP: <strong className="font-mono text-slate-700">{pairingData?.payload?.ip || '10.89.213.60'}</strong></span>
                </div>
                <div className="flex items-center gap-2 text-slate-500">
                  <Radio className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Transfer Engine: <strong className="text-emerald-700">Direct Socket Stream (Zero Cloud)</strong></span>
                </div>
              </div>
            </div>

            {/* Section 2: Received Files Storage Directory */}
            <div className="bg-white rounded-[24px] p-6 shadow-card border border-slate-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                  <Folder className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">Received Files Save Location</h3>
                  <p className="text-xs text-slate-400">Incoming files received from mobile devices will be saved directly to this path</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3">
                <input
                  type="text"
                  value={savePath}
                  onChange={(e) => setSavePath(e.target.value)}
                  placeholder="C:\Users\Public\Downloads\TitanPlusShare"
                  className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <button
                  onClick={handleSavePath}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shrink-0 flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {savedPath ? <Check className="w-4 h-4" /> : 'Save Location'}
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-400 mr-1">Quick Presets:</span>
                <button
                  onClick={() => setSavePath('C:\\Users\\Public\\Downloads\\TitanPlusShare')}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition"
                >
                  Public Downloads
                </button>
                <button
                  onClick={() => setSavePath('Desktop\\TitanPlusShare')}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition"
                >
                  Desktop
                </button>
              </div>
            </div>

            {/* Section 3: Paired Devices List (Spacious Desktop View) */}
            <div className="bg-white rounded-[24px] p-6 shadow-card border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Paired Mobile Devices</h3>
                    <p className="text-xs text-slate-400">Smartphones authorized for 1-click instant direct file transfers</p>
                  </div>
                </div>
                <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-bold">
                  {pairedDevices.length} Connected
                </span>
              </div>

              {pairedDevices.length === 0 ? (
                <div className="p-8 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 text-center">
                  <Smartphone className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <h4 className="font-bold text-slate-700 text-sm mb-1">No Mobile Devices Paired Yet</h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Scan the QR code on the right side using the Titan Plus Share mobile app to pair your phone.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pairedDevices.map((d) => (
                    <div key={d.deviceId} className="p-4 bg-slate-50/80 hover:bg-blue-50/30 rounded-2xl border border-slate-100 transition flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white text-blue-600 flex items-center justify-center border border-slate-200 shadow-sm">
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 text-sm">{d.deviceName}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-xs text-emerald-600 font-medium font-mono">{d.ip || 'LAN Connected'}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveDevice(d.deviceId)}
                        className="p-2.5 text-slate-400 hover:text-rose-500 hover:bg-white rounded-xl border border-transparent hover:border-slate-200 transition"
                        title="Unpair Device"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* RIGHT COLUMN: 4 COLS (HERO PAIRING QR CODE & SYSTEM INFO) */}
          <div className="lg:col-span-4 space-y-6">

            {/* Hero Pairing QR Card */}
            <div className="bg-white rounded-[24px] p-6 shadow-card border border-slate-100 text-center">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold mb-4">
                <QrCode className="w-3.5 h-3.5" />
                <span>Mobile Pairing QR</span>
              </div>

              <h3 className="font-bold text-slate-800 text-base mb-1">Pair with Phone</h3>
              <p className="text-xs text-slate-400 mb-5">
                Open Titan Plus Share on your phone and scan this code to link
              </p>

              {pairingData?.qrCode ? (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 inline-block mb-4 shadow-sm">
                  <img src={pairingData.qrCode} alt="Laptop Pairing QR" className="w-48 h-48 mx-auto rounded-xl shadow-inner border border-slate-200 object-contain" />
                </div>
              ) : (
                <div className="w-48 h-48 mx-auto bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center mb-4">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
                </div>
              )}

              <div className="p-3 bg-slate-50 rounded-xl text-left border border-slate-100 mb-4">
                <div className="text-[11px] font-semibold text-slate-400 mb-0.5">Host Server</div>
                <div className="text-xs font-mono font-bold text-slate-800 truncate">
                  {pairingData?.payload?.name} ({pairingData?.payload?.ip}:{pairingData?.payload?.port || 51733})
                </div>
              </div>

              <div className="text-left space-y-2 text-xs text-slate-500">
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                  <span>Connect both Laptop & Phone to same Wi-Fi or Mobile Hotspot</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                  <span>Open Titan Plus Share on your Android phone</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                  <span>Tap "Pair Device" and point camera at this QR code</span>
                </div>
              </div>
            </div>

            {/* About & Eco Card */}
            <div className="bg-white rounded-[24px] p-6 shadow-card border border-slate-100">
              <div className="flex items-center gap-3 mb-4">
                <img src="/logo.png" alt="Titan Plus Share" className="w-12 h-12 rounded-2xl object-cover shadow-sm" />
                <div>
                  <h4 className="font-bold text-slate-900 text-base leading-tight">Titan Plus Share</h4>
                  <p className="text-xs text-slate-400">Fast • Simple • Anywhere</p>
                  <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-200">
                    Version 1.0.0
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Architecture</span>
                  <span className="font-semibold">Local Node Engine + React</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Security</span>
                  <span className="font-semibold text-emerald-600">Zero Cloud • Direct LAN</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Status</span>
                  <span className="font-semibold text-blue-600">All Services Operational</span>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>
    );
  }

  // ==========================================
  // MOBILE APK LAYOUT (isMobileMode)
  // ==========================================
  return (
    <div className="w-full max-w-xl mx-auto px-2 sm:px-4 py-3 sm:py-6 space-y-4 animate-fadeIn overflow-x-hidden pb-24 sm:pb-8">
      
      {/* Hidden container for image decoding */}
      <div id="qr-image-decoder" className="hidden"></div>
      <input 
        type="file" 
        ref={fileInputRef} 
        accept="image/*" 
        onChange={handleScanFromImage} 
        className="hidden" 
      />

      {/* Header */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-800">Settings</h2>
        <p className="text-[11px] sm:text-xs text-slate-500">Configure pairing, save location, and preferences</p>
      </div>

      {/* Device Profile Card */}
      <div className="bg-white rounded-[22px] p-4 sm:p-5 shadow-card border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Device Identity</h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDevName(e.target.value)}
            className="flex-1 min-w-0 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <button
            onClick={handleSaveDeviceName}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shrink-0"
          >
            {savedName ? <Check className="w-4 h-4" /> : 'Save'}
          </button>
        </div>
      </div>

      {/* Host Laptop Server Connection Card */}
      <div className="bg-white rounded-[22px] p-4 sm:p-5 shadow-card border border-slate-100">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 shrink-0">
              <Server className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-semibold text-slate-800 truncate">Host Laptop Server</h3>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">Direct LAN / Hotspot IP of host laptop</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold shrink-0 ${
            hostConnected ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-amber-50 text-amber-600 border border-amber-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${hostConnected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
            {hostConnected ? 'Connected' : 'Offline'}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3">
          <input
            type="text"
            value={hostUrl}
            onChange={(e) => setHostUrl(e.target.value)}
            placeholder="http://10.89.213.60:51733"
            className="flex-1 min-w-0 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <button
            onClick={handleSaveHostUrl}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shrink-0 flex items-center justify-center"
          >
            Connect
          </button>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-50 text-[11px]">
          <span className="text-slate-400">Default Port: 51733</span>
          <button
            onClick={handleAutoDiscover}
            disabled={discovering}
            className="text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1 transition"
          >
            <RefreshCw className={`w-3 h-3 ${discovering ? 'animate-spin' : ''}`} />
            <span>{discovering ? 'Detecting...' : 'Auto-Detect Laptop'}</span>
          </button>
        </div>
      </div>

      {/* Save Location Configuration (For Mobile) */}
      <div className="bg-white rounded-[22px] p-4 sm:p-5 shadow-card border border-slate-100">
        <div className="flex items-center gap-2.5 mb-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 shrink-0">
            <Folder className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-semibold text-slate-800 truncate">Received Files Save Location</h3>
            <p className="text-[10px] sm:text-xs text-slate-500 truncate">Saved here automatically</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3 mt-3">
          <input
            type="text"
            value={savePath}
            onChange={(e) => setSavePath(e.target.value)}
            placeholder="/storage/emulated/0/Download/TitanPlusShare"
            className="flex-1 min-w-0 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30"
          />
          <button
            onClick={handleSavePath}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition shrink-0 flex items-center justify-center"
          >
            {savedPath ? <Check className="w-4 h-4" /> : 'Save Path'}
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-slate-400">Presets:</span>
          <button 
            onClick={() => setSavePath('/storage/emulated/0/Download/TitanPlusShare')}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-medium transition"
          >
            Downloads Folder
          </button>
        </div>
      </div>

      {/* One-Time QR Pairing Section */}
      <div className="bg-white rounded-[22px] p-4 sm:p-5 shadow-card border border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-slate-800">One-Time Device Pairing</h3>
            <p className="text-[11px] sm:text-xs text-slate-500">Pair laptop & mobile for instant auto-discovery</p>
          </div>
        </div>

        {/* Pairing Actions */}
        <div className="space-y-3">
          <div className="p-3.5 sm:p-4 bg-blue-50/60 rounded-2xl border border-blue-100/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-semibold text-slate-800 text-xs sm:text-sm">Scan Laptop QR Code</h4>
              <p className="text-[11px] text-slate-500">Use Camera or choose photo</p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
              <button
                onClick={() => setScanning(!scanning)}
                className="px-3.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-sm"
              >
                <Camera className="w-4 h-4" />
                <span>{scanning ? 'Close' : 'Camera'}</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-sm"
              >
                <Image className="w-4 h-4 text-blue-600" />
                <span>Photo</span>
              </button>
            </div>
          </div>

          {scanning && (
            <div className="p-3 sm:p-4 bg-white rounded-2xl border border-blue-200 overflow-hidden text-center shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                  <span>Scanning Laptop QR...</span>
                </span>
                <button onClick={() => setScanning(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative overflow-hidden rounded-2xl bg-black aspect-square max-w-[260px] mx-auto shadow-inner">
                <div id={settingsScannerDomId.current} className="w-full h-full min-h-[240px]"></div>
                <div className="absolute inset-0 border-2 border-blue-500/40 rounded-2xl pointer-events-none flex items-center justify-center">
                  <div className="w-48 h-48 border border-white/40 rounded-xl relative">
                    <div className="absolute -top-0.5 -left-0.5 w-4 h-4 border-t-2 border-l-2 border-blue-500 rounded-tl"></div>
                    <div className="absolute -top-0.5 -right-0.5 w-4 h-4 border-t-2 border-r-2 border-blue-500 rounded-tr"></div>
                    <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 border-b-2 border-l-2 border-blue-500 rounded-bl"></div>
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 border-b-2 border-r-2 border-blue-500 rounded-br"></div>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 text-center mt-2">Point camera directly at the laptop pairing QR</p>
            </div>
          )}

          {scanResult && (
            <div className="p-3 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-xl border border-emerald-100 flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>{scanResult}</span>
            </div>
          )}
        </div>

        {/* Paired Devices List */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-semibold text-slate-700 mb-3">Paired Devices ({pairedDevices.length})</h4>
          {pairedDevices.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">No devices paired yet. Scan the QR code to pair.</p>
          ) : (
            <div className="space-y-2">
              {pairedDevices.map((d) => (
                <div key={d.deviceId} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-white text-blue-600 flex items-center justify-center border border-slate-200">
                      {d.deviceType === 'laptop' ? <Laptop className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800 text-xs">{d.deviceName}</div>
                      <div className="text-[10px] text-emerald-600 font-medium">Paired • {d.ip || 'LAN'}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveDevice(d.deviceId)}
                    className="p-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-white transition"
                    title="Remove device"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* About Box */}
      <div className="bg-white rounded-[22px] p-5 shadow-card border border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Titan Plus Share" className="w-10 h-10 rounded-xl object-cover shadow-sm" />
          <div>
            <h4 className="font-semibold text-slate-800 text-xs sm:text-sm">Titan Plus Share</h4>
            <p className="text-[11px] text-slate-400">Fast • Simple • Anywhere</p>
          </div>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg">v1.0.0</span>
      </div>

    </div>
  );
}
