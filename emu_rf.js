// Emulator for RFID TCP Hardware in Node.js

const net = require('net');

// Create a server that emulates RFID hardware
const server = net.createServer((socket) => {
  console.log('RFID Hardware Emulator connected');

  // Simulate RFID tag data transmission
  setInterval(() => {
    const randomRFIDTag = generateRandomRFIDTag();
    socket.write(randomRFIDTag);
  }, 1000); // Emulate data transmission every second

  // Handle client disconnect
  socket.on('end', () => {
    console.log('RFID Hardware Emulator disconnected');
  });
});

// Generate a random RFID tag for simulation
function generateRandomRFIDTag() {
  const characters = '0123456789ABCDEF';
  let tag = '';
  for (let i = 0; i < 8; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    tag += characters[randomIndex];
  }
  return `RFID Tag: ${tag}\n`;
}

// Listen on a specific port
const port = 4001;
server.listen(port, () => {
  console.log(`RFID Hardware Emulator listening on port ${port}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('RFID Hardware Emulator error:', err);
});
