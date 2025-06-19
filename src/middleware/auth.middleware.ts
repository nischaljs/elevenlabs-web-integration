import { Request, Response, NextFunction } from 'express';

// Verify Dentally API token
export const verifyDentallyToken = (req: Request, res: Response, next: NextFunction): void => {
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

// Verify ElevenLabs webhook signature (currently disabled like in FastAPI)
export const verifyElevenLabsWebhook = (req: Request, res: Response, next: NextFunction) => {
  // Currently disabled like in FastAPI
  next();
}; 