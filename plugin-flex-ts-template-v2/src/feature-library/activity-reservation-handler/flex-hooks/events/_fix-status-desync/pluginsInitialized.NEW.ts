import * as Flex from '@twilio/flex-ui';

import { FlexEvent } from '../../../../../types/feature-loader';
import ActivityManager from '../../../helper/ActivityManager';
import logger from '../../../../../utils/logger';

export const eventName = FlexEvent.pluginsInitialized;
export const eventHook = async function activityResyncOnVisibilityChange(
  _flex: typeof Flex,
  _manager: Flex.Manager,
) {
  // When Flex is embedded in Salesforce (or any iframe), the browser throttles
  // JavaScript execution when the tab/iframe loses visibility. This causes
  // the agent's local activity state to drift from the actual TaskRouter state
  // that the supervisor sees on the Twilio dashboard.
  //
  // This handler forces a re-evaluation when the iframe regains visibility,
  // ensuring the agent's displayed status matches TaskRouter.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      logger.debug('[activity-reservation-handler] Visibility restored — re-syncing activity state');

      // Small delay to allow any pending WebSocket messages to be processed
      // after the browser un-throttles the iframe
      await new Promise((resolve) => setTimeout(resolve, 500));

      await ActivityManager.enforceEvaluatedState();
    }
  });

  // Also listen for window focus events (covers Salesforce tab switching
  // within the same browser window where visibilitychange may not fire)
  window.addEventListener('focus', async () => {
    logger.debug('[activity-reservation-handler] Window focus — re-syncing activity state');

    await new Promise((resolve) => setTimeout(resolve, 500));
    await ActivityManager.enforceEvaluatedState();
  });

  logger.info('[activity-reservation-handler] Registered visibility/focus resync handlers for embedded mode');
};
