import * as Flex from '@twilio/flex-ui';
import { getServerlessDomain } from '../config';

const getToken = (): string =>
  (Flex.Manager.getInstance().store.getState() as any).flex.session.ssoTokenPayload.token;

const postUrlEncoded = (url: string, body: Record<string, string | boolean | undefined>): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body as Record<string, string>),
  });

const baseUrl = (): string => `https://${getServerlessDomain()}`;

export const addWorkerToConferenceState = async (
  conferenceSid: string,
  taskSid: string,
  taskAttributes: Record<string, unknown>,
  taskWorkflowSid: string,
  customerCallSid: string,
  workerSid: string,
  workerReservationSid: string,
  workerCallSid: string,
  workerName: string,
): Promise<void> => {
  await postUrlEncoded(`${baseUrl()}/flex/add-worker-to-conference-state`, {
    Token: getToken(),
    conferenceSid,
    taskSid,
    taskAttributes: JSON.stringify(taskAttributes),
    taskWorkflowSid,
    customerCallSid,
    workerSid,
    workerReservationSid,
    workerCallSid,
    workerName,
  });
};

export const removeWorkerFromConferenceState = async (conferenceSid: string, workerSid: string): Promise<void> => {
  await postUrlEncoded(`${baseUrl()}/flex/remove-worker-from-conference-state`, {
    Token: getToken(),
    conferenceSid,
    workerSid,
  });
};

export const endConference = async (conferenceSid: string): Promise<void> => {
  await postUrlEncoded(`${baseUrl()}/flex/end-conference`, {
    Token: getToken(),
    conferenceSid,
  });
};

export const updateEndConferenceOnExit = async (
  conferenceSid: string,
  participantCallSid: string,
  endConferenceOnExit: boolean,
): Promise<void> => {
  await postUrlEncoded(`${baseUrl()}/flex/update-end-conference-on-exit`, {
    Token: getToken(),
    conferenceSid,
    participantCallSid,
    endConferenceOnExit: String(endConferenceOnExit),
  });
};

export const moveParticipantsToNewConference = async (
  conferenceSid: string,
  newConferenceName: string,
): Promise<void> => {
  await postUrlEncoded(`${baseUrl()}/flex/move-conference-participants-to-new-conference`, {
    Token: getToken(),
    conferenceSid,
    newConferenceName,
  });
};
