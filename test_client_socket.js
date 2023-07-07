const IO = require('socket.io-client');

const socket = IO('http://localhost:3000');

socket.on('connect', function(socket) {
    console.log('connected to server');
});

socket.on('presence', function(msg) {
    console.log(msg);
});     