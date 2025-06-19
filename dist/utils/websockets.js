"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopWebSocketConnection = exports.startWebSocketConnection = exports.sendToElevenlabs = void 0;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ELEVENLAB_WS_URL = process.env.ELEVENLABS_WS_URL || `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
const connections = {};
// Function to send data to a specific ElevenLabs conversation
const sendToElevenlabs = async (conversationId, data) => {
    const conn = connections[conversationId];
    if (!conn || !conn.thread) {
        throw new Error(`WebSocket for conversation ${conversationId} is not running`);
    }
    await new Promise(resolve => conn.ready.once('ready', resolve));
    conn.queue.emit('data', data);
    console.log(`[WebSocket] Sent data to ${conversationId}`);
};
exports.sendToElevenlabs = sendToElevenlabs;
// Handle received messages from ElevenLabs
const handleReceivedMessage = async (message, conversationId) => {
    console.log(`[WebSocket] [${conversationId}] Received message`);
    try {
        const parsed = JSON.parse(message);
        console.log(`[WebSocket] [${conversationId}] Parsed message:`, parsed);
        if (parsed.type === 'conversation_initiation_metadata') {
            const db = mongoose_1.default.connection.db;
            if (!db) {
                throw new Error('Database connection not available');
            }
            const practitioners = await db.collection('practitioners')
                .find({ active: true })
                .limit(50)
                .toArray();
            const practitionerData = practitioners.map(doc => ({
                practitioner_id: doc.user?.id,
                practitioner_name: `${doc.user?.first_name || ''} ${doc.user?.last_name || ''}`.trim()
            }));
            await (0, exports.sendToElevenlabs)(conversationId, {
                conversation_id: conversationId,
                text: practitionerData,
            });
        }
    }
    catch (error) {
        console.error(`[WebSocket] [${conversationId}] Error handling message:`, error);
    }
};
// WebSocket connection handler for a single conversation
const startWebSocketConnection = (conversationId) => {
    if (connections[conversationId]) {
        console.log(`[WebSocket] [${conversationId}] WebSocket already running`);
        return;
    }
    const conn = {
        ws: null,
        thread: setTimeout(() => { }, 0),
        ready: new events_1.EventEmitter(),
        queue: new events_1.EventEmitter(),
        stop: new events_1.EventEmitter()
    };
    connections[conversationId] = conn;
    const connect = async () => {
        try {
            const ws = new ws_1.default(ELEVENLAB_WS_URL);
            conn.ws = ws;
            ws.on('open', () => {
                conn.ready.emit('ready');
                console.log(`[WebSocket] [${conversationId}] Connected to ElevenLabs`);
            });
            ws.on('message', async (data) => {
                await handleReceivedMessage(data.toString(), conversationId);
            });
            ws.on('error', (error) => {
                console.error(`[WebSocket] [${conversationId}] WebSocket error:`, error);
            });
            ws.on('close', () => {
                console.log(`[WebSocket] [${conversationId}] WebSocket closed`);
                conn.ready.removeAllListeners();
                if (!conn.stop.listenerCount('stop')) {
                    setTimeout(connect, 5000); // Reconnect after 5 seconds
                }
            });
            // Handle outgoing messages
            conn.queue.on('data', (data) => {
                if (ws.readyState === ws_1.default.OPEN) {
                    ws.send(JSON.stringify(data));
                    console.log(`[WebSocket] [${conversationId}] Sent data`);
                }
            });
        }
        catch (error) {
            console.error(`[WebSocket] [${conversationId}] Connection error:`, error);
            if (!conn.stop.listenerCount('stop')) {
                setTimeout(connect, 5000); // Reconnect after 5 seconds
            }
        }
    };
    connect();
};
exports.startWebSocketConnection = startWebSocketConnection;
// Stop WebSocket connection
const stopWebSocketConnection = (conversationId) => {
    const conn = connections[conversationId];
    if (conn) {
        conn.stop.emit('stop');
        if (conn.ws) {
            conn.ws.close();
        }
        clearTimeout(conn.thread);
        delete connections[conversationId];
        console.log(`[WebSocket] [${conversationId}] WebSocket connection stopped`);
    }
};
exports.stopWebSocketConnection = stopWebSocketConnection;
