export class OfficeSyncPollingInactiveError extends Error {
  constructor(message = 'Office execution sync polling is not active') {
    super(message);
    this.name = 'OfficeSyncPollingInactiveError';
  }
}
