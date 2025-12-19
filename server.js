const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'board-data.json');

// In-memory data store (for cloud hosting where file system may be ephemeral)
let inMemoryData = null;

// Initialize data
function initDataFile() {
    // Try to load from file first
    if (fs.existsSync(DATA_FILE)) {
        try {
            const fileData = fs.readFileSync(DATA_FILE, 'utf8');
            inMemoryData = JSON.parse(fileData);
            console.log('Loaded data from file');
            return;
        } catch (error) {
            console.error('Error loading from file:', error);
        }
    }
    
    // Initialize with empty data
    inMemoryData = {
        tasks: [],
        teamMembers: []
    };
    
    // Try to save initial file
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(inMemoryData, null, 2));
    } catch (error) {
        console.log('File system not writable, using in-memory storage only');
    }
}

// Read data (from memory, with file fallback)
function readData() {
    if (inMemoryData) {
        return inMemoryData;
    }
    
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        inMemoryData = JSON.parse(data);
        return inMemoryData;
    } catch (error) {
        console.error('Error reading data:', error);
        inMemoryData = { tasks: [], teamMembers: [] };
        return inMemoryData;
    }
}

// Write data (to memory and file)
function writeData(data) {
    inMemoryData = data;
    
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        // File write failed, data is still in memory
        console.log('File write failed, data saved to memory');
    }
}

// Broadcast message to all connected clients
function broadcast(message, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Serve static files
app.use(express.static(__dirname));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'product-board.html'));
});

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    // Send current data to new client
    const data = readData();
    ws.send(JSON.stringify({
        type: 'INIT',
        payload: data
    }));

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            const data = readData();
            
            switch (msg.type) {
                case 'ADD_TASK':
                    data.tasks.push(msg.payload);
                    writeData(data);
                    broadcast({ type: 'TASK_ADDED', payload: msg.payload });
                    ws.send(JSON.stringify({ type: 'TASK_ADDED', payload: msg.payload }));
                    break;

                case 'UPDATE_TASK':
                    const taskIndex = data.tasks.findIndex(t => t.id === msg.payload.id);
                    if (taskIndex !== -1) {
                        data.tasks[taskIndex] = msg.payload;
                        writeData(data);
                        broadcast({ type: 'TASK_UPDATED', payload: msg.payload });
                        ws.send(JSON.stringify({ type: 'TASK_UPDATED', payload: msg.payload }));
                    }
                    break;

                case 'DELETE_TASK':
                    data.tasks = data.tasks.filter(t => t.id !== msg.payload.id);
                    writeData(data);
                    broadcast({ type: 'TASK_DELETED', payload: msg.payload });
                    ws.send(JSON.stringify({ type: 'TASK_DELETED', payload: msg.payload }));
                    break;

                case 'MOVE_TASK':
                    const moveIndex = data.tasks.findIndex(t => t.id === msg.payload.id);
                    if (moveIndex !== -1) {
                        data.tasks[moveIndex].status = msg.payload.status;
                        writeData(data);
                        broadcast({ type: 'TASK_MOVED', payload: msg.payload });
                        ws.send(JSON.stringify({ type: 'TASK_MOVED', payload: msg.payload }));
                    }
                    break;

                case 'ADD_COMMENT':
                    const commentTaskIndex = data.tasks.findIndex(t => t.id === msg.payload.taskId);
                    if (commentTaskIndex !== -1) {
                        data.tasks[commentTaskIndex].comments.push(msg.payload.comment);
                        writeData(data);
                        broadcast({ type: 'COMMENT_ADDED', payload: msg.payload });
                        ws.send(JSON.stringify({ type: 'COMMENT_ADDED', payload: msg.payload }));
                    }
                    break;

                case 'UPDATE_TEAM_MEMBER':
                    const memberIndex = data.teamMembers.findIndex(m => m.name === msg.payload.name);
                    if (memberIndex === -1) {
                        data.teamMembers.push(msg.payload);
                    } else {
                        data.teamMembers[memberIndex] = msg.payload;
                    }
                    writeData(data);
                    broadcast({ type: 'TEAM_UPDATED', payload: data.teamMembers });
                    ws.send(JSON.stringify({ type: 'TEAM_UPDATED', payload: data.teamMembers }));
                    break;

                case 'USER_ACTIVITY':
                    // Broadcast user activity (e.g., who's online, who's typing)
                    broadcast({ type: 'USER_ACTIVITY', payload: msg.payload }, ws);
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Initialize and start server
initDataFile();
server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Product Team Board Server Running!                    ║
║                                                            ║
║   Local:   http://localhost:${PORT}                          ║
║                                                            ║
║   Share this URL with your team to collaborate!            ║
║                                                            ║
║   For network access, use your computer's IP address:      ║
║   http://<your-ip>:${PORT}                                   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});

