import Stripe from 'stripe';
import axios from 'axios';
import logger from './logger';

const STRIPE_API_KEY = process.env.STRIPE_API_KEY || '';
const STRIPE_PRODUCT_ID = process.env.STRIPE_PRODUCT_ID || '';
const CLICKSEND_USERNAME = process.env.CLICKSEND_USERNAME || '';
const CLICKSEND_API_KEY = process.env.CLICKSEND_API_KEY || '';
const CLICKSEND_FROM = process.env.CLICKSEND_FROM || '';

const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2025-05-28.basil' });

export async function createStripePaymentLink(euroAmount: number): Promise<string | null> {
  try {
    logger.info(`[Stripe] Creating price for amount: €${euroAmount}`);
    const price = await stripe.prices.create({
      product: STRIPE_PRODUCT_ID,
      unit_amount: Math.round(euroAmount * 100), // euros to cents
      currency: 'eur',
    });
    logger.info(`[Stripe] Created price: ${price.id}`);
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
    });
    logger.info(`[Stripe] Created payment link: ${paymentLink.url}`);
    return paymentLink.url;
  } catch (error: any) {
    logger.error(`[Stripe] Error creating payment link: ${error.message}`);
    return null;
  }
}

export async function sendPaymentSms(to: string, patientName: string, paymentUrl: string): Promise<boolean> {
  const message = `Hi ${patientName}, thank you for booking your appointment. Kindly pay on the link below to confirm your appointment: ${paymentUrl}`;
  logger.info(`[ClickSend] Sending SMS to ${to}: ${message}`);
  const payload = {
    messages: [
      {
        from: CLICKSEND_FROM,
        body: message,
        to,
        shorten_urls: true,
      },
    ],
  };
  try {
    const response = await axios.post(
      'https://rest.clicksend.com/v3/sms/send',
      payload,
      {
        auth: {
          username: CLICKSEND_USERNAME,
          password: CLICKSEND_API_KEY,
        },
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );
    if (response.status === 200) {
      logger.info(`[ClickSend] SMS sent successfully to ${to}`);
      return true;
    } else {
      logger.error(`[ClickSend] Failed to send SMS. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error: any) {
    logger.error(`[ClickSend] Error sending SMS: ${error.message}`);
    return false;
  }
}

export async function handlePaymentAndSms({
  euroAmount,
  patientPhone,
  patientName,
}: {
  euroAmount: number;
  patientPhone: string;
  patientName: string;
}): Promise<{ paymentUrl: string | null; smsSent: boolean }> {
  logger.info(`[PaymentFlow] Starting payment link and SMS flow for ${patientName}, phone: ${patientPhone}, amount: €${euroAmount}`);
  const paymentUrl = await createStripePaymentLink(euroAmount);
  if (!paymentUrl) {
    logger.error(`[PaymentFlow] Failed to create payment link for ${patientName}`);
    return { paymentUrl: null, smsSent: false };
  }
  const smsSent = await sendPaymentSms(patientPhone, patientName, paymentUrl);
  return { paymentUrl, smsSent };
} 