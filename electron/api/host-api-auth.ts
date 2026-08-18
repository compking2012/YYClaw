import { randomBytes } from 'node:crypto';

let hostApiToken = '';

export function generateHostApiToken(): string {
  hostApiToken = randomBytes(32).toString('hex');
  return hostApiToken;
}

export function getHostApiToken(): string {
  return hostApiToken;
}
