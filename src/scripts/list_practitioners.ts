
import mongoose from 'mongoose';
import { Practitioner } from '../models/practitioner.model';
import {connectDB} from "../config/database"


async function main() {
  const practitioners = await Practitioner.find({}).lean();
  console.log(`Found ${practitioners.length} practitioners.`);
  console.log(JSON.stringify(practitioners, null, 2));
  await mongoose.disconnect();
}

connectDB().then(
    () => {
        console.log("connected to db");
    main();
    }
)