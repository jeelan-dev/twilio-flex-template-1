import * as Flex from '@twilio/flex-ui';
import { FlexEvent } from '../../../../types/feature-loader';
import { isAutoAnswerReconnectEnabled } from '../../config';
import {
  addWorkerToConferenceState,
  updateEndConferenceOnExit,
  moveParticipantsToNewConference,
} from '../../utils/RecoveryService';

export const eventName = FlexEvent.pluginsInitialized;

const RECOVERY_PING_WORKFLOW_NAME = 'Recovery Ping';

const showDialog = (message: string, detail?: string) =>
  Flex.Actions.invokeAction('SetComponentState', {
    name: 'ReconnectDialog',
    state: { isOpen: true, message, messageDetail: detail },
  });

const closeDialog = () =>
  Flex.Actions.invokeAction('SetComponentState', {
    name: 'ReconnectDialog',
    state: { isOpen: false },
  });

const isRecoveryPingTask = (task: Flex.ITask) =>
  task.workflowName === RECOVERY_PING_WORKFLOW_NAME;

const isIncomingWarmTransfer = (task: Flex.ITask) =>
  !!(task as any).incomingTransferObject && (task as any).incomingTransferObject.mode === 'WARM';

const waitForConferenceParticipants = (task: Flex.ITask): Promise<void> =>
  new Promise((resolve) => {
    const maxWait = 5000;
    const interval = 100;
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += interval;
      const { conference } = task as any;

      if (!conference?.conferenceSid) return;

      const { participants } = conference;
      if (!Array.isArray(participants) || participants.length < 2) return;

      const worker = participants.find((p: any) => p.isMyself && p.status === 'joined');
      const customer = participants.find((p: any) => p.participantType === 'customer');

      if (!worker || !customer) return;

      clearInterval(timer);
      resolve();
    }, interval);

    setTimeout(() => {
      clearInterval(timer);
      resolve();
    }, maxWait);
  });

async function handleReservationAccepted(reservation: any, manager: Flex.Manager) {
  const task = Flex.TaskHelper.getTaskByTaskSid(reservation.sid);
  if (!Flex.TaskHelper.isCallTask(task)) return;

  await waitForConferenceParticipants(task);

  const conference = (task as any).conference;
  const myParticipant = conference?.participants?.find((p: any) => p.isMyself && p.status === 'joined');
  if (!myParticipant) return;

  await addWorkerToConferenceState(
    conference.conferenceSid,
    task.taskSid,
    task.attributes,
    task.workflowSid,
    task.attributes.call_sid,
    task.workerSid,
    reservation.sid,
    myParticipant.callSid,
    (manager.workerClient as any)?.attributes?.full_name ?? '',
  );

  // Explicitly set endConferenceOnExit=false so customer stays on hold if agent drops
  await updateEndConferenceOnExit(conference.conferenceSid, myParticipant.callSid, false);

  // Handle reconnect task — move customer from old conference into new one
  if (task.attributes.isReconnect && !(task as any).incomingTransferObject) {
    const disconnectedWorkerName = task.attributes.disconnectedWorkerName;
    const ms = Math.max(Date.now() - Date.parse(task.attributes.disconnectedTime), 0);
    const secs = Math.floor(ms / 1000);
    const duration = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;

    const isSameAgent = manager.workerClient?.sid === task.attributes.disconnectedWorkerSid;
    const detail = isSameAgent ? undefined : `${disconnectedWorkerName} dropped ${duration} ago`;
    showDialog('Reconnected with customer!', detail);

    setTimeout(() => closeDialog(), 3000);

    await moveParticipantsToNewConference(
      task.attributes.disconnectedConferenceSid,
      conference.sid, // taskSid is used as conference name by Flex
    );

    Flex.Actions.invokeAction('SelectTask', { sid: reservation.sid });
  }
}

function initializeReservation(reservation: any, manager: Flex.Manager) {
  reservation.addListener('accepted', () => handleReservationAccepted(reservation, manager));

  const task = Flex.TaskHelper.getTaskByTaskSid(reservation.sid);

  // Auto-accept recovery ping tasks silently
  if (isRecoveryPingTask(task)) {
    showDialog('Disconnected from customer.', 'Reconnecting you now...');
    Flex.Actions.invokeAction('AcceptTask', { sid: reservation.sid });
    return;
  }

  if (!Flex.TaskHelper.isCallTask(task)) return;

  // Skip warm transfers
  if (isIncomingWarmTransfer(task)) return;

  // Handle wrapping state (page refresh after non-graceful disconnect)
  if (Flex.TaskHelper.isInWrapupMode(task)) {
    if (task.attributes.conversations?.followed_by !== 'Reconnect Agent') return;

    const reservationFinishedEvents = ['timeout', 'canceled', 'rescinded', 'completed', 'wrapup'];
    reservationFinishedEvents.forEach((event) => {
      reservation.addListener(event, (r: any) => {
        if (!r.task.attributes.wasPingSuccessful) closeDialog();
      });
    });

    showDialog('Disconnected from customer.', 'Awaiting reconnection...');
    return;
  }

  // Auto-answer reconnect tasks for the original agent
  if (
    task.attributes.isReconnect &&
    task.attributes.disconnectedWorkerSid === manager.workerClient?.sid &&
    isAutoAnswerReconnectEnabled()
  ) {
    Flex.Actions.invokeAction('AcceptTask', { sid: reservation.sid });
  }
}

export const eventHook = function onPluginsInitialized(_flex: typeof Flex, manager: Flex.Manager) {
  // Handle future reservations
  manager.workerClient?.on('reservationCreated', (reservation: any) => {
    initializeReservation(reservation, manager);
  });

  // Handle reservations already present on load (page refresh scenario)
  manager.events.addListener('pluginsLoaded', () => {
    manager.workerClient?.reservations.forEach((reservation: any) => {
      if (Flex.TaskHelper.isCallTask(reservation.task) && Flex.TaskHelper.isInWrapupMode(reservation.task)) {
        initializeReservation(reservation, manager);
      }
    });
    manager.workerClient?.reservations.forEach((reservation: any) => {
      if (isRecoveryPingTask(reservation.task)) {
        initializeReservation(reservation, manager);
      }
    });
  });
};
