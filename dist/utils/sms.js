"use strict";
// import Stripe from 'stripe';
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: '2022-11-15' });
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMS = void 0;
exports.createStripePaymentLink = createStripePaymentLink;
// import twilio from 'twilio';
// const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
function createStripePaymentLink(usdtAmount) {
    // Stripe integration is not implemented, just return a placeholder
    return 'https://example.com/payment-link';
}
const sendSMS = async (to, message) => {
    // Twilio integration is not implemented, just log the message
    console.log(`[Stub] Sending SMS to ${to}: ${message}`);
    return true;
};
exports.sendSMS = sendSMS;
