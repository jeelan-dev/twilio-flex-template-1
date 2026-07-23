import * as Flex from '@twilio/flex-ui';
import { FlexActionEvent, FlexAction } from '../../../../types/feature-loader';
import { getServerlessDomain } from '../../config';

export const actionEvent = FlexActionEvent.before;
export const actionName = FlexAction.AcceptTask;

export const actionHook = function beforeAcceptTask(flex: typeof Flex, _manager: Flex.Manager) {
  flex.Actions.addListener(`${actionEvent}${actionName}`, (payload: any) => {
    const { task } = payload;
    if (!Flex.TaskHelper.isCallTask(task)) return;

    // Attach conference status callback so serverless can detect non-graceful disconnects
    payload.conferenceOptions.conferenceStatusCallback =
      `https://${getServerlessDomain()}/conference-status-handler`;
    payload.conferenceOptions.conferenceStatusCallbackEvent = 'end,join,leave,modify';
  });
};
