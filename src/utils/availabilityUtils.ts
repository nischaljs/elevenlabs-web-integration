import axios from 'axios';
import { Practitioner } from '../models/practitioner.model';
import { getAvailabilityFromDentally } from './dentally';
import logger from './logger';

// Fetch all active practitioners (Dentally, fallback to MongoDB)
export async function fetchActivePractitioners() {
  try {
    const dentallyApiKey = process.env.DENTALLY_API_KEY;
    const dentallyBaseUrl = process.env.DENTALLY_BASE_URL || 'https://api.dentally.co/v1';
    const siteId = process.env.DENTALLY_SITE_ID;
    logger.info('[fetchActivePractitioners] Fetching from Dentally...');
    const response = await axios.get(`${dentallyBaseUrl}/practitioners`, {
      headers: {
        'Authorization': `Bearer ${dentallyApiKey}`,
        'User-Agent': 'MyApp/1.0',
      },
      params: { site_id: siteId }
    });
    let practitionersRaw = response.data.practitioners || [];
    logger.info('[fetchActivePractitioners] Practitioners from Dentally:', practitionersRaw.length);
    practitionersRaw = practitionersRaw.filter((doc: any) => doc.active === true);
    if (practitionersRaw.length > 0) {
      logger.info('[fetchActivePractitioners] Active practitioners from Dentally:', practitionersRaw.length);
      return practitionersRaw;
    }
    // Fallback to MongoDB
    logger.info('[fetchActivePractitioners] No active practitioners from Dentally, falling back to MongoDB...');
    const dbPractitioners = await Practitioner.find({ active: true }).lean();
    logger.info('[fetchActivePractitioners] Active practitioners from DB:', dbPractitioners.length);
    return dbPractitioners;
  } catch (error) {
    logger.error('[fetchActivePractitioners] Error:', error);
    // Fallback to MongoDB
    const dbPractitioners = await Practitioner.find({ active: true }).lean();
    logger.info('[fetchActivePractitioners] Active practitioners from DB (after error):', dbPractitioners.length);
    return dbPractitioners;
  }
}

// Shuffle practitioners
export function shufflePractitioners(practitioners: any[]) {
  logger.info('[shufflePractitioners] Shuffling practitioners...');
  for (let i = practitioners.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [practitioners[i], practitioners[j]] = [practitioners[j], practitioners[i]];
  }
  return practitioners;
}

// Batch check availability
export async function batchCheckAvailability(practitionerIds: number[], start: string, finish: string, duration: number) {
  logger.info('[batchCheckAvailability] Checking availability for practitioners:', practitionerIds);
  const availabilityData = await getAvailabilityFromDentally(practitionerIds, start, finish, duration);
  logger.info('[batchCheckAvailability] Availability data:', JSON.stringify(availabilityData));
  return (availabilityData as any).availability || [];
}

// Find first available practitioner and recommend closest slot
export function findFirstAvailableOrRecommend(slots: any[], practitioners: any[], requestedStart: string) {
  logger.info('[findFirstAvailableOrRecommend] Finding first available or closest slot...');
  const availablePractitionerIds = new Set(slots.map((slot: any) => slot.practitioner_id));
  const firstAvailable = practitioners.find((doc: any) => availablePractitionerIds.has(doc.id));
  if (firstAvailable) {
    const slotsForPractitioner = slots
      .filter((slot: any) => slot.practitioner_id === firstAvailable.id)
      .map((slot: any) => ({ start_time: slot.start_time, finish_time: slot.finish_time }));
    logger.info('[findFirstAvailableOrRecommend] First available practitioner:', firstAvailable.id);
    return {
      practitioner_id: firstAvailable.id,
      practitioner_name: `${firstAvailable.user?.first_name || ''} ${firstAvailable.user?.last_name || ''}`.trim(),
      available_slots: slotsForPractitioner,
      recommended_slot: null
    };
  }
  // Recommend closest slot
  let requestedTime = new Date(requestedStart).getTime();
  let closestSlot = null;
  let minDiff = Infinity;
  for (const slot of slots) {
    const slotStart = new Date(slot.start_time).getTime();
    const diff = Math.abs(slotStart - requestedTime);
    if (diff < minDiff) {
      minDiff = diff;
      closestSlot = slot;
    }
  }
  if (closestSlot) {
    const practitioner = practitioners.find((doc: any) => doc.id === closestSlot.practitioner_id);
    logger.info('[findFirstAvailableOrRecommend] Closest slot found:', closestSlot.start_time);
    return {
      practitioner_id: null,
      practitioner_name: null,
      available_slots: [],
      recommended_slot: {
        practitioner_id: closestSlot.practitioner_id,
        practitioner_name: `${practitioner?.user?.first_name || ''} ${practitioner?.user?.last_name || ''}`.trim(),
        start_time: closestSlot.start_time,
        finish_time: closestSlot.finish_time
      }
    };
  }
  logger.info('[findFirstAvailableOrRecommend] No slots found.');
  return {
    practitioner_id: null,
    practitioner_name: null,
    available_slots: [],
    recommended_slot: null
  };
} 