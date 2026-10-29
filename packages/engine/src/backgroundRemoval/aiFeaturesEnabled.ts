/**
 * Read the user-facing AI master switch from editor settings.
 * Engine callers cannot import @varve/editor; the persisted key is the contract.
 */
export { getAiFeaturesEnabled } from '../inference/aiFeaturesGate';
