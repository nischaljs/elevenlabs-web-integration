"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyElevenLabsWebhook = exports.verifyDentallyToken = void 0;
// Verify Dentally API token
const verifyDentallyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Dentally API token is required'
        });
        return;
    }
    if (token !== process.env.DENTALLY_API_KEY) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid Dentally API token'
        });
        return;
    }
    next();
};
exports.verifyDentallyToken = verifyDentallyToken;
// Verify ElevenLabs webhook signature (currently disabled like in FastAPI)
const verifyElevenLabsWebhook = (req, res, next) => {
    // Currently disabled like in FastAPI
    next();
};
exports.verifyElevenLabsWebhook = verifyElevenLabsWebhook;
