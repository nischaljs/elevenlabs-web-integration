import logger from './logger';
import { SERVICE_LIST } from '../models/service.model';

export interface ServiceInfo {
  name: string;
  id: number;
}

export interface PaymentCalculationResult {
  total: number;
  breakdown: string;
  discount: number;
  drSeb: boolean;
  details: any;
}

const DR_SEB_ID = 148774;
const DR_SEB_NAME = 'Sebastien Lomas';

function getServiceById(id: number) {
  return SERVICE_LIST.find(s => s.id === id);
}

function getServiceByName(name: string) {
  return SERVICE_LIST.find(s => s.name.toLowerCase() === name.trim().toLowerCase());
}

export function parseAppointmentReason(reason: string): ServiceInfo[] {
  if (!reason) return [];
  return reason.split(',').map((entry) => {
    const [name, id] = entry.split('-');
    let serviceId = Number(id);
    let serviceName = name.trim();
    // If id is not a number, try to get from name
    if (isNaN(serviceId)) {
      const found = getServiceByName(serviceName);
      if (found) serviceId = found.id;
    }
    // If name is not in SERVICE_LIST, try to get from id
    if (!getServiceByName(serviceName) && !isNaN(serviceId)) {
      const found = getServiceById(serviceId);
      if (found) serviceName = found.name;
    }
    return { name: serviceName, id: serviceId };
  });
}

export function isDrSeb(practitionerId: number, practitionerName?: string): boolean {
  return (
    practitionerId === DR_SEB_ID ||
    String(practitionerName || '').trim().toLowerCase() === DR_SEB_NAME.toLowerCase()
  );
}

export function calculateTotalPayment({
  services,
  practitionerId,
  practitionerName
}: {
  services: ServiceInfo[];
  practitionerId: number;
  practitionerName?: string;
}): PaymentCalculationResult {
  let total = 0;
  let breakdown = '';
  let discount = 0;
  let drSeb = isDrSeb(practitionerId, practitionerName);
  let details: any = {};

  const hasBio = services.some(s => s.id === 1 || s.name.toLowerCase().includes('biological'));
  const hasHygiene = services.some(s => s.id === 2 || s.name.toLowerCase().includes('hygiene'));
  const hasDirectAccess = services.some(s => s.id === 3 || s.name.toLowerCase().includes('direct access'));

  if (hasDirectAccess) {
    total = 192.5;
    breakdown = `${getServiceById(3)?.name || 'Holistic Hygiene Direct Access'}: €192.50`;
    details = { direct_access: 192.5 };
    logger.info(`[Payment] Holistic Hygiene Direct Access booked. Total: €192.50`);
    return { total, breakdown, discount, drSeb, details };
  }

  if (hasBio && hasHygiene) {
    const bioPrice = drSeb ? 299 : 269;
    const hygienePrice = 176;
    total = bioPrice + hygienePrice;
    discount = 50;
    total -= discount;
    breakdown = `${getServiceById(1)?.name || 'Biological New Consultation'}: €${bioPrice} + ${getServiceById(2)?.name || 'Holistic Hygiene'}: €${hygienePrice} - Discount: €${discount}`;
    details = { bio: bioPrice, hygiene: hygienePrice, discount };
    logger.info(`[Payment] Both Biological New Consultation and Holistic Hygiene booked. Bio: €${bioPrice}, Hygiene: €${hygienePrice}, Discount: €${discount}, Total: €${total}`);
    return { total, breakdown, discount, drSeb, details };
  }

  if (hasBio) {
    const bioPrice = drSeb ? 299 : 269;
    total = bioPrice;
    breakdown = `${getServiceById(1)?.name || 'Biological New Consultation'}: €${bioPrice}`;
    details = { bio: bioPrice };
    logger.info(`[Payment] Biological New Consultation booked. Practitioner: ${drSeb ? 'Dr. Seb' : 'Other'}, Price: €${bioPrice}`);
    return { total, breakdown, discount, drSeb, details };
  }

  if (hasHygiene) {
    // Hygiene cannot be booked alone
    logger.info(`[Payment] Holistic Hygiene attempted to book alone. Not allowed.`);
    breakdown = `${getServiceById(2)?.name || 'Holistic Hygiene'} cannot be booked without ${getServiceById(1)?.name || 'Biological New Consultation'}.`;
    return { total: 0, breakdown, discount: 0, drSeb, details: {} };
  }

  logger.info(`[Payment] Unknown or unsupported service combination: ${JSON.stringify(services)}`);
  breakdown = 'Unknown or unsupported service combination.';
  return { total: 0, breakdown, discount: 0, drSeb, details: {} };
} 