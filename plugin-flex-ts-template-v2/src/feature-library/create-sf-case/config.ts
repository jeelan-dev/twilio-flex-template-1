import { getFeatureFlags } from '../../utils/configuration';
import CreateSfCaseConfig from './types/ServiceConfiguration';

const {
  enabled = false,
  recordTypeId = '012i00000019r5uAAA',
} = (getFeatureFlags()?.features?.create_sf_case as CreateSfCaseConfig) || {};

export const isFeatureEnabled = () => {
  return enabled;
};

// Allow per-region RecordTypeId override via ui_attributes config
export const getRecordTypeId = (): string => {
  return recordTypeId;
};
