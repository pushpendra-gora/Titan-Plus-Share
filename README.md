# Titan Plus Share ✈️
> **Fast • Simple • Anywhere** | Premium Cross-Platform File Sharing Ecosystem

Titan Plus Share is a modern cross-platform file transfer system designed for seamless sharing between **Windows Laptops/PCs** and **Android Mobile Phones**. It supports high-speed local LAN transfers (zero internet), 3-hour self-expiring remote download links, multi-file bundling with auto-unbundling directly to Gallery/Downloads, and Windows Explorer right-click integration.

---

## 🚀 Quick Start Guide (Har Laptop Par Chalane Ka Tarika)

Jab bhi koi is project ko GitHub se apne laptop me download kare, toh **usi laptop ko automatically server banane** ke liye niche diye gaye steps follow karein:

### 📋 Prerequisites (Zaroorat)
- **Windows 10 ya Windows 11 (64-bit)**
- **Node.js (LTS Version 18 ya higher)**: Agar aapke laptop me Node.js nahi hai, toh [nodejs.org](https://nodejs.org/) se download karke install karein (Next, Next, Finish).

---

### 💻 Step-by-Step Setup & Running

#### 🔹 Option 1: 1-Click `start.bat` (Sabse Aasan aur Recommended)
1. GitHub se repository download ya clone karein:
   ```bash
   git clone https://github.com/pushpendra-gora/Titan-Plus-Share.git
   ```
   *(Ya fir GitHub page par **Code -> Download ZIP** par click karke extract karein)*.
2. Folder open karein aur **`start.bat`** par double-click karein!
   - Yeh script automatically check karega ki Node.js installed hai ya nahi.
   - First-time run par yeh **automatically server dependencies install** kar dega.
   - Pre-built frontend UI ke sath **Host Server start** kar dega.
   - Edge/Chrome standalone application window me Titan Plus Share open ho jayega (`http://localhost:51733`).

#### 🔹 Option 2: Standalone Windows App (`Titan-Plus-Share.exe`)
- Folder me **`Titan-Plus-Share.exe`** par double-click karein.
- Yeh executable automatically laptop me background server launch karta hai aur modern desktop window open kar deta hai. Kisi command prompt ki zaroorat nahi padti!

#### 🔹 Option 3: Terminal / Command Prompt se Chalana
Agar aap developer hain aur terminal se chalana chahte hain:
```bash
# 1. Project folder me jayein
cd "Titan Plus Share"

# 2. Dependencies install karein (First time only)
npm install

# 3. Server start karein
npm start
```
Browser me `http://localhost:51733` open ho jayega.

---

## 🌐 Har Laptop Ka Apna Independent Server (Sabhi Ke Liye Alag-Alag)

Titan Plus Share har laptop par ek **independent, isolated host server** ki tarah kaam karta hai:

1. **Automatic Local IP Detection:**
   - Har laptop apne Wi-Fi / Hotspot adapter ki active IP address (`192.168.x.x` ya `10.x.x.x`) dynamically detect karta hai.
2. **Individual Device Identity:**
   - Har laptop ka apna unique device name (`os.hostname()`) aur unique device ID hota hai.
   - Ek laptop dusre laptop ke session ya data ko overwrite nahi karta.
3. **Dedicated Received Files Folder:**
   - Har laptop par aane wali files us user ke personal downloads directory me safe rahti hain:
     `C:\Users\<YourUsername>\Downloads\TitanPlusShare\`
4. **Mobile Hotspot Direct Mode:**
   - Laptop se Mobile Hotspot connect karein ya phone se Laptop Hotspot connect karein, bina kisi external router ya internet ke 40–100 MB/s speed par transfer hota hai.

---

## 📱 Mobile App (Android Phone Setup)

1. Root folder me se **`Titan-Plus-Share.apk`** apne Android phone me copy karke install karein.
2. Phone aur Laptop ko **Same Wi-Fi ya Mobile Hotspot** se connect karein.
3. **Connect / Pair Kaise Karein:**
   - Laptop screen par **Settings** me jayein jahan **Pairing QR Code** dikhega.
   - Phone me Titan Plus Share open karein aur **Scan QR** par tap karke laptop ka QR scan karein.
   - Phone aur Laptop instantly pair ho jayenge!
4. **Different Network / 5G Link Sharing:**
   - Agar phone aur laptop alag-alag network par hain, toh laptop se **"3-Hour Share Link"** banayein.
   - Phone app me **Links** tab me jaakar link paste karein aur **Validate -> Download** par click karein.

---

## 🖱️ Windows Explorer Right-Click Share Setup (Optional)

Kisi bhi file ya folder par right-click karke direct bhejne ke liye:
1. Folder me maujood **`Add-To-Windows-Context-Menu.bat`** par right-click karke **Run as administrator** (ya normal double click) karein.
2. Ab Windows Explorer me kisi bhi file ya folder par right-click karenge toh **"Share with Titan Plus Share"** ka option dikhai dega!

---

## 📦 Project Structure Overview

```text
Titan Plus Share/
├── Titan-Plus-Share.exe      # Windows Desktop Application Executable
├── Titan-Plus-Share.apk      # Android Mobile Application APK
├── start.bat                 # 1-Click Auto-Setup & Launch script for any PC
├── Launch-Titan-Plus-Share.bat # Alternate batch launcher
├── Add-To-Windows-Context-Menu.bat # Right-click context menu registrar
├── Install-Titan-Plus-Share.bat   # Full installer (shortcuts + firewall + context menu)
├── package.json              # Root npm config (npm install, npm start)
│
├── server/                   # Backend Server (Node.js, Express, WebSockets, Tunneling)
│   ├── server.js             # Main server logic, direct stream, pairing & link engine
│   └── package.json          # Server dependencies
│
├── frontend/                 # Frontend Web Application (React, Vite, Tailwind CSS)
│   ├── dist/                 # Pre-built production distribution (ready to run)
│   ├── src/                  # React source code (Titan Master Design System)
│   └── android/              # Android Capacitor native project
│
└── assets/                   # App icons, logos, and UI graphics
```

---

## 🛠️ Common Troubleshooting (Sawalat aur Samadhan)

### Q1: `start.bat` double-click karne par "Node.js is not recognized" error aaye toh?
- **Samadhan:** Aapke laptop me Node.js installed nahi hai. [nodejs.org](https://nodejs.org/) par jayein, **LTS** version download karke install karein, aur install hone ke baad terminal/laptop restart karke `start.bat` chalayein.

### Q2: Phone se laptop connect nahi ho raha (Same Wi-Fi)?
- **Samadhan:** Windows Firewall mobile connection block kar sakta hai. Folder me **`Install-Titan-Plus-Share.bat`** par right-click karke **Run as administrator** karein, yeh automatically port `51733` aur `41235` firewall rules add kar dega.

### Q3: Kya bina internet ke files transfer ho sakti hain?
- **Samadhan:** **Haan! 100% offline.** Dono devices ko same Wi-Fi ya phone ke hotspot se connect karein. Direct high-speed local stream se files share hongi without consuming any internet data.

---

## 📄 License
This project is open-source and free to use under the MIT License.
Developed with ❤️ by **Pushpendra Gora**.
