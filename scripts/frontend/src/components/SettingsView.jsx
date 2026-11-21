import React, { useState, useEffect, useRef } from 'react';
import { QrCode, Smartphone, Laptop, Trash2, Camera, Check, Server, HardDrive, Info, RefreshCw, Folder, Image, Wifi, Radio, Copy, CheckCircle2, ShieldCheck, X, ScanLine, Share2 } from 'lucide-react';
import { getDeviceId, getDeviceName, setDeviceName, getPairingInfo, getPairedDevices, removePairedDevice, authenticateDevice, getServerUrl, setServerUrl, autoDiscoverLaptopServer } from '../api';
import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';

export default function SettingsView({ isMobileMode, onNavigate }) {
  const [deviceName, setDevName] = useState(getDeviceName());
  const [savedName, setSavedName] = useState(false);
  const [pairingData, setPairingData] = useState(null);
  const [mobileQr, setMobileQr] = useState(null);
  const [pairingTab, setPairingTab] = useState('qr'); // 'qr' | 'scan'
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [hostUrl, setHostUrl] = useState(getServerUrl());
  const [hostConnected, setHostConnected] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

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

  // Generate Mobile Device Pairing QR Code
  useEffect(() => {
    let isMounted = true;
    const generateMobileQr = async () => {
      try {
        const devId = getDeviceId();
        const devName = deviceName || getDeviceName();
        const srv = getServerUrl();
        const payload = {
          appName: 'Titan Plus Share',
          type: 'mobile',
          name: devName,
          deviceId: devId,
          token: devId,
          serverUrl: srv && !srv.includes('127.0.0.1') && !srv.includes('localhost') ? srv : undefined,
          pairedAt: Date.now()
        };
        const qrString = JSON.stringify(payload);
        const qrUrl = await QRCode.toDataURL(qrString, { margin: 1, width: 280 });
        if (isMounted) setMobileQr(qrUrl);
      } catch (e) {
        console.error('Could not generate mobile QR code:', e);
      }
    };
    generateMobileQr();
    return () => { isMounted = false; };
  }, [deviceName, hostUrl]);

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

      if (payload && (payload.appName === 'Titan Plus Share' || payload.token || payload.deviceId || payload.ip)) {
        const peerType = payload.type || 'mobile';
        const laptopIp = payload.ip || (payload.ips && payload.ips[0]) || '';
        const laptopPort = payload.port || 51733;
        const targetUrl = payload.serverUrl || (laptopIp ? `http://${laptopIp}:${laptopPort}` : null);
        
        if (targetUrl && (payload.serverUrl || (laptopIp && laptopIp !== '127.0.0.1'))) {
          setServerUrl(targetUrl);
          setHostUrl(targetUrl);
        }

        // Save paired device locally immediately
        const localList = JSON.parse(localStorage.getItem('titan_local_paired') || '[]');
        const newDevice = {
          deviceId: payload.deviceId || payload.token || ('dev_' + (payload.name || 'peer')),
          deviceName: payload.name || (peerType === 'laptop' ? 'Host Laptop' : 'Mobile Device'),
          deviceType: peerType,
          ip: laptopIp || 'LAN',
          ips: payload.ips || (laptopIp ? [laptopIp] : ['LAN']),
          port: laptopPort,
          serverUrl: targetUrl,
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
            pairingToken: payload.token || payload.deviceId,
            peerDevice: newDevice
          });
        } catch (e) {}

        setScanResult(`Paired successfully with ${newDevice.deviceName} (${peerType === 'laptop' ? 'Laptop' : 'Mobile'})!`);
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E8EBF3]">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-[#151B2D]">System & Server Settings</h2>
              <span className="px-3.5 py-1 bg-[#EEF1FF] text-[#5865E9] text-xs font-bold rounded-full">
                Laptop Server
              </span>
            </div>
            <p className="text-xs text-[#788395] mt-1">
              Configure host streaming server, local save directories, and paired mobile devices
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white rounded-2xl border border-[#E8EBF3] shadow-titan text-xs">
              <span className={`w-2.5 h-2.5 rounded-full ${hostConnected ? 'bg-[#16A05A] animate-pulse' : 'bg-amber-500'}`} />
              <span className="font-semibold text-[#151B2D]">{hostConnected ? 'Laptop Server Active' : 'Connecting...'}</span>
              <span className="text-[#788395] font-mono font-medium">Port 51733</span>
            </div>
            <button
              onClick={reloadData}
              className="p-2.5 bg-white hover:bg-[#F8F9FD] text-[#788395] hover:text-[#5865E9] rounded-2xl border border-[#E8EBF3] shadow-titan transition"
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
            <div className="bg-white rounded-[28px] p-6 sm:p-7 shadow-titan border border-[#E8EBF3]">
              <div className="flex items-center gap-3.5 mb-6">
                <div className="w-12 h-12 rounded-full bg-[#EEF1FF] text-[#5865E9] flex items-center justify-center">
                  <Laptop className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#151B2D]">Laptop Server & Identity</h3>
                  <p className="text-xs text-[#788395]">Network streaming address and device identity broadcast</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#151B2D] mb-2">Laptop Device Name</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={deviceName}
                      onChange={(e) => setDevName(e.target.value)}
                      className="flex-1 px-4 py-3 bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl text-sm font-semibold text-[#151B2D] outline-none focus:ring-2 focus:ring-[#5865E9]/20 focus:border-[#5865E9]"
                    />
                    <button
                      onClick={handleSaveDeviceName}
                      className="px-5 py-3 bg-[#5865E9] hover:bg-[#4c57d8] text-white rounded-2xl text-xs font-semibold transition shrink-0 shadow-titan-sm"
                    >
                      {savedName ? <Check className="w-4 h-4" /> : 'Save'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#151B2D] mb-2">Host Server Address</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={hostUrl}
                      onChange={(e) => setHostUrl(e.target.value)}
                      className="flex-1 px-4 py-3 bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl text-xs font-mono text-[#151B2D] outline-none focus:ring-2 focus:ring-[#5865E9]/20 focus:border-[#5865E9]"
                    />
                    <button
                      onClick={handleSaveHostUrl}
                      className="px-5 py-3 bg-[#5865E9] hover:bg-[#4c57d8] text-white rounded-2xl text-xs font-semibold transition shrink-0 shadow-titan-sm"
                    >
                      Update
                    </button>
                  </div>
                </div>
              </div>

              {scanResult && (
                <div className="mt-4 p-3 bg-[#E8FAF0] text-[#16A05A] border border-[#c9f2dc] rounded-2xl text-xs flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{scanResult}</span>
                </div>
              )}
            </div>

            {/* Section 2: Storage & File Reception Path */}
            <div className="bg-white rounded-[28px] p-6 sm:p-7 shadow-titan border border-[#E8EBF3]">
              <div className="flex items-center gap-3.5 mb-5">
                <div className="w-12 h-12 rounded-full bg-[#E8FAF0] text-[#16A05A] flex items-center justify-center">
                  <HardDrive className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#151B2D]">Save Directory</h3>
                  <p className="text-xs text-[#788395]">Received files and folders are saved directly into this directory</p>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  value={savePath}
                  onChange={(e) => setSavePath(e.target.value)}
                  className="flex-1 px-4 py-3 bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl text-xs font-mono text-[#151B2D] outline-none focus:ring-2 focus:ring-[#5865E9]/20"
                />
                <button
                  onClick={handleSavePath}
                  className="px-5 py-3 bg-[#5865E9] hover:bg-[#4c57d8] text-white rounded-2xl text-xs font-semibold transition shrink-0 shadow-titan-sm"
                >
                  {savedPath ? <Check className="w-4 h-4" /> : 'Set Path'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#788395]">Presets:</span>
                <button 
                  onClick={() => setSavePath('C:\\Users\\Public\\Downloads\\TitanPlusShare')}
                  className="px-3 py-1.5 bg-[#F8F9FD] hover:bg-[#EEF1FF] text-[#788395] hover:text-[#5865E9] rounded-xl text-xs font-medium transition border border-[#E8EBF3]"
                >
                  Public Downloads
                </button>
                <button 
                  onClick={() => setSavePath('C:\\TitanPlusShare')}
                  className="px-3 py-1.5 bg-[#F8F9FD] hover:bg-[#EEF1FF] text-[#788395] hover:text-[#5865E9] rounded-xl text-xs font-medium transition border border-[#E8EBF3]"
                >
                  C:\ Root Folder
                </button>
              </div>
            </div>

            {/* Section 3: Paired Mobile Devices List */}
            <div className="bg-white rounded-[28px] p-6 sm:p-7 shadow-titan border border-[#E8EBF3]">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full bg-[#F4EFFF] text-[#8755E8] flex items-center justify-center">
                    <Smartphone className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#151B2D]">Paired Devices</h3>
                    <p className="text-xs text-[#788395]">Authorized phones and laptops for instant direct sharing</p>
                  </div>
                </div>
                <span className="text-xs font-bold px-3 py-1 bg-[#EEF1FF] text-[#5865E9] rounded-full">
                  {pairedDevices.length} Connected
                </span>
              </div>

              {pairedDevices.length === 0 ? (
                <div className="p-8 text-center bg-[#F8F9FD] rounded-2xl border border-dashed border-[#E8EBF3]">
                  <Smartphone className="w-8 h-8 text-[#788395] mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-semibold text-[#151B2D]">No devices paired yet</p>
                  <p className="text-xs text-[#788395] mt-1">Scan the QR code on the right with Titan Plus Share on your phone</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pairedDevices.map((d) => (
                    <div key={d.deviceId} className="flex items-center justify-between p-4 bg-[#F8F9FD] rounded-2xl border border-[#E8EBF3] hover:border-[#5865E9]/30 transition">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-full bg-white text-[#5865E9] flex items-center justify-center shadow-titan-sm">
                          {d.deviceType === 'laptop' ? <Laptop className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="font-bold text-[#151B2D] text-sm">{d.deviceName}</div>
                          <div className="text-xs text-[#16A05A] font-medium flex items-center gap-1.5 mt-0.5">
                            <span className="w-2 h-2 rounded-full bg-[#16A05A] animate-pulse" />
                            <span>Paired • {d.ip || 'LAN Active'}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveDevice(d.deviceId)}
                        className="p-2.5 text-[#788395] hover:text-[#F16B72] hover:bg-[#FFF0F2] rounded-xl transition"
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

          {/* RIGHT COLUMN: 4 COLS */}
          <div className="lg:col-span-4 space-y-6">

            {/* Laptop Pairing QR Card */}
            <div className="bg-white rounded-[28px] p-6 sm:p-7 shadow-titan border border-[#E8EBF3] text-center">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-[#788395]">Fast Pairing</span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#E8FAF0] text-[#16A05A] text-xs font-bold rounded-full">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Secure LAN</span>
                </span>
              </div>

              <div className="p-4 bg-[#F8F9FD] rounded-2xl border border-[#E8EBF3] inline-block mb-4">
                {pairingData?.qrCode ? (
                  <img
                    src={pairingData.qrCode}
                    alt="Pairing QR Code"
                    className="w-52 h-52 mx-auto rounded-xl shadow-sm bg-white p-2 object-contain"
                  />
                ) : (
                  <div className="w-52 h-52 flex flex-col items-center justify-center text-xs text-[#788395]">
                    <RefreshCw className="w-6 h-6 text-[#5865E9] animate-spin mb-2" />
                    <span>Loading QR...</span>
                  </div>
                )}
              </div>

              <h4 className="font-bold text-[#151B2D] text-sm mb-1">Scan with Titan Plus Phone App</h4>
              <p className="text-xs text-[#788395] leading-relaxed mb-4">
                Open Settings &gt; Scan QR on your mobile app to instantly link this laptop.
              </p>

              <div className="p-3.5 bg-[#F8F9FD] rounded-2xl border border-[#E8EBF3] text-left text-xs text-[#788395] space-y-2">
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#EEF1FF] text-[#5865E9] font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                  <span>Connect both Laptop & Phone to same Wi-Fi or Mobile Hotspot</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#EEF1FF] text-[#5865E9] font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                  <span>Open Titan Plus Share on your Android phone</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#EEF1FF] text-[#5865E9] font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                  <span>Tap "Pair Device" and point camera at this QR code</span>
                </div>
              </div>
            </div>

            {/* About Card */}
            <div className="bg-white rounded-[28px] p-6 sm:p-7 shadow-titan border border-[#E8EBF3]">
              <div className="flex items-center gap-3.5 mb-5">
                <img src="/logo.png" alt="Titan Plus Share" className="w-12 h-12 rounded-2xl object-cover shadow-titan-sm" />
                <div>
                  <h4 className="font-extrabold text-[#151B2D] text-base leading-tight">Titan Plus Share</h4>
                  <p className="text-xs text-[#788395]">Fast • Simple • Anywhere</p>
                  <span className="inline-block mt-1 text-[10px] font-bold px-2.5 py-0.5 bg-[#E8FAF0] text-[#16A05A] rounded-full">
                    Version 1.0.0
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E8EBF3] space-y-2.5 text-xs text-[#788395]">
                <div className="flex items-center justify-between">
                  <span>Architecture</span>
                  <span className="font-semibold text-[#151B2D]">Local Node Engine + React</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Security</span>
                  <span className="font-semibold text-[#16A05A]">Zero Cloud • Direct LAN</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Status</span>
                  <span className="font-semibold text-[#5865E9]">All Services Operational</span>
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
    <div className="w-full max-w-xl mx-auto px-2 sm:px-4 py-3 sm:py-6 space-y-4 animate-fadeIn overflow-x-hidden pb-28">
      
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
        <h2 className="text-lg sm:text-xl font-bold text-[#151B2D]">Settings</h2>
        <p className="text-[11px] sm:text-xs text-[#788395]">Configure pairing, save location, and preferences</p>
      </div>

      {/* Device Profile Card */}
      <div className="bg-white rounded-[26px] p-5 shadow-titan border border-[#E8EBF3]">
        <h3 className="text-sm font-bold text-[#151B2D] mb-3">Device Identity</h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDevName(e.target.value)}
            className="flex-1 min-w-0 px-4 py-3 bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl text-xs sm:text-sm font-semibold text-[#151B2D] outline-none focus:ring-2 focus:ring-[#5865E9]/20 focus:border-[#5865E9]"
          />
          <button
            onClick={handleSaveDeviceName}
            className="px-5 py-3 bg-[#5865E9] hover:bg-[#4c57d8] text-white rounded-2xl text-xs font-semibold transition shrink-0 shadow-titan-sm"
          >
            {savedName ? <Check className="w-4 h-4" /> : 'Save'}
          </button>
        </div>
      </div>

      {/* Host Laptop Server Connection Card */}
      <div className="bg-white rounded-[26px] p-5 shadow-titan border border-[#E8EBF3]">
        <div className="flex items-center justify-between mb-3.5 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#EEF1FF] text-[#5865E9] flex items-center justify-center shrink-0">
              <Server className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-[#151B2D] truncate">Host Laptop Server</h3>
              <p className="text-[10px] sm:text-[11px] text-[#788395] truncate">Direct LAN / Hotspot IP of host laptop</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] sm:text-[11px] font-bold shrink-0 ${
            hostConnected ? 'bg-[#E8FAF0] text-[#16A05A] border border-[#c9f2dc]' : 'bg-amber-50 text-amber-600 border border-amber-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${hostConnected ? 'bg-[#16A05A]' : 'bg-amber-500 animate-pulse'}`} />
            {hostConnected ? 'Connected' : 'Offline'}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3">
          <input
            type="text"
            value={hostUrl}
            onChange={(e) => setHostUrl(e.target.value)}
            placeholder="http://10.89.213.60:51733"
            className="flex-1 min-w-0 px-4 py-3 bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl text-xs font-mono text-[#151B2D] outline-none focus:ring-2 focus:ring-[#5865E9]/20 focus:border-[#5865E9]"
          />
          <button
            onClick={handleSaveHostUrl}
            className="px-5 py-3 bg-[#5865E9] hover:bg-[#4c57d8] text-white rounded-2xl text-xs font-semibold transition shrink-0 flex items-center justify-center shadow-titan-sm"
          >
            Connect
          </button>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[#E8EBF3] text-[11px]">
          <span className="text-[#788395]">Default Port: 51733</span>
          <button
            onClick={handleAutoDiscover}
            disabled={discovering}
            className="text-[#5865E9] hover:underline font-semibold flex items-center gap-1 transition"
          >
            <RefreshCw className={`w-3 h-3 ${discovering ? 'animate-spin' : ''}`} />
            <span>{discovering ? 'Detecting...' : 'Auto-Detect Laptop'}</span>
          </button>
        </div>
      </div>

      {/* Save Location Configuration (For Mobile) */}
      <div className="bg-white rounded-[26px] p-5 shadow-titan border border-[#E8EBF3]">
        <div className="flex items-center gap-2.5 mb-2 min-w-0">
          <div className="w-9 h-9 rounded-full bg-[#E8FAF0] text-[#16A05A] flex items-center justify-center shrink-0">
            <Folder className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-[#151B2D] truncate">Received Files Save Location</h3>
            <p className="text-[10px] sm:text-xs text-[#788395] truncate">Saved here automatically</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-3 mt-3">
          <input
            type="text"
            value={savePath}
            onChange={(e) => setSavePath(e.target.value)}
            placeholder="/storage/emulated/0/Download/TitanPlusShare"
            className="flex-1 min-w-0 px-4 py-3 bg-[#F8F9FD] border border-[#E8EBF3] rounded-2xl text-xs font-mono text-[#151B2D] outline-none focus:ring-2 focus:ring-[#5865E9]/20"
          />
          <button
            onClick={handleSavePath}
            className="px-5 py-3 bg-[#5865E9] hover:bg-[#4c57d8] text-white rounded-2xl text-xs font-semibold transition shrink-0 flex items-center justify-center shadow-titan-sm"
          >
            {savedPath ? <Check className="w-4 h-4" /> : 'Save Path'}
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[#788395]">Presets:</span>
          <button 
            onClick={() => setSavePath('/storage/emulated/0/Download/TitanPlusShare')}
            className="px-3 py-1.5 bg-[#F8F9FD] hover:bg-[#EEF1FF] text-[#788395] hover:text-[#5865E9] rounded-xl text-[10px] font-medium transition border border-[#E8EBF3]"
          >
            Downloads Folder
          </button>
        </div>
      </div>

      {/* One-Time QR Pairing Section (Mobile to Mobile & Mobile to Laptop) */}
      <div className="bg-white rounded-[26px] p-5 shadow-titan border border-[#E8EBF3]">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-[#151B2D]">Device Pairing (Mobile & Laptop)</h3>
            <p className="text-[10px] sm:text-xs text-[#788395]">Pair phone to phone or phone to laptop via QR</p>
          </div>
        </div>

        {/* Tab Toggle: Show QR vs Scan QR */}
        <div className="flex p-1.5 bg-[#F8F9FD] rounded-2xl mb-4 text-xs font-semibold border border-[#E8EBF3]">
          <button
            onClick={() => { setPairingTab('qr'); setScanning(false); }}
            className={`flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${
              pairingTab === 'qr'
                ? 'bg-white text-[#5865E9] shadow-titan-sm'
                : 'text-[#788395] hover:text-[#151B2D]'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>My Pairing QR</span>
          </button>
          <button
            onClick={() => setPairingTab('scan')}
            className={`flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition ${
              pairingTab === 'scan'
                ? 'bg-white text-[#5865E9] shadow-titan-sm'
                : 'text-[#788395] hover:text-[#151B2D]'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Scan Device QR</span>
          </button>
        </div>

        {/* TAB 1: Show My Pairing QR Code */}
        {pairingTab === 'qr' && (
          <div className="text-center py-2 animate-fadeIn">
            {mobileQr ? (
              <div className="p-4 bg-[#F8F9FD] rounded-2xl border border-[#E8EBF3] inline-block max-w-full">
                <img 
                  src={mobileQr} 
                  alt="Mobile Device Pairing QR" 
                  className="w-44 sm:w-48 h-44 sm:h-48 mx-auto rounded-xl shadow-sm bg-white p-2 object-contain" 
                />
                <div className="mt-3">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#EEF1FF] text-[#5865E9] text-xs font-bold rounded-full mb-1">
                    <Smartphone className="w-3 h-3" />
                    <span>{deviceName || 'Mobile Device'}</span>
                  </div>
                  <p className="text-[11px] text-[#788395] mt-1">
                    Show this QR on another Phone or Laptop to pair instantly
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-8 flex flex-col items-center justify-center">
                <RefreshCw className="w-6 h-6 text-[#5865E9] animate-spin mb-2" />
                <span className="text-xs text-[#788395]">Generating pairing QR...</span>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Scan QR Code */}
        {pairingTab === 'scan' && (
          <div className="space-y-3 animate-fadeIn">
            <div className="p-4 bg-[#F8F9FD] rounded-2xl border border-[#E8EBF3] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <h4 className="font-bold text-[#151B2D] text-xs sm:text-sm">Scan QR Code</h4>
                <p className="text-[11px] text-[#788395]">Scan QR from another phone or laptop</p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setScanning(!scanning)}
                  className="px-4 py-2.5 bg-[#5865E9] hover:bg-[#4c57d8] text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-titan-sm"
                >
                  <Camera className="w-4 h-4" />
                  <span>{scanning ? 'Close' : 'Camera'}</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 bg-white hover:bg-[#F8F9FD] text-[#151B2D] border border-[#E8EBF3] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-titan-sm"
                >
                  <Image className="w-4 h-4 text-[#5865E9]" />
                  <span>Photo</span>
                </button>
              </div>
            </div>

            {scanning && (
              <div className="p-4 bg-white rounded-2xl border border-[#5865E9]/40 overflow-hidden text-center shadow-titan">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#151B2D] flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-[#5865E9] animate-pulse" />
                    <span>Scanning Pairing QR...</span>
                  </span>
                  <button onClick={() => setScanning(false)} className="text-[#788395] hover:text-[#151B2D] p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="relative overflow-hidden rounded-2xl bg-black aspect-square max-w-[260px] mx-auto shadow-inner">
                  <div id={settingsScannerDomId.current} className="w-full h-full min-h-[240px]"></div>
                  <div className="absolute inset-0 border-2 border-[#5865E9]/40 rounded-2xl pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-48 border border-white/40 rounded-xl relative">
                      <div className="absolute -top-0.5 -left-0.5 w-4 h-4 border-t-2 border-l-2 border-[#5865E9] rounded-tl"></div>
                      <div className="absolute -top-0.5 -right-0.5 w-4 h-4 border-t-2 border-r-2 border-[#5865E9] rounded-tr"></div>
                      <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 border-b-2 border-l-2 border-[#5865E9] rounded-bl"></div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 border-b-2 border-r-2 border-[#5865E9] rounded-br"></div>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-[#788395] text-center mt-2">Point camera directly at the other phone or laptop QR</p>
              </div>
            )}

            {scanResult && (
              <div className="p-3.5 bg-[#E8FAF0] text-[#16A05A] text-xs font-medium rounded-2xl border border-[#c9f2dc] flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{scanResult}</span>
              </div>
            )}
          </div>
        )}

        {/* Paired Devices List */}
        <div className="mt-5 pt-4 border-t border-[#E8EBF3]">
          <h4 className="text-xs font-bold text-[#151B2D] mb-3">Paired Devices ({pairedDevices.length})</h4>
          {pairedDevices.length === 0 ? (
            <p className="text-xs text-[#788395] py-2">No devices paired yet. Scan the QR code to pair.</p>
          ) : (
            <div className="space-y-2">
              {pairedDevices.map((d) => (
                <div key={d.deviceId} className="flex items-center justify-between p-3.5 bg-[#F8F9FD] rounded-2xl border border-[#E8EBF3]">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-white text-[#5865E9] flex items-center justify-center shadow-titan-sm">
                      {d.deviceType === 'laptop' ? <Laptop className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="font-bold text-[#151B2D] text-xs">{d.deviceName}</div>
                      <div className="text-[10px] text-[#16A05A] font-medium flex items-center gap-1 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#16A05A] animate-pulse" />
                        <span>Paired • {d.ip || 'LAN'}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveDevice(d.deviceId)}
                    className="p-2 text-[#788395] hover:text-[#F16B72] hover:bg-[#FFF0F2] rounded-xl transition"
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
      <div className="bg-white rounded-[26px] p-5 shadow-titan border border-[#E8EBF3] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Titan Plus Share" className="w-11 h-11 rounded-2xl object-cover shadow-titan-sm" />
          <div>
            <h4 className="font-extrabold text-[#151B2D] text-xs sm:text-sm">Titan Plus Share</h4>
            <p className="text-[11px] text-[#788395]">Fast • Simple • Anywhere</p>
          </div>
        </div>
        <span className="text-xs font-bold px-3 py-1 bg-[#EEF1FF] text-[#5865E9] rounded-full">v1.0.0</span>
      </div>

    </div>
  );
}
