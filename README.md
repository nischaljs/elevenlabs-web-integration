# Express Server Setup Guide

This is the Express.js implementation of the appointment booking system, functionally identical to the FastAPI version.

## Prerequisites

- Node.js (v18 or higher)
- pnpm (v8 or higher)
- MongoDB (v6 or higher)
- Environment variables (see `.env.example`)

## Installation

1. **Clone the repository and navigate to the server directory:**
   ```bash
   cd server
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` with your configuration values.

## Environment Variables

Create a `.env` file in the server directory with the following variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# MongoDB Configuration
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=your_database_name

# API Keys
DENTALLY_API_KEY=your_dentally_api_key
DENTALLY_BASE_URL=https://api.dentally.co/v1

# ElevenLabs Configuration
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id
ELEVENLABS_WEBHOOK_SECRET=your_elevenlabs_webhook_secret

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Stripe Configuration
STRIPE_SECRET_KEY=your_stripe_secret_key

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
```

## Database Setup

1. **Ensure MongoDB is running:**
   ```bash
   mongod --dbpath /path/to/data/directory
   ```

2. **The database will be automatically created when the server starts.**

## Running the Server

1. **Development mode:**
   ```bash
   pnpm dev
   ```

2. **Production mode:**
   ```bash
   pnpm build
   pnpm start
   ```

## API Endpoints

### ElevenLabs Routes

1. **GET /practitioners**
   - Returns list of active practitioners
   - Response: `{ text: string }`

2. **GET /check-available-time/{practitioner_id}/{start_time}/{finish_time}/{duration}**
   - Checks availability for a practitioner
   - Response: `{ available_slots: string, message: string }`

3. **POST /create-appointment**
   - Creates a new appointment
   - Requires: `x-elevenlabs-signature` header
   - Response: `{ received: boolean }`

### Dentally Routes

1. **GET /fetch-all-dentally-appointments/{date}**
   - Fetches appointments for a specific date
   - Date format: YYYY-MM-DD
   - Response: `{ message: string }`

2. **POST /upload-practitioners-excel-file/**
   - Uploads practitioner data from Excel
   - Requires: Excel file in request body
   - Response: `{ message: string, inserted_count: number }`

3. **POST /upload-practitioners-mapping-excel-file/**
   - Uploads treatment mapping data
   - Requires: Excel file in request body
   - Response: `{ message: string, inserted_count: number }`

4. **POST /sync/payment-plans**
   - Syncs payment plans from Dentally
   - Response: `{ message: string, stored_count: number }`

## Error Handling

All endpoints return errors in the following format:
```json
{
    "detail": "Error message"
}
```

## Testing

1. **Run tests:**
   ```bash
   pnpm test
   ```

2. **Run tests with coverage:**
   ```bash
   pnpm test:coverage
   ```

## Production Deployment

1. **Build the application:**
   ```bash
   pnpm build
   ```

2. **Start the server:**
   ```bash
   pnpm start
   ```

3. **Using PM2 (recommended for production):**
   ```bash
   pm2 start dist/index.js --name appointment-server
   ```

## Monitoring

- The server includes console logging for important operations
- All errors are logged with appropriate context
- API responses match the FastAPI implementation exactly
