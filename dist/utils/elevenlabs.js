"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyElevenLabsWebhookSignature = void 0;
const verifyElevenLabsWebhookSignature = (body, signature) => {
    // if (!signature) {
    //     return false;
    // }
    // const ELEVENLABS_WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET;
    // if (!ELEVENLABS_WEBHOOK_SECRET) {
    //     console.error('ELEVENLABS_WEBHOOK_SECRET is not set');
    //     return false;
    // }
    // const hmac = crypto.createHmac('sha256', ELEVENLABS_WEBHOOK_SECRET);
    // const digest = hmac.update(JSON.stringify(body)).digest('hex');
    // return crypto.timingSafeEqual(
    //     Buffer.from(signature),
    //     Buffer.from(digest)
    // );
    return true;
};
exports.verifyElevenLabsWebhookSignature = verifyElevenLabsWebhookSignature;
