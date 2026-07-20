/**
 * @fileOverview Auto-creation of Salesforce Case when agent accepts inbound call in Flex.
 *
 * v3 (June 2026): Moved case creation to SERVER-SIDE Twilio Function.
 * Eliminates dependency on browser OpenCTI session, SF iframe loading,
 * and agent-side network conditions.
 *
 * Flow:
 *   1. Agent accepts inbound voice call
 *   2. Plugin calls serverless function → SF REST API creates Case
 *   3. Task attributes updated with ticketId (server-side)
 *   4. Plugin screen-pops to the Case in SF UI (browser-side, non-critical)
 *
 * @author Sunil Taruvu (original), Enhanced by Platform Team
 * @version 3.0
 * @date 2026-06-03
 */

import * as Flex from '@twilio/flex-ui';
import { FlexEvent } from '../../../../types/feature-loader';
import CreateSfCaseService from '../../utils/CreateSfCaseService';

import {
  createSfTicket,
  createSfTask,
  createSfChatTicket,
  screenPop,
  updateSfTicket,
} from '../../utils/salesforcehelper';

export const eventName = FlexEvent.taskAccepted;
export const eventHook = async function createCaseAfterTaskAcceptance(
  flex: typeof Flex,
  manager: Flex.Manager,
  task: Flex.ITask,
) {
  // your code here
  console.log('[create-sf-case] Task accepted:', task.taskSid, task.attributes.direction);
  console.log('task attributes--' + JSON.stringify(task.attributes));
  //  console.log('Task accepted-agent answered call worker attributes----'+JSON.stringify(manager.workerClient?.attributes));
  if (task.taskChannelUniqueName === 'voice' && task.attributes.direction && task.attributes.direction === 'inbound') {
    if (task.attributes.sfcontactid && task.attributes.sfcontactid !== '') {
      if (task.attributes.ticketId && task.attributes.ticketId !== '') {
        if (manager.workerClient?.attributes.userId) {
          updateSfTicket(task.attributes.ticketId, manager.workerClient?.attributes.userId);
          screenPop(task.attributes.ticketId);
        } else {
          console.log('Cannnot update SF ticket owner ID. Worker attributes missing userId.');
        }
      } else {
        //No Existing Ticket Associated with Task
        console.log('No existing Ticket in SF');
        screenPop(task.attributes.sfcontactid);
        createSfTicket(task);
        //createSfTask(task)
      }
    } else {
      //No SF Contact ID
      createSfTicket(task); //as per ESW-1739 added creation of tickets for un recognized callers//For Italy, no auto creation of tickets in case of caller not recognized
      console.log('acceptedReservation else condition passed No SF Contact recognized ---');
      //screenPop();
    }
  } else if (task.taskChannelUniqueName === 'chat') {
    // Ticket creation for ADA Chats
    const { sfcontactid, ticketId } = task.attributes;
    if (ticketId && ticketId !== '') {
      // Re-assign existing case owner on transfer
      console.log('Ticket owner updated in SF for existing ticketId1 chat: ' + ticketId);
      if (manager.workerClient?.attributes.userId) {
        updateSfTicket(ticketId, manager.workerClient.attributes.userId);
        console.log('Ticket owner updated in SF for existing ticketId2 chat: ' + ticketId);
        screenPop(ticketId);
      } else {
        console.log('Cannot update SF ticket owner. Worker userId missing.');
      }
    } else if (sfcontactid && sfcontactid !== '') {
      // Known contact, no case yet
      screenPop(sfcontactid);
      console.log('Creating SF chat ticket for known contact: ' + sfcontactid);
      createSfChatTicket(task);
    } else {
      // Unknown contact
      createSfChatTicket(task);

      console.log('Creating SF chat ticket for unknown contact', task.attributes);
    }
  }

  // Skip reconnect tasks — they resume an existing call, not a new one.
  // The reconnect task inherits attributes from the Sync Map snapshot which may not yet
  // contain ticketId (written async after the original task was accepted), so we must
  // guard on isReconnect rather than relying solely on ticketId presence.
  const userId = manager.workerClient?.attributes.userId;

  if (task.attributes.isReconnect) {
    console.log(`[create-sf-case] Reconnect task ${task.taskSid} — skipping case creation, popping existing case`);

    // ticketId may already be on the reconnect task's attributes (happy path)
    let ticketId: string | undefined = task.attributes.ticketId;

    // If not, fetch it from the original task (which had it written server-side)
    if (!ticketId && task.attributes.disconnectedTaskSid) {
      console.log(
        `[create-sf-case] ticketId missing from reconnect task, fetching from original task ${task.attributes.disconnectedTaskSid}`,
      );
      ticketId =
        (await CreateSfCaseService.getTaskTicketId(task.attributes.disconnectedTaskSid, task.attributes.call_sid)) ??
        undefined;
    }

    if (ticketId) {
      // If a different agent picked up this reconnect task, transfer case ownership to them
      const reconnectedToSameAgent = manager.workerClient?.sid === task.attributes.disconnectedWorkerSid;
      if (!reconnectedToSameAgent && userId) {
        console.log(`[create-sf-case] Reconnect picked up by different agent — updating case owner to ${userId}`);
        const updateResult = await CreateSfCaseService.updateCaseOwner(ticketId, userId);
        if (!updateResult.success) {
          console.error('[create-sf-case] Case owner update failed on reconnect:', updateResult.message);
        }
      }

      console.log(`[create-sf-case] Screen-popping to existing case: ${ticketId}`);
      screenPop(ticketId);
    } else {
      console.warn(`[create-sf-case] Could not resolve ticketId for reconnect task ${task.taskSid} — no screen pop`);
    }
    return;
  }

  // Skip if ticket was already created — update owner (transfer scenario) and screen pop
  if (task.attributes.ticketId) {
    console.log(`[create-sf-case] Ticket already exists: ${task.attributes.ticketId} — updating owner`);
    if (userId) {
      const updateResult = await CreateSfCaseService.updateCaseOwner(task.attributes.ticketId, userId);
      if (!updateResult.success) {
        console.error('[create-sf-case] Case owner update failed:', updateResult.message);
      }
    }
    screenPop(task.attributes.ticketId);
    return;
  }

  try {
    console.log('[create-sf-case] Creating case via server-side function...');

    const result = await CreateSfCaseService.createCase({
      taskSid: task.taskSid,
      caller: task.attributes.caller || '',
      callSid: task.attributes.call_sid || '',
      direction: task.attributes.direction || 'inbound',
      sfcontactid: task.attributes.sfcontactid || '',
      dateCreated: task.dateCreated?.toISOString?.() || new Date().toISOString(),
    });

    if (result.success && result.caseId) {
      console.log(`[create-sf-case] Case created successfully: ${result.caseId}`);

      // Screen pop to the new case (or contact if no case UI available)
      screenPop(result.caseId);
    } else {
      console.error('[create-sf-case] Server-side case creation failed:', result.message);
      Flex.Notifications.showNotification('CaseCreationFailed', {
        reason: result.message || 'Server error creating case',
      });

      // Still screen pop to contact if available
      if (task.attributes.sfcontactid) {
        screenPop(task.attributes.sfcontactid);
      }
    }
  } catch (error: any) {
    console.error('[create-sf-case] Unexpected error:', error);
    Flex.Notifications.showNotification('CaseCreationFailed', {
      reason: error.message || 'Unexpected error',
    });
  }
};
