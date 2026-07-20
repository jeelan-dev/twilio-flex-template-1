import * as Flex from '@twilio/flex-ui';
import merge from 'lodash/merge';
import { UIAttributes } from 'types/manager/ServiceConfiguration';
import { CustomWorkerAttributes } from 'types/task-router/Worker';

const manager = Flex.Manager.getInstance();
const { custom_data: globalSettings } = manager.configuration as UIAttributes;

export const defaultLanguage = 'en-US';

export const getFeatureFlagsGlobal = () => {
  return globalSettings;
};

export const getFeatureFlagsUser = () => {
  const { config_overrides: workerSettings } =
    (manager.workerClient?.attributes as CustomWorkerAttributes) || {};
  return workerSettings;
};

const mergedSettings = merge(globalSettings, getFeatureFlagsUser());

// teamviewfilters-author-rohithm
export const getFeatureFlags = () => {
  let teams: string[] = [];
  let queuesStatsList: string[] = [];

  // Get all configured teams and queues
  const teamList = mergedSettings?.common?.teamList || {};
  const queuesList = mergedSettings?.common?.queuesList || {};

  // Ignore location and roles completely
  teams = Object.values(teamList).flat() as string[];
  queuesStatsList = Object.values(queuesList).flat() as string[];

  console.log('[Team View Filters] All Teams:', teams);
  console.log('[Team View Filters] All Queues:', queuesStatsList);

  // Update merged settings
  mergedSettings.common.teams = teams;
  mergedSettings.common.queuesStatsList = queuesStatsList;

  return mergedSettings;
};

export const getManagerLocation = () => {
  if (manager.workerClient?.attributes) {
    return manager.workerClient.attributes.location;
  }
};

export const getUserLanguage = () => {
  let { language } = getFeatureFlags();

  if (manager.workerClient) {
    const workerAttrs = manager.workerClient.attributes as CustomWorkerAttributes;

    if (workerAttrs.language) {
      language = workerAttrs.language;
    }
  }

  if (!language) {
    return defaultLanguage;
  }

  if (language === 'default') {
    return navigator.language;
  }

  return language;
};

