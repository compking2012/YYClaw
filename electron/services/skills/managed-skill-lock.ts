let managedSkillMutationQueue: Promise<void> = Promise.resolve();

/** Serialize every P1 mutation: installs, rollback, and winner quarantine. */
export async function withManagedSkillMutationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = managedSkillMutationQueue;
  let release!: () => void;
  managedSkillMutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
