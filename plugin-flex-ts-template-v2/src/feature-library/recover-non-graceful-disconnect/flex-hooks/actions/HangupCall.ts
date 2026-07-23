import * as Flex from '@twilio/flex-ui';
import { FlexActionEvent, FlexAction } from '../../../../types/feature-loader';
import { removeWorkerFromConferenceState, endConference } from '../../utils/RecoveryService';

export const actionEvent = FlexActionEvent.before;
export const actionName = FlexAction.HangupCall;

export const actionHook = function beforeHangupCall(flex: typeof Flex, manager: Flex.Manager) {
  flex.Actions.addListener(`${actionEvent}${actionName}`, async (payload: any) => {
    const { task } = payload;
    if (!Flex.TaskHelper.isCallTask(task)) return;

    // Remove from Sync Map so conference-status-handler ignores this as a non-graceful disconnect
    await removeWorkerFromConferenceState(
      task.conference.conferenceSid,
      manager.workerClient?.sid ?? '',
    );

    // End conference explicitly when only 2 participants to avoid stale conferences
    if (task.conference.liveParticipantCount <= 2) {
      await endConference(task.conference.conferenceSid);
    }
  });
};
