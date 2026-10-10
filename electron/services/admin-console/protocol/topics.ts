export const AdminConsoleTopics = {
  command: (machineId: string) => `device:${machineId}`,
  broadcast: 'broadcast:all',
  response: (machineId: string) => `client:response:${machineId}`,
} as const;

export type AdminConsoleTopicKey = keyof typeof AdminConsoleTopics;
