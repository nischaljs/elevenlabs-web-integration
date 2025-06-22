import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import logForDev from './logger';

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function openAiModel(data: string): Promise<any> {
  const prompt = `
You will be given a transcript DATA. Extract the following details and return only in JSON format, with no additional text, explanation, or newlines:

- patient_first_name
- patient_last_name
- patient_title (genrate based on patient_first_name and last_name  example  Mr/Mrs/Ms/, if not then use "Mr" as default )
- patient_dob
- patient_gender (The patient's gender, is male or female generate this based on the pateint_first_name and pateint_last_name, if not then use Male as default )
- patient_email
- patient_phone_number
- patient_ethnicity (if not then use '08' as default )
- patient_address_line_1 (if not then user " " as default )
- patient_postcode (if not then user " " as default )
- patient_payment_plan_id (if not then use 45783 as default )
- service_requested  
- appointment_date (convert any relative references like "tomorrow" into the actual calendar date in UK timezone (Europe/London))  
- appointment_time  
- doctor_name 
- booked_practitioner_id (extract from the full list of available practitioners, e.g., "Maria Savu (148753)" — if user says they want "Maria Savu", match the ID from the list)  
- appointment_reason (if not then use "no reason " as default )
- appointment_start_time (convert to ISO 8601 format)
- appointment_finish_time (convert to ISO 8601 format)
- appointment_patient_id (if patient is created in the system, else return null) 
- consultation_type (Based on the treatment type string, extract the consultation type e.g., "Biological Consultation","General Consultation","Hygiene Appointment" )
- patient_status (e.g., "New" or "Existing")

Ensure the output is a single-line, compressed JSON with no newlines or spaces between fields.
If any of the fields are not present in the transcript, return null for that field.

Transcript Data:
${data}`;

  try {
    if (process.env.NODE_ENV === 'development') {
      logForDev('Sending prompt:', { prompt });
    }
    const response = await client.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "user", content: prompt }
      ],
      temperature: 0
    });
    if (process.env.NODE_ENV === 'development') {
      logForDev('Raw response:', { response: JSON.stringify(response) });
    }
    const responseText = response.choices[0].message.content?.trim() || '';
    const cleanedText = responseText.replace("```json\n", "").replace("\n```", "");
    
    return JSON.parse(cleanedText);
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      logForDev('Request failed:', { error });
    }
    logForDev('OpenAI request failed:', { error });
    return null;
  }
} 