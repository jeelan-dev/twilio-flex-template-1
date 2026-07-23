import * as Flex from '@twilio/flex-ui';
import { FlexActionEvent, FlexAction } from '../../../../types/feature-loader';
import { removeWorkerFromConferenceState } from '../../utils/RecoveryService';

export const actionEvent = FlexActionEvent.before;
export const actionName = FlexAction.TransferTask;

export const actionHook = function beforeTransferTask(flex: typeof Flex, manager: Flex.Manager) {
  flex.Actions.addListener(`${actionEvent}${actionName}`, async (payload: any) => {
    const { task, options } = payload;

    if (Flex.TaskHelper.isCallTask(task) && options?.mode === 'COLD') {
      // Remove from Sync Map on cold transfer — agent is intentionally leaving the call
      await removeWorkerFromConferenceState(
        task.conference.conferenceSid,
        manager.workerClient?.sid ?? '',
      );
    }
  });
};
