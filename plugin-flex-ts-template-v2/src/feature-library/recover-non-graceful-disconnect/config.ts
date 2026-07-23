import { getFeatureFlags } from '../../utils/configuration';
import RecoverNonGracefulDisconnectConfig from './types/ServiceConfiguration';

const {
  enabled = false,
  serverless_domain = '',
  auto_answer_reconnect_tasks = true,
} = (getFeatureFlags()?.features?.recover_non_graceful_disconnect as RecoverNonGracefulDisconnectConfig) || {};

export const isFeatureEnabled = () => enabled;

export const getServerlessDomain = (): string => serverless_domain;

export const isAutoAnswerReconnectEnabled = (): boolean => auto_answer_reconnect_tasks;
