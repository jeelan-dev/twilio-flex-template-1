import * as Flex from '@twilio/flex-ui';

import { FlexEvent } from '../../../../types/feature-loader';
import { getSystemActivityNames } from '../../config';
import { reservedSystemActivities } from '../../helper/ActivityManager';
import logger from '../../../../utils/logger';

/**
 * Disconnect Activity Auto-Restore
 *
 * PURPOSE: When an agent locks their laptop (or Chrome suspends the tab),
 * the WebSocket connection to TaskRouter drops. Twilio sets the worker to
 * the workspace's default_activity (Unavailable). When the agent unlocks
 * and Chrome reconnects, this hook automatically restores their previous
 * intentional activity (e.g., Lunch, Break, Restroom).
 *
 * FLOW:
 *   1. On every manual/intentional activity change → store in localStorage
 *   2. On Flex init (reconnect) → if current activity is "Unavailable" or "Offline"
 *      AND we have a stored intentional activity → restore it
 *   3. On visibilitychange (tab becomes visible) → same check
 *
 * DOES NOT restore if:
 *   - The stored activity is a system activity (In Call, Wrap Up, etc.)
 *   - The agent has active tasks
 *   - The agent intentionally set themselves to Unavailable/Offline
 */

const STORAGE_KEY_PREFIX = 'disconnectRestore_lastIntentionalActivity_';
const DISCONNECT_ACTIVITIES = ['Unavailable', 'Offline'];

// Activities that are set by the agent intentionally (non-system, non-disconnect)
const isIntentionalActivity = (activityName: string): boolean => {
  const systemNames = reservedSystemActivities.map((a) => a?.toLowerCase());
  const disconnectNames = DISCONNECT_ACTIVITIES.map((a) => a.toLowerCase());
  const name = activityName.toLowerCase();

  // Not a system activity (In Call, Wrap Up, etc.) and not a disconnect activity
  return !systemNames.includes(name) && !disconnectNames.includes(name);
};

const getStorageKey = (): string => {
  const accountSid = Flex.Manager.getInstance().serviceConfiguration.account_sid;
  return `${STORAGE_KEY_PREFIX}${accountSid}`;
};

const storeIntentionalActivity = (activityName: string): void => {
  const data = {
    name: activityName,
    timestamp: Date.now(),
  };
  localStorage.setItem(getStorageKey(), JSON.stringify(data));
  logger.debug(`[disconnect-restore] Stored intentional activity: ${activityName}`);
};

const getStoredActivity = (): { name: string; timestamp: number } | null => {
  const item = localStorage.getItem(getStorageKey());
  if (!item) return null;
  try {
    return JSON.parse(item);
  } catch {
    return null;
  }
};

const clearStoredActivity = (): void => {
  localStorage.removeItem(getStorageKey());
};

const isDisconnectActivity = (activityName: string): boolean => {
  return DISCONNECT_ACTIVITIES.map((a) => a.toLowerCase()).includes(activityName.toLowerCase());
};

const hasActiveTasks = (): boolean => {
  const tasks = Flex.Manager.getInstance().store.getState().flex.worker.tasks;
  return tasks && tasks.size > 0;
};

const attemptRestore = async (): Promise<void> => {
  const manager = Flex.Manager.getInstance();
  const workerClient = manager.workerClient;

  if (!workerClient) {
    logger.debug('[disconnect-restore] No worker client available');
    return;
  }

  const currentActivity = workerClient.activity?.name;

  // Only restore if currently in a disconnect activity
  if (!currentActivity || !isDisconnectActivity(currentActivity)) {
    logger.debug(`[disconnect-restore] Current activity "${currentActivity}" is not a disconnect state, skipping`);
    return;
  }

  // Don't restore if agent has active tasks
  if (hasActiveTasks()) {
    logger.debug('[disconnect-restore] Agent has active tasks, skipping restore');
    return;
  }

  const stored = getStoredActivity();
  if (!stored) {
    logger.debug('[disconnect-restore] No stored intentional activity found');
    return;
  }

  // Don't restore if stored activity is older than 12 hours (stale)
  const twelveHours = 12 * 60 * 60 * 1000;
  if (Date.now() - stored.timestamp > twelveHours) {
    logger.info('[disconnect-restore] Stored activity is older than 12 hours, clearing');
    clearStoredActivity();
    return;
  }

  // Don't restore to a system activity
  if (!isIntentionalActivity(stored.name)) {
    logger.debug(`[disconnect-restore] Stored activity "${stored.name}" is system/disconnect, skipping`);
    clearStoredActivity();
    return;
  }

  // Verify the stored activity still exists in the workspace
  const activities = workerClient.activities;
  const targetActivity = Array.from(activities.values()).find(
    (a: any) => a.name.toLowerCase() === stored.name.toLowerCase(),
  );

  if (!targetActivity) {
    logger.warn(`[disconnect-restore] Activity "${stored.name}" not found in workspace, clearing`);
    clearStoredActivity();
    return;
  }

  // Perform the restore
  logger.info(`[disconnect-restore] Restoring activity from "${currentActivity}" to "${stored.name}"`);

  try {
    // Set the pendingActivityChange in localStorage so the existing
    // ActivityManager.enforceEvaluatedState() won't override our restore
    // with "Available" when it evaluates state after the activity change event.
    const accountSid = Flex.Manager.getInstance().serviceConfiguration.account_sid;
    const pendingKey = `pendingActivityChange_${accountSid}`;
    localStorage.setItem(pendingKey, JSON.stringify({ name: stored.name }));

    await Flex.Actions.invokeAction('SetActivity', {
      activityName: stored.name,
      isInvokedByPlugin: true,
    });
    logger.info(`[disconnect-restore] Successfully restored to "${stored.name}"`);
  } catch (err: any) {
    logger.error('[disconnect-restore] Failed to restore activity', err as object);
  }
};

export const eventName = FlexEvent.pluginsInitialized;
export const eventHook = async (_flex: typeof Flex, manager: Flex.Manager) => {
  const workerClient = manager.workerClient;

  if (!workerClient) {
    logger.warn('[disconnect-restore] No worker client, cannot register disconnect restore');
    return;
  }

  // --- LISTENER 1: Track intentional activity changes ---
  // When the agent manually changes status, store it
  workerClient.on('activityUpdated', (worker: any) => {
    const activityName = worker.activity?.name;
    if (!activityName) return;

    // Only store if this is an intentional (non-system, non-disconnect) activity
    if (isIntentionalActivity(activityName)) {
      storeIntentionalActivity(activityName);
    }

    // If agent manually went to Available, clear the stored activity
    // (they're done with Break/Lunch, don't restore it)
    const systemNames = getSystemActivityNames();
    if (activityName === systemNames.available) {
      clearStoredActivity();
    }
  });

  // --- LISTENER 2: Restore on reconnect (Flex init) ---
  // When the plugin initializes (page load / reconnect), attempt restore.
  // We retry multiple times because:
  //   - workerClient.activity may not be synced yet at init time
  //   - WebSocket reconnection takes variable time
  //   - The ActivityManager constructor also runs enforceEvaluatedState on init
  const attemptRestoreWithRetry = async () => {
    const delays = [3000, 5000, 8000];
    for (const delay of delays) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const currentActivity = workerClient?.activity?.name;
      logger.debug(`[disconnect-restore] Init retry check: current activity = "${currentActivity}"`);
      if (currentActivity && isDisconnectActivity(currentActivity)) {
        await attemptRestore();
        return;
      }
      // If already restored or agent manually changed, stop retrying
      if (currentActivity && !isDisconnectActivity(currentActivity)) {
        logger.debug(`[disconnect-restore] Activity is "${currentActivity}", no restore needed`);
        return;
      }
    }
  };
  attemptRestoreWithRetry();

  // --- LISTENER 3: Restore on tab visibility change ---
  // When agent switches back to the Flex tab after locking/unlocking laptop
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      logger.debug('[disconnect-restore] Tab became visible, checking for restore');
      // Wait for WebSocket to re-establish
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await attemptRestore();
    }
  });

  // --- LISTENER 4: Restore on window focus ---
  // Covers Salesforce tab switching within same browser window
  window.addEventListener('focus', async () => {
    logger.debug('[disconnect-restore] Window focused, checking for restore');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await attemptRestore();
  });

  logger.info('[disconnect-restore] Disconnect activity auto-restore initialized');
};
