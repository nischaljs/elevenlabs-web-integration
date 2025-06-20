import WebSocket from 'ws';
import { EventEmitter } from 'events';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const ELEVENLAB_WS_URL = process.env.ELEVENLABS_WS_URL || `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;

// WebSocket connection registry per conversation
interface Connection {
    ws: WebSocket | null;
    thread: NodeJS.Timeout;
    ready: EventEmitter;
    queue: EventEmitter;
    stop: EventEmitter;
}

const connections: { [key: string]: Connection } = {};

// Function to send data to a specific ElevenLabs conversation
export const sendToElevenlabs = async (conversationId: string, data: any): Promise<void> => {
    const conn = connections[conversationId];
    if (!conn || !conn.thread) {
        throw new Error(`WebSocket for conversation ${conversationId} is not running`);
    }

    await new Promise(resolve => conn.ready.once('ready', resolve));
    conn.queue.emit('data', data);
    logger.info(`[WebSocket] Sent data to ${conversationId}`);
};

// Handle received messages from ElevenLabs
const handleReceivedMessage = async (message: string, conversationId: string): Promise<void> => {
    logger.info(`[WebSocket] [${conversationId}] Received message`);
    try {
        const parsed = JSON.parse(message);
        logger.info(`[WebSocket] [${conversationId}] Parsed message:`, parsed);

        if (parsed.type === 'conversation_initiation_metadata') {
            const db = mongoose.connection.db;
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

            await sendToElevenlabs(conversationId, {
                conversation_id: conversationId,
                text: practitionerData,
            });
        }
    } catch (error) {
        logger.error(`[WebSocket] [${conversationId}] Error handling message:`, error);
    }
};

// WebSocket connection handler for a single conversation
export const startWebSocketConnection = (conversationId: string): void => {
    if (connections[conversationId]) {
        logger.info(`[WebSocket] [${conversationId}] WebSocket already running`);
        return;
    }

    const conn: Connection = {
        ws: null,
        thread: setTimeout(() => {}, 0),
        ready: new EventEmitter(),
        queue: new EventEmitter(),
        stop: new EventEmitter()
    };

    connections[conversationId] = conn;

    const connect = async () => {
        try {
            const ws = new WebSocket(ELEVENLAB_WS_URL);
            conn.ws = ws;

            ws.on('open', () => {
                conn.ready.emit('ready');
                logger.info(`[WebSocket] [${conversationId}] Connected to ElevenLabs`);
            });

            ws.on('message', async (data: WebSocket.Data) => {
                await handleReceivedMessage(data.toString(), conversationId);
            });

            ws.on('error', (error) => {
                logger.error(`[WebSocket] [${conversationId}] WebSocket error:`, error);
            });

            ws.on('close', () => {
                logger.info(`[WebSocket] [${conversationId}] WebSocket closed`);
                conn.ready.removeAllListeners();
                if (!conn.stop.listenerCount('stop')) {
                    setTimeout(connect, 5000); // Reconnect after 5 seconds
                }
            });

            // Handle outgoing messages
            conn.queue.on('data', (data: any) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(data));
                    logger.info(`[WebSocket] [${conversationId}] Sent data`);
                }
            });

        } catch (error) {
            logger.error(`[WebSocket] [${conversationId}] Connection error:`, error);
            if (!conn.stop.listenerCount('stop')) {
                setTimeout(connect, 5000); // Reconnect after 5 seconds
            }
        }
    };

    connect();
};

// Stop WebSocket connection
export const stopWebSocketConnection = (conversationId: string): void => {
    const conn = connections[conversationId];
    if (conn) {
        conn.stop.emit('stop');
        if (conn.ws) {
            conn.ws.close();
        }
        clearTimeout(conn.thread);
        delete connections[conversationId];
        logger.info(`[WebSocket] [${conversationId}] WebSocket connection stopped`);
    }
}; 