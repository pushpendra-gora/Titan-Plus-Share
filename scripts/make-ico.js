const fs = require('fs');
const path = require('path');

// Basic ICO header and embedding PNG for Vista+ (Standard valid Windows ICO)
function pngToIco(pngPath, icoPath) {
  const pngBuffer = fs.readFileSync(pngPath);
  
  // ICO Header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // 1 = ICO
  header.writeUInt16LE(1, 4); // 1 image

  // Directory entry: 16 bytes
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // Width 256
  entry.writeUInt8(0, 1); // Height 256
  entry.writeUInt8(0, 2); // Colors
  entry.writeUInt8(0, 3); // Reserved
  entry.writeUInt16LE(1, 4); // Color planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // Image size in bytes
  entry.writeUInt32LE(22, 12); // Offset of image data (6 + 16 = 22)

  const icoBuffer = Buffer.concat([header, entry, pngBuffer]);
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('Generated ICO:', icoPath);
}

pngToIco(
  path.join(__dirname, '..', 'assets', 'logo.png'),
  path.join(__dirname, '..', 'assets', 'app.ico')
);

