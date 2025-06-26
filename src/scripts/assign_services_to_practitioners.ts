import { connectDB } from '../config/database';
import mongoose from 'mongoose';
import { Practitioner } from '../models/practitioner.model';

const serviceMap = [
  { names: ["Sebastien Lomas", "Jainam Tolia", "Abdul-Ahad Umair", "Raji Nesarajah", "Makinder  Dhinsa", "Maria Savu", "Maria Yera"], services: [1] },
  { names: ["Annalea Staples", "Annalea. Staples.", "Lucy Wilcock", "Caroline Smith"], services: [2] },
  { names: ["Annalea Staples", "Annalea. Staples.", "Caroline Smith"], services: [3] }
];

function getServicesForName(name: string): number[] {
  let services: number[] = [];
  for (const map of serviceMap) {
    if (map.names.includes(name)) {
      services = Array.from(new Set([...services, ...map.services]));
    }
  }
  return services;
}

async function main() {
  const practitioners = await Practitioner.find({}).lean();
  for (const p of practitioners) {
    const services = getServicesForName(p.user?.first_name && p.user?.last_name ? `${p.user.first_name} ${p.user.last_name}` :  p.user?.first_name || '');
    if (services.length > 0) {
      await Practitioner.updateOne({ id: p.id }, { $set: { services } });
      console.log(`Updated ${p.id} (${p.user?.first_name}) with services: ${services}`);
    }
  }
  await mongoose.disconnect();
}

connectDB().then(() => {
  console.log('Connected to DB');
  main();
}); 