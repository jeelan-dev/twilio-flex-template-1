/**
 * @fileOverview Salesforce OpenCTI integration for auto-creation of Tickets/Cases.
 *
 * Improvements (v2 - June 2026):
 * - Promisified OpenCTI saveLog with configurable timeout (prevents silent hangs)
 * - Retry with exponential backoff (handles transient SF API failures)
 * - Duplicate creation guard via in-flight tracking
 * - Structured return values for caller error handling
 *
 * @author Sunil Taruvu (original), Enhanced by Platform Team
 * @version 2.0
 * @date 2026-06-03
 */

import updateTaskAttributesWithCaseId from './twilio-helper';
import { getRecordTypeId } from '../config';

// --- Configuration ---
const OPENCTI_TIMEOUT_MS = 15000; // 15s timeout for OpenCTI callbacks
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000; // 2s, 4s, 8s exponential backoff

// Track in-flight ticket creation to prevent duplicates
const inFlightCreations = new Set();

// =========================================================================
// Helper: Promisified OpenCTI saveLog with timeout
// =========================================================================
const saveLogWithTimeout = (params, timeoutMs = OPENCTI_TIMEOUT_MS) => {
  return new Promise((resolve, reject) => {
    if (!window.sforce?.opencti?.saveLog) {
      reject(new Error('OpenCTI saveLog not available'));
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error(`OpenCTI saveLog timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      window.sforce.opencti.saveLog({
        value: params,
        callback: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
      });
    } catch (error) {
      clearTimeout(timer);
      reject(new Error(`OpenCTI saveLog threw: ${error.message || error}`));
    }
  });
};

// =========================================================================
// Helper: Retry wrapper with exponential backoff
// =========================================================================
const withRetry = async (fn, maxAttempts = MAX_RETRY_ATTEMPTS, baseDelay = RETRY_BASE_DELAY_MS) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.warn(`[create-sf-case] Retry ${attempt}/${maxAttempts} after ${delay}ms: ${error.message}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
};

// =========================================================================
// Helper: Check OpenCTI readiness
// =========================================================================
const isOpenCtiReady = () => {
  return !!window.sforce?.opencti?.saveLog;
};

// =========================================================================
// createSfTicket - Auto-create a Salesforce Case when agent accepts call
//
// Returns: { success: boolean, ticketId?: string, error?: string }
// =========================================================================
const createSfTicket = async (task) => {
  const taskSid = task.taskSid || task.sid;
  console.log(`[create-sf-case] createSfTicket called for task: ${taskSid}`);

  // Duplicate guard: prevent concurrent creation for same task
  if (inFlightCreations.has(taskSid)) {
    console.warn(`[create-sf-case] Ticket creation already in-flight for task: ${taskSid}`);
    return { success: false, error: 'Creation already in progress' };
  }

  // OpenCTI availability check
  if (!isOpenCtiReady()) {
    console.error('[create-sf-case] OpenCTI not available — cannot create ticket');
    return { success: false, error: 'Salesforce OpenCTI not loaded. Please refresh your browser.' };
  }

  inFlightCreations.add(taskSid);

  try {
    const caseParams = {
      entityApiName: 'Case',
      Subject: task.attributes.direction + ' Call from ' + task.attributes.caller + ' ' + task.dateCreated,
      Origin: 'Call',
      RecordtypeId: getRecordTypeId(),
      Caller_s_Name__c: task.attributes.call_sid,
      ContactId: task.attributes.sfcontactid || '',
      Description: 'callType:Inbound \n Caller:' + task.attributes.caller,
    };

    // Retry wrapper around the promisified saveLog call
    const response = await withRetry(() => saveLogWithTimeout(caseParams));

    if (response.success && response.returnValue?.recordId) {
      const ticketId = response.returnValue.recordId;
      console.log(`[create-sf-case] Ticket created successfully: ${ticketId}`);

      // Screen pop to the newly created case
      screenPop(ticketId);

      // Update Twilio task attributes with the SF ticket ID
      try {
        await updateTaskAttributesWithCaseId(taskSid, ticketId);
        console.log(`[create-sf-case] Task attributes updated with ticketId: ${ticketId}`);
      } catch (attrError) {
        // Non-fatal: case was created, just task attribute update failed
        console.error('[create-sf-case] Task attribute update failed (case still created):', attrError);
      }

      return { success: true, ticketId };
    } else {
      // SF returned a response but indicated failure
      const errorMsg = response.errors ? JSON.stringify(response.errors) : 'Unknown SF error (no recordId returned)';
      console.error(`[create-sf-case] SF ticket creation failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    // All retries exhausted or unrecoverable error
    console.error(`[create-sf-case] Ticket creation failed after ${MAX_RETRY_ATTEMPTS} attempts:`, error.message);
    return { success: false, error: error.message };
  } finally {
    inFlightCreations.delete(taskSid);
  }
};

// =========================================================================
// updateSfTicket - Update ticket owner on call transfer
//
// Returns: { success: boolean, ticketId?: string, error?: string }
// =========================================================================
const updateSfTicket = async (ticketId, newOwnerId) => {
  console.log(`[create-sf-case] updateSfTicket called — ticket: ${ticketId}, owner: ${newOwnerId}`);

  if (!isOpenCtiReady()) {
    console.error('[create-sf-case] OpenCTI not available for ticket update');
    return { success: false, error: 'OpenCTI not available' };
  }

  try {
    const response = await withRetry(() => saveLogWithTimeout({ Id: ticketId, OwnerId: newOwnerId }));

    if (response.success && response.returnValue?.recordId) {
      console.log(`[create-sf-case] Ticket owner updated: ${response.returnValue.recordId}`);
      screenPop(response.returnValue.recordId);
      return { success: true, ticketId: response.returnValue.recordId };
    } else {
      const errorMsg = response.errors ? JSON.stringify(response.errors) : 'Unknown error';
      console.error(`[create-sf-case] Ticket update failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error(`[create-sf-case] Ticket update failed after retries:`, error.message);
    return { success: false, error: error.message };
  }
};

// =========================================================================
// createSfTask - Auto-create a Salesforce Task record
//
// Returns: { success: boolean, taskId?: string, error?: string }
// =========================================================================
const createSfTask = async (task) => {
  console.log('[create-sf-case] createSfTask called');

  if (!isOpenCtiReady()) {
    return { success: false, error: 'OpenCTI not available' };
  }

  try {
    const taskParams = {
      entityApiName: 'Task',
      Subject: 'inbound voice Call from ' + task.attributes.caller + ' ' + task.dateCreated,
      Type: 'Call',
      RecordtypeId: '012i00000019r6TAAQ',
      Description: 'callType:Inbound \nCaller:' + task.attributes.caller,
      Internal_Comments__c:
        'callSID:' + task.attributes.call_sid + '\n ConferenceSID:' + task.attributes.conference?.sid,
      WhoId: '[{id:' + task.attributes.sfcontactid + '}]',
    };

    const response = await withRetry(() => saveLogWithTimeout(taskParams));

    if (response.success && response.returnValue?.recordId) {
      console.log(`[create-sf-case] SF Task created: ${response.returnValue.recordId}`);
      return { success: true, taskId: response.returnValue.recordId };
    } else {
      const errorMsg = response.errors ? JSON.stringify(response.errors) : 'Unknown error';
      console.error(`[create-sf-case] SF Task creation failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (error) {
    console.error('[create-sf-case] SF Task creation failed after retries:', error.message);
    return { success: false, error: error.message };
  }
};

// =========================================================================
// searchAndScreenPop - Search and open record in Salesforce
// =========================================================================
const searchAndScreenPop = (searchParams, callType) => {
  console.log('[create-sf-case] searchAndScreenPop called');
  if (window.sforce?.opencti?.searchAndScreenPop) {
    window.sforce.opencti.searchAndScreenPop({
      searchParams: searchParams,
      callType: window.sforce.opencti.CALL_TYPE.INBOUND,
      deferred: false,
      callback: (response) => {
        if (response.success) {
          console.log('[create-sf-case] searchAndScreenPop success:', response.returnValue);
        } else {
          console.error('[create-sf-case] searchAndScreenPop failed:', response.errors);
        }
      },
    });
  }
};

// =========================================================================
// screenPop - Open a Salesforce record by ID
// =========================================================================
const screenPop = (sfRecordId) => {
  if (!sfRecordId || typeof sfRecordId !== 'string') {
    console.warn('[create-sf-case] screenPop called with invalid recordId:', sfRecordId);
    return;
  }

  const recordId = sfRecordId.trim();
  if (!recordId) {
    console.warn('[create-sf-case] screenPop called with empty recordId');
    return;
  }

  console.log(`[create-sf-case] screenPop to: ${recordId}`);
  if (window.sforce?.opencti?.screenPop) {
    window.sforce.opencti.screenPop({
      type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
      params: { recordId },
    });
  }
};


//Sunil - updated to better handle the ticket creation and to avoid multiple/duplicate tickets creation
// test and replace the exising createSfTicket method
const createSfTicketmodified = function (task) {
  console.log('API Call for createSfTicket initiated for taskSid:', task.taskSid);

  if (task.attributes.ticketCreationInProgress) {
    console.log('Ticket creation already in progress for taskSid:', task.taskSid);
    return;
  }

  task.attributes.ticketCreationInProgress = true;

  if (window.sforce) {
    window.sforce.opencti.saveLog({
      value: {
        entityApiName: 'Case',
        Subject: `${task.attributes.direction} Call from ${task.attributes.caller} ${task.dateCreated}`,
        Origin: 'Call',
        RecordtypeId: '012i00000019r5uAAA',
        ContactId: task.attributes.sfcontactid,
        Description: `callType:Inbound \n Caller:${task.attributes.caller}`,
      },
      callback: (response) => {
        console.log('createSfTicket response:', JSON.stringify(response));

        if (response.success && response.returnValue.recordId) {
          const ticketId = response.returnValue.recordId;
          console.log('Ticket created successfully with ID:', ticketId);

          window.sforce.opencti.screenPop({
            type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
            params: { recordId: ticketId },
          });

          try {
            updateTaskAttributesWithCaseId(task.taskSid, ticketId);
            console.log('TaskAttributes updated successfully for taskSid:', task.taskSid);
          } catch (error) {
            console.error('Failed to update TaskAttributes:', error);
          }
        } else {
          console.error('Failed to create ticket:', response.errors);
        }

        // Reset the flag regardless of success or failure
        task.attributes.ticketCreationInProgress = false;
      },
    });
  } else {
    console.error('Salesforce OpenCTI is not available.');
    task.attributes.ticketCreationInProgress = false;
  }
};

/***************ADA GEN AI Chats related logic Start********************/
 
const createSfChatTicket = function (task) {
  if (window.sforce) {
    window.sforce.opencti.saveLog({
      value: {
        entityApiName: 'Case',
        Subject: 'Inbound Chat from from ADA',
        Origin: 'Chat',
        RecordtypeId: '012i00000019r5uAAA',   // same RecordTypeId as voice
        ContactId: task.attributes.sfcontactid || undefined,
        Description: 'Inbound Chat from ADA Description',
      },
      callback: (response) => {
        console.log('createSfChatTicket response' + JSON.stringify(response))
        if (response.success && response.returnValue?.recordId) {
          

          const ticketId = response.returnValue.recordId;
          window.sforce.opencti.screenPop({
            type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
            params: { recordId: ticketId },
          });
          try {
            updateTaskAttributesWithCaseId(task.taskSid, ticketId);
          } catch (error) {
            console.error('Failed to update TaskAttributes for chat case:', error);
          }
        }
      },
    });
  }
};
 
/***************ADA GEN AI Chats related logic Ens**********************/


export {
  searchAndScreenPop,
  createSfTicket,
  createSfTask,
  screenPop,
  updateSfTicket,
  createSfChatTicket,
  isOpenCtiReady,
};
