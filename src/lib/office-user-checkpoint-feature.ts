/** Renderer/build-time gate for Legacy DAG userCheckpoint (see office.env). */
export function isOfficeUserCheckpointFeatureEnabled(): boolean {
  return typeof __OFFICE_USER_CHECKPOINT__ !== 'undefined' && __OFFICE_USER_CHECKPOINT__ === true;
}
